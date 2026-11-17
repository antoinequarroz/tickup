"use client";

import { Gantt } from "@/components/gantt";

/** Planning: the tickets on a time grid, grouped by epic, with their dates and their dependencies. Every ticket is shown, the filters do not apply here. */
export default function TimelinePage() {
  return <Gantt />;
}
