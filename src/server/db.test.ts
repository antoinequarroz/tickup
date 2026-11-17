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
    expect(store.getIssue(a.id)?.ref).toBe("WEB-1");
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

  it("supprimer un statut range ses tickets sous ceux de la cible et met à jour la date de fin", () => {
    const { project, ana, data } = setup();
    const todo = data.statuses.find((s) => s.category === "todo")!;
    const done = data.statuses.find((s) => s.category === "done")!;
    const there = store.createIssue(project.id, { title: "Déjà fini", statusId: done.id }, ana.id);
    const a = store.createIssue(project.id, { title: "A", statusId: todo.id }, ana.id);
    const b = store.createIssue(project.id, { title: "B", statusId: todo.id }, ana.id);
    expect(store.deleteStatus(todo.id, done.id)).toBe(true);
    const [ia, ib] = [store.getIssue(a.id)!, store.getIssue(b.id)!];
    expect(ia.completedAt).not.toBeNull();
    expect(there.position).toBeLessThan(ia.position);
    expect(ia.position).toBeLessThan(ib.position);
  });

  it("changer la catégorie d'un statut ferme ou rouvre ses tickets", () => {
    const { project, ana, data } = setup();
    const todo = data.statuses.find((s) => s.category === "todo")!;
    const a = store.createIssue(project.id, { title: "A", statusId: todo.id }, ana.id);
    store.updateStatus(todo.id, { category: "done" });
    expect(store.getIssue(a.id)!.completedAt).not.toBeNull();
    store.updateStatus(todo.id, { category: "active" });
    expect(store.getIssue(a.id)!.completedAt).toBeNull();
  });

  it("l'ordre des statuts se change d'un coup, et seulement avec la liste complète", () => {
    const { project, data } = setup();
    const ids = data.statuses.map((s) => s.id);
    const reversed = [...ids].reverse();
    expect(store.reorderStatuses(project.id, ids.slice(1))).toBe(false);
    expect(store.reorderStatuses(project.id, [ids[0], ...ids.slice(0, -1)])).toBe(false);
    expect(store.reorderStatuses(project.id, reversed)).toBe(true);
    expect(store.listStatuses(project.id).map((s) => s.id)).toEqual(reversed);
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

describe("dépendances", () => {
  it("un ticket connaît ceux qui le bloquent et ceux qu'il bloque, sans boucle possible", () => {
    const { ana, project } = setup();
    const [a, b, c] = ["A", "B", "C"].map((title) => store.createIssue(project.id, { title }, ana.id));
    store.addLink(a.id, b.id);
    store.addLink(b.id, c.id);
    store.addLink(a.id, b.id);
    expect(store.getIssue(b.id)!.blockedBy).toEqual([a.id]);
    expect(store.getIssue(b.id)!.blocks).toEqual([c.id]);
    expect(store.wouldBlockLoop(a.id, a.id)).toBe(true);
    expect(store.wouldBlockLoop(c.id, a.id)).toBe(true);
    expect(store.wouldBlockLoop(b.id, a.id)).toBe(true);
    expect(store.wouldBlockLoop(a.id, c.id)).toBe(false);
    store.removeLink(a.id, b.id);
    expect(store.getIssue(b.id)!.blockedBy).toEqual([]);
    store.deleteIssue(c.id);
    expect(store.getIssue(b.id)!.blocks).toEqual([]);
  });
});

describe("sprints", () => {
  it("compte ses tickets et ses points, et un seul sprint est en cours à la fois", () => {
    const { ana, project, data } = setup();
    const done = data.statuses.find((s) => s.category === "done")!;
    const s1 = store.addSprint(project.id, { name: "Sprint 1", startDate: "2026-11-02", endDate: "2026-11-15" });
    const s2 = store.addSprint(project.id, { name: "Sprint 2" });
    const a = store.createIssue(project.id, { title: "A", sprintId: s1.id, estimate: 3 }, ana.id);
    const b = store.createIssue(project.id, { title: "B", sprintId: s1.id, estimate: 5, startDate: "2026-11-03" }, ana.id);
    expect(b.sprintId).toBe(s1.id);
    expect(b.startDate).toBe("2026-11-03");
    store.updateIssue(a.id, { statusId: done.id });
    expect(store.getSprint(s1.id)).toMatchObject({ issueCount: 2, doneCount: 1, points: 8, pointsDone: 3, state: "planned" });

    expect(store.updateSprint(s1.id, { state: "active" })).toMatchObject({ state: "active" });
    expect(store.updateSprint(s2.id, { state: "active" })).toBe("busy");
    expect(store.listSprints(project.id).map((s) => s.name)).toEqual(["Sprint 1", "Sprint 2"]);

    // Finishing sends what is still open to the next sprint; what is done stays.
    store.updateSprint(s1.id, { state: "done", moveOpenTo: s2.id });
    expect(store.getIssue(a.id)!.sprintId).toBe(s1.id);
    expect(store.getIssue(b.id)!.sprintId).toBe(s2.id);
    expect(store.updateSprint(s2.id, { state: "active" })).toMatchObject({ state: "active", issueCount: 1 });

    store.deleteSprint(s2.id);
    expect(store.getIssue(b.id)!.sprintId).toBeNull();
    expect(store.getProjectData("WEB")!.sprints.map((s) => s.name)).toEqual(["Sprint 1"]);
  });

  it("la roadmap rassemble les epics et les sprints des projets ouverts", () => {
    const { ana, project } = setup();
    store.addSprint(project.id, { name: "Sprint 1" });
    store.addEpic(project.id, { name: "Refonte", startDate: "2026-11-01", targetDate: "2026-12-15" });
    const other = store.createProject({ key: "OLD", name: "Ancien", template: "general", leadId: ana.id })!;
    store.updateProject(other.id, { archived: true });
    const roadmap = store.listRoadmap();
    expect(roadmap.map((r) => r.project.key)).toEqual(["WEB"]);
    expect(roadmap[0].sprints).toHaveLength(1);
    expect(roadmap[0].epics.map((e) => e.name)).toContain("Refonte");
  });
});
