"use client";

import { AtSign, CalendarClock, CircleDot, UserPlus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, PageHeader } from "@/components/ui";
import { notificationText } from "@/lib/notifications";
import { useApp } from "@/lib/store";
import type { Notification, NotificationKind } from "@/lib/types";
import { api, cn, relative } from "@/lib/utils";

const ICONS: Record<NotificationKind, typeof AtSign> = { assigned: UserPlus, mentioned: AtSign, status: CircleDot, due: CalendarClock };

/** What concerns me: assigned, mentioned, a followed ticket that moved, a due date tomorrow. */
export default function NotificationsPage() {
  const { listen, unreadNotifications } = useApp();
  const [items, setItems] = useState<Notification[] | null>(null);
  const load = useCallback(() => api<{ notifications: Notification[] }>("/api/notifications").then((r) => setItems(r.notifications), () => setItems([])), []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => listen((e) => (e.type === "notifications" || e.type === "resync" ? void load() : undefined)), [listen, load]);

  const read = async (ids: string[] | "all") => {
    // Read at once on screen; the server confirms through the live event.
    setItems((cur) => cur?.map((n) => (ids === "all" || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)) ?? cur);
    try {
      await api("/api/notifications/read", { method: "POST", json: ids === "all" ? { all: true } : { ids } });
    } catch (e) {
      toast.error((e as Error).message);
      void load();
    }
  };

  const unread = items?.filter((n) => !n.readAt).length ?? unreadNotifications;

  return (
    <>
      <PageHeader title="Notifications" subtitle={items ? (unread ? `${unread} non lue${unread > 1 ? "s" : ""}` : items.length ? "Tout est lu" : undefined) : undefined}>
        {unread > 0 && (
          <Button size="sm" onClick={() => read("all")}>
            Tout marquer comme lu
          </Button>
        )}
      </PageHeader>
      <div className="scroll-thin flex-1 overflow-y-auto pb-10">
        {items && !items.length && (
          <div className="flex flex-col items-center gap-2 p-16 text-center">
            <p className="font-display text-[24px]">Rien de neuf</p>
            <p className="max-w-[420px] text-[13px] text-ink-3">Tu seras prévenu ici quand on t&apos;attribue un ticket, qu&apos;on te mentionne avec @, qu&apos;un ticket que tu suis change de statut, et la veille d&apos;une échéance.</p>
          </div>
        )}
        {items?.map((n) => {
          const Icon = ICONS[n.kind];
          return (
            <Link
              key={n.id}
              href={`/p/${n.issue.projectKey}?issue=${n.issue.ref}`}
              onClick={() => !n.readAt && void read([n.id])}
              className={cn("flex items-start gap-3 border-b border-line px-7 py-3 text-[13px] hover:bg-ink/[0.025] max-md:px-4", n.readAt && "text-ink-3")}
            >
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} aria-hidden />
              <Icon className={cn("mt-0.5 size-4 shrink-0", n.readAt ? "text-ink-3" : "text-ink")} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="shrink-0 font-mono text-[11.5px] text-ink-3">{n.issue.ref}</span>
                  <span className={cn("truncate", !n.readAt && "font-medium text-ink")}>{n.issue.title}</span>
                </span>
                <span className="mt-0.5 block text-[12.5px] text-ink-2">{notificationText(n)}</span>
                {n.data.excerpt && <span className="mt-1 block truncate text-[12.5px] text-ink-3">« {n.data.excerpt} »</span>}
              </span>
              <span className="shrink-0 text-[11.5px] text-ink-3">{relative(n.createdAt)}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
