import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { branchName, branchRef, closingRefsIn, refsIn } from "@/lib/github";
import * as store from "./db";
import { handleGithub, validSignature } from "./github";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tickup-gh-"));
});

function setup() {
  const ana = store.createFirstUser({ email: "ana@exemple.ch", name: "Ana", salt: "s", hash: "h" })!;
  const project = store.createProject({ key: "WEB", name: "Site", template: "software", leadId: ana.id })!;
  const data = store.getProjectData("WEB")!;
  const todo = data.statuses.find((s) => s.category === "todo")!;
  const mk = (title: string) => store.createIssue(project.id, { title, statusId: todo.id }, ana.id);
  return { project, data, a: mk("Un"), b: mk("Deux"), c: mk("Trois") };
}
const cat = (id: string) => store.categoryOfStatus(store.getIssue(id)!.statusId);
const repository = { full_name: "ana/site", html_url: "https://github.com/ana/site", default_branch: "main" };
const pr = (over: Record<string, unknown>, action = "opened") => ({ action, repository, pull_request: { number: 7, html_url: "https://github.com/ana/site/pull/7", title: "Galerie", body: "", state: "open", draft: false, merged: false, head: { ref: "feature" }, user: { login: "ana" }, ...over } });

describe("références", () => {
  it("trouve les tickets dans un texte, sans se tromper sur les mots voisins", () => {
    expect(refsIn("WEB-12: galerie (WEB-12), voir POD-3 et abcdefWEB-9, utf-8, top-10, WEB-12a, WEB-3.2, CVE-2024-123, v-WEB-5, x/WEB-6")).toEqual(["WEB-12", "POD-3"]);
    expect(refsIn("web-12 en minuscules")).toEqual([]);
    expect(branchRef("ana/web-12-galerie-web-13")).toBe("WEB-12");
    expect(branchRef("main")).toBeNull();
    expect(refsIn(null)).toEqual([]);
  });
  it("ne ferme que ce qui suit un mot de fermeture", () => {
    expect(closingRefsIn("Fixes WEB-1, WEB-2 and WEB-3. See WEB-4. closes: WEB-5\nCorrige WEB-6 et WEB-7. prefix WEB-8. bug-fix WEB-9. Fixes\nWEB-10. fixes WEB-11a")).toEqual(["WEB-1", "WEB-2", "WEB-3", "WEB-5", "WEB-6", "WEB-7"]);
  });
  it("reste rapide sur un texte fait pour le ralentir", () => {
    const start = performance.now();
    for (const filler of [" ", "\n", "\t", ", "]) {
      closingRefsIn(`WEB-1 fix${filler.repeat(10_000)}x`);
      refsIn(`A${"-".repeat(10_000)}1 ${"AB-".repeat(5_000)}`);
    }
    expect(performance.now() - start).toBeLessThan(200);
  });
  it("propose un nom de branche", () => {
    expect(branchName("WEB-12", "Page « fiche bien » : galerie d'été !")).toBe("web-12-page-fiche-bien-galerie-d-ete");
    expect(branchName("WEB-1", "???")).toBe("web-1");
    // Another ticket named in the title must not end up in the branch name.
    expect(branchRef(branchName("WEB-1", "Suite de WEB-2 : nettoyage"))).toBe("WEB-1");
    expect(branchName("WEB-1", "Suite de WEB-2 : nettoyage")).toBe("web-1-suite-de-nettoyage");
  });
});

describe("signature", () => {
  it("accepte la signature de GitHub et refuse le reste", () => {
    const body = '{"zen":"ok"}';
    const sig = `sha256=${crypto.createHmac("sha256", "un-secret-assez-long").update(body).digest("hex")}`;
    expect(validSignature("un-secret-assez-long", body, sig)).toBe(true);
    expect(validSignature("un-secret-assez-long", body + " ", sig)).toBe(false);
    expect(validSignature("autre-secret-assez-long", body, sig)).toBe(false);
    expect(validSignature("un-secret-assez-long", body, null)).toBe(false);
    expect(validSignature("un-secret-assez-long", body, "sha256=abc")).toBe(false);
  });
});

describe("pull requests", () => {
  it("une PR ouverte démarre le ticket nommé, la fusion le termine, une simple mention ne bouge rien", () => {
    const { a, b, c } = setup();
    let r = handleGithub("pull_request", pr({ title: "Galerie", head: { ref: "ana/web-1-galerie" }, body: "Fixes WEB-2. Voir aussi WEB-3 et WEB-99." }));
    expect(r.linked.sort()).toEqual(["WEB-1", "WEB-2", "WEB-3"]);
    expect(r.moved.sort()).toEqual(["WEB-1", "WEB-2"]);
    expect([cat(a.id), cat(b.id), cat(c.id)]).toEqual(["active", "active", "todo"]);
    expect(store.listGithubLinks(a.id)).toMatchObject([{ kind: "pr", repo: "ana/site", ref: "7", state: "open", title: "Galerie", author: "ana" }]);

    r = handleGithub("pull_request", pr({ title: "WEB-1 Galerie", head: { ref: "ana/web-1-galerie" }, body: "Fixes WEB-2. Voir aussi WEB-3.", state: "closed", merged: true }, "closed"));
    expect(r.moved.sort()).toEqual(["WEB-1", "WEB-2"]);
    expect([cat(a.id), cat(b.id), cat(c.id)]).toEqual(["done", "done", "todo"]);
    expect(store.getIssue(a.id)!.completedAt).not.toBeNull();
    expect(store.listGithubLinks(c.id)).toMatchObject([{ state: "merged" }]);
    // The same delivery again changes nothing.
    expect(handleGithub("pull_request", pr({ title: "WEB-1 Galerie", state: "closed", merged: true }, "closed")).moved).toEqual([]);
    expect(store.listGithubLinks(a.id)).toHaveLength(1);
  });

  it("un brouillon ne démarre rien, une PR fermée sans fusion ne termine rien, une PR renommée se détache", () => {
    const { a, b } = setup();
    handleGithub("pull_request", pr({ title: "WEB-1", draft: true }));
    expect(cat(a.id)).toBe("todo");
    expect(store.listGithubLinks(a.id)[0].state).toBe("draft");
    handleGithub("pull_request", pr({ title: "WEB-1" }, "ready_for_review"));
    expect(cat(a.id)).toBe("active");
    handleGithub("pull_request", pr({ title: "WEB-1", state: "closed" }, "closed"));
    expect(cat(a.id)).toBe("active");
    expect(store.listGithubLinks(a.id)[0].state).toBe("closed");
    handleGithub("pull_request", pr({ title: "WEB-2" }, "edited"));
    expect(store.listGithubLinks(a.id)).toEqual([]);
    expect(store.listGithubLinks(b.id)).toHaveLength(1);
    // "edited" attaches but does not start anything.
    expect(cat(b.id)).toBe("todo");
  });

  it("une PR venue d'un fork relie mais ne déplace rien ; une fusion hors de la branche par défaut ne termine rien", () => {
    const { a, b } = setup();
    const fork = { ref: "web-1-truc", repo: { full_name: "inconnu/site" } };
    expect(handleGithub("pull_request", pr({ title: "WEB-1 WEB-2", head: fork })).moved).toEqual([]);
    expect(handleGithub("pull_request", pr({ title: "WEB-1 WEB-2", head: fork, state: "closed", merged: true, base: { ref: "main" } }, "closed")).moved).toEqual([]);
    expect([cat(a.id), cat(b.id)]).toEqual(["todo", "todo"]);
    expect(store.listGithubLinks(a.id)).toHaveLength(1);

    const own = { ref: "web-1-truc", repo: { full_name: "ana/site" } };
    expect(handleGithub("pull_request", pr({ number: 8, html_url: "https://github.com/ana/site/pull/8", title: "Truc", head: own, state: "closed", merged: true, base: { ref: "develop" } }, "closed")).moved).toEqual([]);
    expect(cat(a.id)).toBe("todo");
    expect(handleGithub("pull_request", pr({ number: 9, html_url: "https://github.com/ana/site/pull/9", title: "Truc", head: own, state: "closed", merged: true, base: { ref: "main" } }, "closed")).moved).toEqual(["WEB-1"]);
    expect(cat(a.id)).toBe("done");
  });

  it("ne rouvre pas un ticket terminé et ignore ce qui n'est pas une PR valable", () => {
    const { a, data } = setup();
    store.updateIssue(a.id, { statusId: data.statuses.find((s) => s.category === "done")!.id });
    handleGithub("pull_request", pr({ title: "WEB-1" }));
    expect(cat(a.id)).toBe("done");
    expect(handleGithub("pull_request", { action: "opened", repository, pull_request: { number: "x", html_url: "javascript:alert(1)" } }).ignored).toBe("pull_request");
    expect(handleGithub("pull_request", pr({ title: "WEB-1", html_url: "http://exemple.ch" })).ignored).toBe("pull_request");
    expect(handleGithub("issues", { repository }).ignored).toBe("event");
    expect(handleGithub("ping", { zen: "ok" }).ignored).toBeUndefined();
    expect(handleGithub("push", null).ignored).toBe("payload");
  });
});

describe("pushes", () => {
  const commit = (id: string, message: string, over = {}) => ({ id: id.padEnd(40, "0"), message, url: `https://github.com/ana/site/commit/${id}`, distinct: true, author: { username: "ana" }, ...over });
  it("rattache branche et commits ; un mot de fermeture ne termine que sur la branche par défaut", () => {
    const { a, b, c } = setup();
    let r = handleGithub("push", { ref: "refs/heads/ana/web-1-galerie", repository, pusher: { name: "ana" }, commits: [commit("abc1234", "Fixes WEB-2 : le filtre\n\ndétail"), commit("def5678", "refactor", { distinct: false })] });
    expect(r.linked.sort()).toEqual(["WEB-1", "WEB-2"]);
    expect(r.moved).toEqual([]);
    expect(cat(b.id)).toBe("todo");
    expect(store.listGithubLinks(a.id)).toMatchObject([{ kind: "branch", ref: "ana/web-1-galerie", url: "https://github.com/ana/site/tree/ana/web-1-galerie" }]);
    expect(store.listGithubLinks(b.id)).toMatchObject([{ kind: "commit", ref: "abc1234", title: "Fixes WEB-2 : le filtre" }]);

    r = handleGithub("push", { ref: "refs/heads/main", repository, commits: [commit("abc1234", "Fixes WEB-2 : le filtre"), commit("9999999", "voir WEB-3")] });
    expect(r.moved).toEqual(["WEB-2"]);
    expect([cat(b.id), cat(c.id)]).toEqual(["done", "todo"]);
    expect(store.listGithubLinks(b.id)).toHaveLength(1);
    expect(handleGithub("push", { ref: "refs/tags/v1", repository, commits: [commit("aaaaaaa", "Fixes WEB-3")] }).ignored).toBe("ref");
    expect(cat(c.id)).toBe("todo");
    // A fast-forward of main brings commits GitHub already saw on the branch: their closing words apply now.
    expect(handleGithub("push", { ref: "refs/heads/main", repository, commits: [commit("bbbbbbb", "Fixes WEB-3", { distinct: false })] }).moved).toEqual(["WEB-3"]);
    expect(cat(c.id)).toBe("done");
    // Deleting the branch removes its line.
    handleGithub("push", { ref: "refs/heads/ana/web-1-galerie", repository, deleted: true, commits: [] });
    expect(store.listGithubLinks(a.id)).toEqual([]);
  });

  it("ne garde que les derniers commits d'un ticket", () => {
    const { a } = setup();
    for (let n = 0; n < 60; n++) handleGithub("push", { ref: "refs/heads/dev", repository, commits: [commit(`c${String(n).padStart(6, "0")}`, `WEB-1 étape ${n}`)] });
    const links = store.listGithubLinks(a.id);
    expect(links).toHaveLength(50);
    expect(links.some((l) => l.title === "WEB-1 étape 59")).toBe(true);
    expect(links.some((l) => l.title === "WEB-1 étape 0")).toBe(false);
  });
});
