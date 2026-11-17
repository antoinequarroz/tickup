import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { currentUser } from "@/server/auth";

export const dynamic = "force-dynamic";

/** Everything in here is private: no session, no page. The API routes check the session themselves. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await currentUser())) redirect("/login");
  return <AppShell>{children}</AppShell>;
}
