"use client";

import { Check } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type PickerOption = { value: string; label: string; icon?: React.ReactNode; hint?: string };

type Props = {
  options: PickerOption[];
  /** One value, or several with `multiple`. */
  value: string | string[] | null;
  onChange: (value: string | null | string[]) => void;
  multiple?: boolean;
  /** Offer "none" at the top (single choice only). */
  noneLabel?: string;
  placeholder?: string;
  /** The trigger. Receives the open state. */
  children: React.ReactNode;
  className?: string;
  align?: "start" | "end";
  label: string;
};

/**
 * A small popover menu with search, used for every ticket field: status, priority, person, labels, epic, type.
 * Arrows and Enter work; Escape closes.
 */
export function Picker({ options, value, onChange, multiple, noneLabel, placeholder = "Rechercher…", children, className, align = "start", label }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const all: PickerOption[] = !multiple && noneLabel ? [{ value: "", label: noneLabel }, ...options] : options;
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all;
  const selected = new Set(Array.isArray(value) ? value : value ? [value] : [""]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !pop.current || !root.current) return;
    const r = root.current.getBoundingClientRect();
    setUp(r.bottom + pop.current.offsetHeight + 12 > window.innerHeight && r.top > pop.current.offsetHeight);
  }, [open]);

  const choose = (o: PickerOption) => {
    if (multiple) {
      const next = new Set(selected);
      next.delete("");
      if (next.has(o.value)) next.delete(o.value);
      else next.add(o.value);
      onChange([...next]);
    } else {
      onChange(o.value || null);
      setOpen(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && shown[cursor]) {
      e.preventDefault();
      choose(shown[cursor]);
    }
  };

  return (
    <div ref={root} className={cn("relative", className)} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setQuery("");
          setCursor(0);
        }}
        className="press flex w-full min-w-0 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {children}
      </button>
      {open && (
        <div
          ref={pop}
          role="listbox"
          aria-label={label}
          onKeyDown={onKey}
          className={cn(
            "dialog-popup absolute z-50 w-[230px] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-[0_18px_50px_-12px_rgba(0,0,0,0.35)]",
            up ? "bottom-full mb-1.5" : "top-full mt-1.5",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            placeholder={placeholder}
            className="h-9 w-full border-b border-line bg-transparent px-3 text-[13px] outline-none placeholder:text-ink-3"
          />
          <div className="scroll-thin max-h-[260px] overflow-y-auto p-1">
            {shown.map((o, i) => (
              <button
                key={o.value || "none"}
                type="button"
                role="option"
                aria-selected={selected.has(o.value)}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(o)}
                className={cn("flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-ink-2", i === cursor && "bg-ink/[0.05] text-ink")}
              >
                {o.icon && <span className="flex w-4 shrink-0 justify-center">{o.icon}</span>}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="shrink-0 text-[11px] text-ink-3">{o.hint}</span>}
                {selected.has(o.value) && <Check className="size-3.5 shrink-0 text-ink" strokeWidth={2.4} />}
              </button>
            ))}
            {!shown.length && <p className="px-2 py-3 text-center text-[12.5px] text-ink-3">Aucun résultat</p>}
          </div>
        </div>
      )}
    </div>
  );
}
