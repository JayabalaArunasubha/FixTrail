"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";
import { CATEGORIES, LABELS, PRIORITIES, TEAMS } from "@/lib/domain";
import { cx } from "./ui";

const selectCls = "h-9 min-w-0 flex-1 basis-[calc(50%-4px)] sm:flex-none sm:basis-auto rounded-lg border border-line bg-surface px-2.5 text-sm text-ink hover:border-line-strong";

/** Filters live in the URL so views are shareable and the server does the filtering. */
export function IssueFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const first = useRef(true);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    start(() => router.replace(`/issues?${next}`, { scroll: false }));
  };

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => update("q", q.trim()), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on the query text only
  }, [q]);

  const active = ["q", "priority", "category", "team", "status"].some((k) => params.get(k));
  const sel = (key: string, label: string, options: [string, string][]) => (
    <select aria-label={label} className={cx(selectCls, params.get(key) && "border-brand-line bg-brand-soft/50")} value={params.get(key) ?? ""} onChange={(e) => update(key, e.target.value)}>
      <option value="">{label}</option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          type="search"
          aria-label="Search issues"
          placeholder="Search title, description, or location…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-9 text-sm placeholder:text-ink-3 hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
        />
        {pending && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-3" aria-label="Updating" />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {sel("status", "Any status", [["open", "Open"], ["overdue", "Overdue"], ["new", LABELS.status.new], ["triaged", "Triaged"], ["in_progress", "In progress"], ["resolved", "Resolved"]])}
        {sel("priority", "Any priority", PRIORITIES.map((p) => [p, p[0].toUpperCase() + p.slice(1)]))}
        {sel("category", "Any category", CATEGORIES.map((c) => [c, LABELS.category[c]]))}
        {sel("team", "Any team", TEAMS.map((t) => [t, t]))}
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <label htmlFor="sort" className="text-xs text-ink-3">Sort</label>
          <select id="sort" className={selectCls} value={params.get("sort") ?? "severity"} onChange={(e) => update("sort", e.target.value === "severity" ? "" : e.target.value)}>
            <option value="severity">Severity</option>
            <option value="deadline">Deadline</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </div>
        {active && (
          <button
            onClick={() => {
              setQ("");
              start(() => router.replace(params.get("sort") ? `/issues?sort=${params.get("sort")}` : "/issues", { scroll: false }));
            }}
            className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-ink-3 hover:bg-subtle hover:text-ink"
          >
            <X className="size-3.5" aria-hidden /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
