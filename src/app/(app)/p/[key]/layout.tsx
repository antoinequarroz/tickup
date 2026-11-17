import { Suspense } from "react";
import { IssuePanel } from "@/components/issue-panel";
import { ProjectProvider } from "@/components/project-context";
import { ProjectHeader } from "@/components/project-header";

/** Every view of a project (board, list, epics, settings) shares its data, its filters and the ticket panel. */
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ key: string }> }) {
  const { key } = await params;
  return (
    <Suspense>
      <ProjectProvider projectKey={decodeURIComponent(key).toUpperCase()}>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ProjectHeader />
          {children}
          <IssuePanel />
        </div>
      </ProjectProvider>
    </Suspense>
  );
}
