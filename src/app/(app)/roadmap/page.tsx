import { Roadmap } from "@/components/roadmap";
import { PageHeader } from "@/components/ui";

export default function RoadmapPage() {
  return (
    <>
      <PageHeader title="Roadmap" subtitle="Tous tes projets ouverts sur une même frise : leurs epics, leurs sprints et ce qui prend du retard." />
      <Roadmap />
    </>
  );
}
