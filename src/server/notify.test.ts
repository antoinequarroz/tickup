import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "./db";
import { publish } from "./events";
import { sendMail } from "./mail";
import { isWatching, listNotifications, markRead, mentionedUsers, remindDueDates, setNotifyEmail, setWatching, unreadCount } from "./notify";
import { emit } from "./suite";

vi.mock("./mail", () => ({ sendMail: vi.fn(), mailConfigured: () => true }));
vi.mock("./events", () => ({ publish: vi.fn(), subscribe: vi.fn() }));

const account = (n: string) => ({ email: `${n.toLowerCase().replace(/\s+/g, ".")}@exemple.ch`, name: n, salt: "s", hash: "h" });

beforeEach(() => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tickup-notify-"));
  delete process.env.SUITE_WEBHOOK_URL;
  vi.mocked(sendMail).mockClear();
  vi.mocked(publish).mockClear();
});

function setup() {
  const ana = store.createFirstUser(account("Ana Rossi"))!;
  const bob = store.createUser({ ...account("Bob Meier"), role: "member" })!;
  const project = store.createProject({ key: "WEB", name: "Site web", template: "software", leadId: ana.id })!;
  const data = store.getProjectData("WEB")!;
  const status = (c: string) => data.statuses.find((s) => s.category === c)!;
  return { ana, bob, project, status };
}

const live = (issue: { projectId: string; id: string }) => ({ type: "issue" as const, projectId: issue.projectId, issueId: issue.id });

/** Changes a ticket like the API does: save, then tell the suite who did it. */
function change(id: string, patch: store.IssuePatch, actorId: string | null, via?: string) {
  const cur = store.getIssue(id)!;
  const issue = store.updateIssue(id, patch)!;
  const changed = Object.keys(patch);
  emit(live(issue), "issue.updated", { issue, changed, previous: Object.fromEntries(changed.map((k) => [k, cur[k as keyof typeof cur]])), ...(via ? { via } : {}) }, actorId);
  return issue;
}

function comment(issueId: string, userId: string, body: string) {
  const issue = store.getIssue(issueId)!;
  const c = store.addComment(issueId, userId, body);
  emit(live(issue), "issue.commented", { issue: { id: issue.id, ref: issue.ref, title: issue.title }, comment: c }, userId);
}

describe("notifications", () => {
  it("prévient la personne à qui on attribue un ticket, en direct, mais jamais soi-même", () => {
    const { ana, bob, project } = setup();
    const issue = store.createIssue(project.id, { title: "Page d'accueil", assigneeId: bob.id }, ana.id);
    emit(live(issue), "issue.created", { issue }, ana.id);
    expect(unreadCount(bob.id)).toBe(1);
    expect(listNotifications(bob.id)[0]).toMatchObject({ kind: "assigned", actor: { name: "Ana Rossi" }, issue: { ref: "WEB-1", projectKey: "WEB" } });
    expect(publish).toHaveBeenCalledWith({ type: "notifications" }, [bob.id]);

    // Saving the same assignee again is not a new assignment, even once read.
    markRead(bob.id, "all");
    change(issue.id, { assigneeId: bob.id }, ana.id);
    expect(listNotifications(bob.id)).toHaveLength(1);
    expect(unreadCount(bob.id)).toBe(0);

    // Ana takes it herself: nothing for her.
    change(issue.id, { assigneeId: ana.id }, ana.id);
    expect(unreadCount(ana.id)).toBe(0);
  });

  it("prévient qui suit un ticket quand son statut change, GitHub compris", () => {
    const { ana, bob, project, status } = setup();
    const issue = store.createIssue(project.id, { title: "Menu", assigneeId: bob.id }, ana.id);
    change(issue.id, { statusId: status("active").id }, bob.id);
    // Ana created it, so she follows it; Bob made the change.
    expect(listNotifications(ana.id)).toHaveLength(1);
    expect(listNotifications(ana.id)[0]).toMatchObject({ kind: "status", actor: { name: "Bob Meier" } });
    expect(unreadCount(bob.id)).toBe(0);

    change(issue.id, { statusId: status("done").id }, null, "github");
    expect(listNotifications(bob.id)[0]).toMatchObject({ kind: "status", actor: null, data: { via: "github" } });
    expect(unreadCount(ana.id)).toBe(2);
  });

  it("ne plus suivre un ticket tient, même pour son créateur", () => {
    const { ana, bob, project, status } = setup();
    const issue = store.createIssue(project.id, { title: "Pied de page" }, ana.id);
    expect(isWatching(issue, ana.id)).toBe(true);
    setWatching(issue.id, ana.id, false);
    expect(isWatching(issue, ana.id)).toBe(false);
    change(issue.id, { statusId: status("active").id }, bob.id);
    expect(unreadCount(ana.id)).toBe(0);
    // Commenting does not follow it back.
    comment(issue.id, ana.id, "Je regarde");
    expect(isWatching(store.getIssue(issue.id)!, ana.id)).toBe(false);
  });

  it("un commentaire fait suivre le ticket et prévient les personnes mentionnées", () => {
    const { ana, bob, project, status } = setup();
    const issue = store.createIssue(project.id, { title: "Logo" }, ana.id);
    comment(issue.id, bob.id, "@Ana tu peux valider ? Écris à ana.rossi@exemple.ch sinon.");
    expect(listNotifications(ana.id)[0]).toMatchObject({ kind: "mentioned", data: { excerpt: expect.stringContaining("tu peux valider") } });
    expect(isWatching(issue, bob.id)).toBe(true);
    change(issue.id, { statusId: status("active").id }, ana.id);
    expect(listNotifications(bob.id)[0]).toMatchObject({ kind: "status" });
  });

  it("corriger un commentaire ne prévient que les personnes nouvellement mentionnées", () => {
    const { ana, bob, project } = setup();
    const cid = store.createUser({ ...account("Cid Roth"), role: "member" })!;
    const issue = store.createIssue(project.id, { title: "Logo" }, ana.id);
    const c = store.addComment(issue.id, ana.id, "@Bob regarde");
    const fix = (body: string) => {
      const prev = store.getComment(c.id)!.body;
      const comment = store.updateComment(c.id, body)!;
      emit(live(issue), "comment.updated", { issue: { id: issue.id, ref: issue.ref, title: issue.title }, comment, previousBody: prev }, ana.id);
      return comment;
    };
    expect(fix("@Bob regarde, et @Cid aussi").editedAt).toEqual(expect.any(String));
    expect(unreadCount(bob.id)).toBe(0);
    expect(listNotifications(cid.id)[0]).toMatchObject({ kind: "mentioned" });
    fix("@Bob @Cid regardez");
    expect(unreadCount(cid.id)).toBe(1);
  });

  it("reconnaît @Nom Complet, et le prénom seulement quand il est unique", () => {
    const { ana, bob } = setup();
    const ann = store.createUser({ ...account("Ana Silva"), role: "member" })!;
    const users = store.listUsers();
    expect(mentionedUsers("merci @Bob", users).map((u) => u.id)).toEqual([bob.id]);
    expect(mentionedUsers("@ana", users)).toEqual([]);
    expect(mentionedUsers("@Ana Silva et @ana rossi", users).map((u) => u.id).sort()).toEqual([ana.id, ann.id].sort());
    expect(mentionedUsers("@Bobby", users)).toEqual([]);
    expect(mentionedUsers("@Bob-Marie", users)).toEqual([]);
    expect(mentionedUsers("bob@exemple.ch", users)).toEqual([]);
  });

  it("une notification lue ne revient pas, et chacun ne lit que les siennes", () => {
    const { ana, bob, project } = setup();
    const issue = store.createIssue(project.id, { title: "A", assigneeId: bob.id }, ana.id);
    emit(live(issue), "issue.created", { issue }, ana.id);
    const [n] = listNotifications(bob.id);
    markRead(ana.id, [n.id]);
    expect(unreadCount(bob.id)).toBe(1);
    markRead(bob.id, [n.id]);
    expect(unreadCount(bob.id)).toBe(0);
    const readAt = listNotifications(bob.id)[0].readAt;
    markRead(bob.id, "all");
    expect(listNotifications(bob.id)[0].readAt).toBe(readAt);
  });

  it("n'envoie d'e-mail qu'à qui l'a demandé", () => {
    const { ana, bob, project } = setup();
    const a = store.createIssue(project.id, { title: "Sans e-mail", assigneeId: bob.id }, ana.id);
    emit(live(a), "issue.created", { issue: a }, ana.id);
    expect(sendMail).not.toHaveBeenCalled();
    setNotifyEmail(bob.id, true);
    const b = store.createIssue(project.id, { title: "Avec e-mail", assigneeId: bob.id }, ana.id);
    emit(live(b), "issue.created", { issue: b }, ana.id);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendMail).mock.calls[0][0]).toBe("bob.meier@exemple.ch");
    expect(vi.mocked(sendMail).mock.calls[0][1]).toBe("WEB-2 · Avec e-mail");
  });

  it("jamais pour un agent IA", () => {
    const { ana, project } = setup();
    const agent = store.createUser({ ...account("Claude"), role: "member" })!;
    store.db().prepare("update users set agent = 1 where id = ?").run(agent.id);
    const issue = store.createIssue(project.id, { title: "Pour l'agent", assigneeId: agent.id }, ana.id);
    emit(live(issue), "issue.created", { issue }, ana.id);
    expect(unreadCount(agent.id)).toBe(0);
  });

  it("rappelle une échéance la veille, une seule fois, dès 8 h en Suisse", () => {
    const { ana, bob, project, status } = setup();
    const due = store.createIssue(project.id, { title: "Demain", assigneeId: bob.id, dueDate: "2026-11-19" }, ana.id);
    store.createIssue(project.id, { title: "Après-demain", assigneeId: bob.id, dueDate: "2026-11-20" }, ana.id);
    const closed = store.createIssue(project.id, { title: "Déjà fini", assigneeId: bob.id, dueDate: "2026-11-19" }, ana.id);
    store.updateIssue(closed.id, { statusId: status("done").id });

    expect(remindDueDates(new Date("2026-11-18T06:30:00Z"))).toBe(0); // 7:30 in Zurich
    expect(remindDueDates(new Date("2026-11-18T08:00:00Z"))).toBe(1);
    expect(listNotifications(bob.id).map((n) => [n.kind, n.issue.id])).toEqual([["due", due.id]]);
    markRead(bob.id, "all");
    expect(remindDueDates(new Date("2026-11-18T15:00:00Z"))).toBe(0);
    expect(unreadCount(bob.id)).toBe(0);
  });
});
