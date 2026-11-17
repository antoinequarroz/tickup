import "server-only";
import crypto from "node:crypto";
import type { GithubLink, Issue } from "@/lib/types";
import { categoryOfStatus, firstStatus, getIssue, githubLinkIssues, removeGithubLink, saveGithubLink, updateIssue } from "./db";
import { publish } from "./events";
import { branchRef, closingRefsIn, refsIn } from "@/lib/github";
import { emit } from "./suite";

/**
 * GitHub integration, through a webhook (no token, nothing to install): a repository posts its
 * pull requests and pushes to /api/github/webhook, signed with GITHUB_WEBHOOK_SECRET.
 *
 * - A pull request, a branch or a commit that names a ticket (WEB-12) is attached to it.
 * - A pull request opened for a ticket moves it to "in progress" (if it had not started).
 * - Merging it into the default branch finishes the ticket, when the ticket is named in the PR's
 *   title or branch, or after a closing word in its description ("Fixes WEB-12"). A commit that
 *   reaches the default branch with a closing word does the same.
 * - A ticket that is only mentioned is linked, never moved. A pull request coming from a fork
 *   (someone outside the repository) links too, but never moves a ticket.
 */

export const githubSecret = () => {
  const s = process.env.GITHUB_WEBHOOK_SECRET?.trim() ?? "";
  return s.length >= 16 ? s : null;
};
export const githubConfigured = () => !!githubSecret();

/** Checks GitHub's "X-Hub-Signature-256: sha256=<hmac of the raw body>", in constant time. */
export function validSignature(secret: string, rawBody: string | Buffer, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(rawBody).digest("hex"));
  const given = Buffer.from(header.slice(7).trim().toLowerCase());
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export type GithubResult = { event: string; linked: string[]; moved: string[]; ignored?: string };

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const httpsUrl = (v: unknown) => (typeof v === "string" && /^https:\/\/[^\s]+$/.test(v) ? v.slice(0, 500) : "");

type Touched = Map<string, Issue>;

function move(issue: Issue, to: "active" | "done", moved: string[]) {
  const from = categoryOfStatus(issue.statusId);
  // Opening a PR only starts what had not started; merging finishes what is not closed yet.
  if (to === "active" ? from !== "backlog" && from !== "todo" : from === "done" || from === "canceled") return;
  const target = firstStatus(issue.projectId, to) ?? (to === "active" ? firstStatus(issue.projectId, "review") : null);
  if (!target || target.id === issue.statusId) return;
  const updated = updateIssue(issue.id, { statusId: target.id });
  if (!updated) return;
  moved.push(issue.ref);
  emit({ type: "issue", projectId: issue.projectId, issueId: issue.id }, "issue.updated", { issue: updated, changed: ["statusId"], previous: { statusId: issue.statusId }, via: "github" });
}

/** Attaches a PR, branch or commit to the tickets named. Returns them; `touched` collects those whose links changed. */
function attach(refs: string[], link: Pick<GithubLink, "kind" | "repo" | "ref" | "title" | "url" | "state" | "author">, linked: Set<string>, touched: Touched): Issue[] {
  const issues: Issue[] = [];
  for (const r of refs.slice(0, 10)) {
    const issue = getIssue(r);
    if (!issue) continue;
    if (saveGithubLink(issue.id, link)) touched.set(issue.id, issue);
    issues.push(issue);
    linked.add(issue.ref);
  }
  return issues;
}

/** Open ticket panels reload their GitHub section; the rest of the suite is only told about real moves. */
function refresh(touched: Touched, moved: string[]) {
  for (const issue of touched.values()) if (!moved.includes(issue.ref)) publish({ type: "issue", projectId: issue.projectId, issueId: issue.id }, "all");
}

/** Applies one webhook delivery. Unknown events and payloads that name no ticket change nothing. */
export function handleGithub(event: string, payload: unknown): GithubResult {
  const linked = new Set<string>();
  const moved: string[] = [];
  const touched: Touched = new Map();
  const done = (ignored?: string): GithubResult => {
    refresh(touched, moved);
    return { event, linked: [...linked], moved, ...(ignored && { ignored }) };
  };
  if (!isObj(payload)) return done("payload");
  if (event === "ping") return done();
  const repoObj = isObj(payload.repository) ? payload.repository : {};
  const repo = str(repoObj.full_name, 140);
  if (!repo) return done("repository");
  const defaultBranch = str(repoObj.default_branch, 200);

  if (event === "pull_request" && isObj(payload.pull_request)) {
    const pr = payload.pull_request;
    const number = Number(pr.number);
    const url = httpsUrl(pr.html_url);
    if (!Number.isInteger(number) || number < 1 || !url) return done("pull_request");
    const headObj = isObj(pr.head) ? pr.head : {};
    const head = str(headObj.ref, 200);
    const headRepo = isObj(headObj.repo) ? str(headObj.repo.full_name, 140) : "";
    const base = isObj(pr.base) ? str(pr.base.ref, 200) : "";
    const title = str(pr.title);
    const body = str(pr.body, 20_000);
    const merged = pr.merged === true;
    const state = merged ? "merged" : pr.state === "closed" ? "closed" : pr.draft === true ? "draft" : "open";
    const author = isObj(pr.user) ? str(pr.user.login, 80) : "";
    const fromBranch = branchRef(head);
    const closing = new Set([...refsIn(title), ...(fromBranch ? [fromBranch] : []), ...closingRefsIn(body)]);
    const all = [...new Set([...closing, ...refsIn(body)])];
    const ref = String(number);
    const before = new Set(githubLinkIssues("pr", repo, ref));
    const issues = attach(all, { kind: "pr", repo, ref, title, url, state, author }, linked, touched);
    // The PR was edited and no longer names a ticket: the link goes.
    const now = new Set(issues.map((i) => i.id));
    for (const id of before) {
      if (now.has(id)) continue;
      removeGithubLink(id, "pr", repo, ref);
      const gone = getIssue(id);
      if (gone) touched.set(gone.id, gone);
    }
    // A PR from a fork is written by someone outside the repository: it shows on the ticket, it does not move it.
    const trusted = !headRepo || headRepo === repo;
    const action = str(payload.action, 40);
    if (trusted) {
      for (const issue of issues) {
        if (!closing.has(issue.ref)) continue;
        if (action === "closed" && merged) {
          // Like GitHub itself: only a merge into the default branch finishes the work.
          if (!defaultBranch || !base || base === defaultBranch) move(issue, "done", moved);
        } else if ((action === "opened" || action === "reopened" || action === "ready_for_review") && state === "open") move(issue, "active", moved);
      }
    }
    return done();
  }

  if (event === "push") {
    const fullRef = str(payload.ref, 300);
    if (!fullRef.startsWith("refs/heads/")) return done("ref");
    const branch = fullRef.slice("refs/heads/".length);
    if (payload.deleted === true) {
      // The branch is gone: so is its line on the tickets.
      for (const id of githubLinkIssues("branch", repo, branch.slice(0, 200))) {
        removeGithubLink(id, "branch", repo, branch.slice(0, 200));
        const issue = getIssue(id);
        if (issue) touched.set(issue.id, issue);
      }
      return done();
    }
    const onDefault = !!defaultBranch && branch === defaultBranch;
    const repoUrl = httpsUrl(repoObj.html_url);
    // A branch named after a ticket ("web-12-galerie") is attached to it.
    const named = onDefault ? null : branchRef(branch);
    if (named && repoUrl) {
      const pusher = isObj(payload.pusher) ? str(payload.pusher.name, 80) : "";
      attach([named], { kind: "branch", repo, ref: branch.slice(0, 200), title: branch.slice(0, 200), url: `${repoUrl}/tree/${branch.split("/").map(encodeURIComponent).join("/")}`, state: "", author: pusher }, linked, touched);
    }
    const commits = Array.isArray(payload.commits) ? payload.commits.slice(0, 50) : [];
    for (const c of commits) {
      // On a feature branch, a commit already seen elsewhere is not news. On the default branch every
      // commit counts: a merge or a fast-forward brings commits GitHub has seen before, and their closing words apply now.
      if (!isObj(c) || (c.distinct === false && !onDefault)) continue;
      const sha = str(c.id, 64);
      const url = httpsUrl(c.url);
      const message = str(c.message, 4000);
      if (!/^[0-9a-f]{7,64}$/.test(sha) || !url) continue;
      const refs = refsIn(message);
      if (!refs.length) continue;
      const closing = new Set(closingRefsIn(message));
      const author = isObj(c.author) ? str(c.author.username, 80) || str(c.author.name, 80) : "";
      for (const issue of attach(refs, { kind: "commit", repo, ref: sha.slice(0, 7), title: message.split("\n")[0].slice(0, 300), url, state: "", author }, linked, touched)) {
        if (onDefault && closing.has(issue.ref) && !moved.includes(issue.ref)) move(issue, "done", moved);
      }
    }
    return done();
  }

  return done("event");
}
