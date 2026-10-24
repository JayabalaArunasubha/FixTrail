"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ListChecks, Repeat2, ShieldCheck, Plus } from "lucide-react";
import { cx } from "./ui";

const LINKS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/issues", label: "Issues", icon: ListChecks },
  { href: "/recurring", label: "Recurring", icon: Repeat2 },
  { href: "/settings", label: "AI & settings", icon: ShieldCheck },
];

const active = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

export function SideNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      <Link
        href="/report"
        className={cx(
          "mb-4 flex h-10 items-center justify-center gap-2 rounded-lg bg-brand text-sm font-medium text-white shadow-card transition-colors hover:bg-brand-strong",
          path === "/report" && "bg-brand-strong",
        )}
      >
        <Plus className="size-4" aria-hidden /> Report an issue
      </Link>
      {LINKS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={active(path, href) ? "page" : undefined}
          className={cx(
            "flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors",
            active(path, href) ? "bg-surface font-medium text-ink shadow-card ring-1 ring-line" : "text-ink-2 hover:bg-subtle hover:text-ink",
          )}
        >
          <Icon className={cx("size-4", active(path, href) ? "text-brand" : "text-ink-3")} aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function MobileNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 lg:hidden">
      {[{ href: "/report", label: "Report", icon: Plus }, ...LINKS].map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={active(path, href) ? "page" : undefined}
          className={cx(
            "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors",
            active(path, href) ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink-2",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}
