import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { TEMPLATES } from "@/lib/templates";
import * as store from "./db";

const account = (n: string) => ({ email: `${n}@exemple.ch`, name: n, salt: "s", hash: "h" });

// A fresh database for every test.
beforeEach(() => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tickup-"));
});

function setup(template: "general" | "media" | "software" = "software") {
  const ana = store.createFirstUser(account("Ana"))!;
  const bob = store.createUser({ ...account("Bob"), role: "member" })!;
  const project = store.createProject({ key: "WEB", name: "Site web", template, leadId: ana.id })!;
  return { ana, bob, project, data: store.getProjectData("WEB")! };
}

describe("comptes", () => {
  it("le premier compte est admin, une seule fois, et sert aux scripts de l'API", () => {
    const first = store.createFirstUser(account("Ana"))!;
    expect(first.role).toBe("admin");
    expect(store.createFirstUser(account("Intrus"))).toBeNull();
    store.createUser({ ...account("Bob"), role: "member" });
    expect(store.firstAdmin()?.id).toBe(first.id);
  });
});

describe("projets", () => {
  it("chaque style de projet crée ses statuts, ses types, ses étiquettes et ses epics", () => {
    const ana = store.createFirstUser(account("Ana"))!;
    for (const [i, t] of TEMPLATES.entries()) {
      const p = store.createProject({ key: `P${i}X`, name: t.name, template: t.id, leadId: ana.id })!;
      const data = store.getProjectData(p.key)!;
      expect(data.statuses.map((s) => s.name)).toEqual(t.statuses.map((s) => s.name));
      expect(data.types.map((s) => s.name)).toEqual(t.types.map((s) => s.name));
      expect(data.labels).toHaveLength(t.labels.length);
      expect(data.epics.map((e) => e.name).sort()).toEqual([...t.epics].sort());
    }
  });

  it("refuse une clé déjà prise", () => {
    const { ana } = setup();
    expect(store.createProject({ key: "WEB", name: "Autre", template: "general", leadId: ana.id })).toBeNull();
  });

  it("se retrouve par sa clé, en minuscules aussi", () => {
    const { project } = setup();
    expect(store.getProject("web")?.id).toBe(project.id);
  });
});

describe("tickets", () => {
  it("sont numérotés par projet, sans jamais réutiliser un numéro", () => {
    const { project, ana } = setup();
    const a = store.createIssue(project.id, { title: "Un" }, ana.id);
    const b = store.createIssue(project.id, { title: "Deux" }, ana.id);
    expect([a.ref, b.ref]).toEqual(["WEB-1", "WEB-2"]);
    store.deleteIssue(b.id);
    expect(store.createIssue(project.id, { title: "Trois" }, ana.id).ref).toBe("WEB-3");
    expect(store.getIssue("web-1")?.id).toBe(a.id);
  });

  it("arrivent dans le premier statut « À faire » et en bas de la colonne", () => {
    const { project, ana, data } = setup();
    const a = store.createIssue(project.id, { title: "Un" }, ana.id);
    const b = store.createIssue(project.id, { title: "Deux" }, ana.id);
    expect(data.statuses.find((s) => s.id === a.statusId)?.category).toBe("todo");
    expect(b.position).toBeGreaterThan(a.position);
  });

  it("gardent leurs étiquettes, et les changent d'un coup", () => {
    const { project, ana, data } = setup();
    const [l1, l2, l3] = data.labels;
    const a = store.createIssue(project.id, { title: "Un", labelIds: [l1.id, l2.id] }, ana.id);
    expect(a.labelIds.sort()).toEqual([l1.id, l2.id].sort());
    expect(store.updateIssue(a.id, { labelIds: [l3.id] })!.labelIds).toEqual([l3.id]);
  });

  it("notent la date de fin en passant à « Terminé », et l'oublient en revenant", () => {
    const { project, ana, data } = setup();
    const done = data.statuses.find((s) => s.category === "done")!;
    const todo = data.statuses.find((s) => s.category === "todo")!;
    const a = store.createIssue(project.id, { title: "Un" }, ana.id);
    expect(a.completedAt).toBeNull();
    const closed = store.updateIssue(a.id, { statusId: done.id })!;
    expect(closed.completedAt).not.toBeNull();
    expect(store.updateIssue(a.id, { statusId: todo.id })!.completedAt).toBeNull();
  });

  it("passent en bas de la nouvelle colonne quand ils changent de statut sans position", () => {
    const { project, ana, data } = setup();
    const active = data.statuses.find((s) => s.category === "active")!;
    const there = store.createIssue(project.id, { title: "Déjà là", statusId: active.id }, ana.id);
    const moved = store.updateIssue(store.createIssue(project.id, { title: "Bouge" }, ana.id).id, { statusId: active.id })!;
    expect(moved.position).toBeGreaterThan(there.position);
  });
});

describe("sous-tickets", () => {
  it("héritent de l'epic du parent et sont comptés sur lui", () => {
    const { project, ana, data } = setup("media");
    const epic = data.epics[0];
    const done = data.statuses.find((s) => s.category === "done")!;
    const parent = store.createIssue(project.id, { title: "Clip", epicId: epic.id }, ana.id);
    const sub = store.createIssue(project.id, { title: "Montage", parentId: parent.id }, ana.id);
    store.createIssue(project.id, { title: "Étalonnage", parentId: parent.id }, ana.id);
    expect(sub.epicId).toBe(epic.id);
    store.updateIssue(sub.id, { statusId: done.id });
    const p = store.getIssue(parent.id)!;
    expect([p.subDone, p.subCount]).toEqual([1, 2]);
    expect(store.listSubIssues(parent.id).map((s) => s.title)).toEqual(["Montage", "Étalonnage"]);
  });

  it("ne peuvent pas former une boucle", () => {
    const { project, ana } = setup();
    const a = store.createIssue(project.id, { title: "A" }, ana.id);
    const b = store.createIssue(project.id, { title: "B", parentId: a.id }, ana.id);
    const c = store.createIssue(project.id, { title: "C", parentId: b.id }, ana.id);
    expect(store.wouldLoop(a.id, c.id)).toBe(true);
    expect(store.wouldLoop(a.id, a.id)).toBe(true);
    expect(store.wouldLoop(c.id, a.id)).toBe(false);
  });

  it("disparaissent avec leur parent", () => {
    const { project, ana } = setup();
    const a = store.createIssue(project.id, { title: "A" }, ana.id);
    const b = store.createIssue(project.id, { title: "B", parentId: a.id }, ana.id);
    store.deleteIssue(a.id);
    expect(store.getIssue(b.id)).toBeNull();
  });
});

describe("statuts et epics", () => {
  it("supprimer un statut déplace ses tickets", () => {
    const { project, ana, data } = setup();
    const [first, second] = data.statuses;
    const a = store.createIssue(project.id, { title: "A", statusId: first.id }, ana.id);
    expect(store.deleteStatus(first.id, first.id)).toBe(false);
    expect(store.deleteStatus(first.id, second.id)).toBe(true);
    expect(store.getIssue(a.id)!.statusId).toBe(second.id);
  });

  it("l'avancement d'une epic compte ses tickets terminés", () => {
    const { project, ana, data } = setup();
    const epicId = store.addEpic(project.id, { name: "Refonte", targetDate: "2027-03-01" });
    const done = data.statuses.find((s) => s.category === "done")!;
    store.createIssue(project.id, { title: "A", epicId }, ana.id);
    store.createIssue(project.id, { title: "B", epicId, statusId: done.id }, ana.id);
    const epic = store.listEpics(project.id).find((e) => e.id === epicId)!;
    expect([epic.doneCount, epic.issueCount, epic.targetDate]).toEqual([1, 2, "2027-03-01"]);
    store.deleteEpic(epicId);
    expect(store.listIssues(project.id).every((i) => i.epicId === null)).toBe(true);
  });

  it("« Mes tickets » ne garde que les tickets ouverts des projets actifs", () => {
    const { project, ana, bob, data } = setup();
    const done = data.statuses.find((s) => s.category === "done")!;
    store.createIssue(project.id, { title: "Ouvert", assigneeId: bob.id }, ana.id);
    store.createIssue(project.id, { title: "Fini", assigneeId: bob.id, statusId: done.id }, ana.id);
    expect(store.listAssigned(bob.id).map((i) => i.title)).toEqual(["Ouvert"]);
    store.updateProject(project.id, { archived: true });
    expect(store.listAssigned(bob.id)).toEqual([]);
  });
});
