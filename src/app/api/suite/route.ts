import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * What TickUp says about itself to the other tools of the suite (Cordée reads it to show the module).
 * Public on purpose: it holds no data, only the description and the shape of the API.
 */
export function GET() {
  return NextResponse.json({
    id: "projets",
    name: "TickUp",
    role: "Gestion de projet",
    description: "Projets, epics, tickets et sous-tickets, kanban et liste, pour la vidéo comme pour le code.",
    icon: "projects",
    version: "0.1.0",
    auth: "Authorization: Bearer <API_TOKEN>",
    api: {
      projects: "GET|POST /api/projects",
      project: "GET|PATCH|DELETE /api/projects/{KEY}",
      issues: "GET|POST /api/projects/{KEY}/issues",
      issue: "GET|PATCH|DELETE /api/issues/{id|KEY-12}",
      comments: "POST /api/issues/{id|KEY-12}/comments",
      epics: "POST /api/projects/{KEY}/epics, PATCH|DELETE /api/epics/{id}",
      mine: "GET /api/my-issues",
    },
    events: ["project.created", "project.updated", "project.deleted", "issue.created", "issue.updated", "issue.deleted", "issue.commented", "comment.updated", "epic.created", "epic.updated", "epic.deleted"],
  });
}
