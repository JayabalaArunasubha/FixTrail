import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { AlertOctagon, ArrowUp, Equal, ArrowDown, ShieldAlert, Sparkles } from "lucide-react";
import { LABELS, type AssessmentStatus, type Priority, type Status } from "@/lib/domain";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------- Buttons ----------

const BTN = {
  base: "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55 whitespace-nowrap",
  primary: "bg-brand text-white hover:bg-brand-strong shadow-card",
  secondary: "bg-surface text-ink border border-line hover:border-line-strong hover:bg-subtle/60",
  ghost: "text-ink-2 hover:text-ink hover:bg-subtle",
  danger: "bg-critical text-white hover:bg-[#93190f]",
  sm: "h-8 px-3",
  md: "h-10 px-4",
};

export function buttonClass(variant: "primary" | "secondary" | "ghost" | "danger" = "primary", size: "sm" | "md" = "md") {
  return cx(BTN.base, BTN[variant], BTN[size]);
}

export function ButtonLink({ variant, size, className, ...props }: ComponentProps<typeof Link> & { variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md" }) {
  return <Link {...props} className={cx(buttonClass(variant, size), className)} />;
}

// ---------- Surfaces ----------

export function Card({ className, children, ...props }: ComponentProps<"section">) {
  return (
    <section {...props} className={cx("rounded-xl border border-line bg-surface shadow-card", className)}>
      {children}
    </section>
  );
}

export function CardHeader({ title, description, action, icon }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          {icon}
          {title}
        </h2>
        {description && <p className="mt-0.5 text-sm text-ink-3">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, action, eyebrow }: { title: string; description?: ReactNode; action?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-3">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-2">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-subtle text-ink-3">{icon}</div>
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-3">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------- Badges ----------

const PRIORITY_STYLE: Record<Priority, { cls: string; icon: ReactNode }> = {
  critical: { cls: "bg-critical-soft text-critical border-critical-line", icon: <AlertOctagon className="size-3.5" aria-hidden /> },
  high: { cls: "bg-high-soft text-high border-high-line", icon: <ArrowUp className="size-3.5" aria-hidden /> },
  medium: { cls: "bg-medium-soft text-medium border-medium-line", icon: <Equal className="size-3.5" aria-hidden /> },
  low: { cls: "bg-low-soft text-low border-low-line", icon: <ArrowDown className="size-3.5" aria-hidden /> },
};

export function PriorityBadge({ priority, suggested }: { priority: Priority | null; suggested?: "ai" | "rule" | null }) {
  if (!priority) return <span className="inline-flex h-6 items-center rounded-md border border-dashed border-line-strong px-2 text-xs text-ink-3">Untriaged</span>;
  const s = PRIORITY_STYLE[priority];
  return (
    <span
      className={cx("inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs font-medium capitalize", s.cls, suggested && "border-dashed")}
      title={suggested === "ai" ? "Gemma suggestion, not yet approved by staff" : suggested === "rule" ? "Safety-rule minimum, not yet approved by staff" : "Staff-approved priority"}
    >
      {s.icon}
      {priority}
      {suggested && (
        <>
          {suggested === "ai" ? <Sparkles className="size-3 opacity-70" aria-hidden /> : <ShieldAlert className="size-3 opacity-70" aria-hidden />}
          <span className="sr-only">{suggested === "ai" ? "(AI suggested, not approved)" : "(safety rule minimum, not approved)"}</span>
        </>
      )}
    </span>
  );
}

const STATUS_STYLE: Record<Status, string> = {
  new: "bg-surface text-ink-2 border-line-strong",
  triaged: "bg-steel-soft text-steel border-medium-line",
  in_progress: "bg-brand-soft text-brand-strong border-brand-line",
  resolved: "bg-subtle text-ink-3 border-line",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium", STATUS_STYLE[status])}>
      <span className={cx("size-1.5 rounded-full", status === "new" ? "bg-ink-3" : status === "triaged" ? "bg-steel" : status === "in_progress" ? "bg-brand" : "bg-line-strong")} />
      {LABELS.status[status]}
    </span>
  );
}

export function AiStatusBadge({ status }: { status: AssessmentStatus | null }) {
  const map = {
    pending: ["Assessing", "bg-steel-soft text-steel border-medium-line"],
    succeeded: ["Assessed", "bg-brand-soft text-brand-strong border-brand-line"],
    failed: ["AI failed", "bg-high-soft text-high border-high-line"],
    none: ["Not assessed", "bg-surface text-ink-3 border-line"],
  } as const;
  const [label, cls] = map[status ?? "none"];
  return (
    <span className={cx("inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs font-medium", cls)}>
      <Sparkles className="size-3" aria-hidden />
      {label}
    </span>
  );
}

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex h-6 items-center rounded-md bg-subtle px-2 text-xs text-ink-2", className)}>{children}</span>;
}

export function SampleTag() {
  return (
    <span className="inline-flex h-5 items-center rounded border border-dashed border-line-strong px-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3" title="Illustrative demo record">
      Sample
    </span>
  );
}

// ---------- Forms ----------

export const inputClass =
  "block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 transition-colors hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 aria-[invalid=true]:border-critical";

export function Field({ label, htmlFor, hint, error, optional, children }: { label: string; htmlFor: string; hint?: ReactNode; error?: string; optional?: boolean; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between text-sm font-medium text-ink">
        {label}
        {optional && <span className="text-xs font-normal text-ink-3">Optional</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1.5 text-xs text-critical" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-ink-3">{hint}</p>
      )}
    </div>
  );
}

export function Alert({ tone = "info", title, children, icon }: { tone?: "info" | "warn" | "danger" | "success"; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  const cls = {
    info: "border-medium-line bg-medium-soft text-medium",
    warn: "border-high-line bg-high-soft text-high",
    danger: "border-critical-line bg-critical-soft text-critical",
    success: "border-brand-line bg-brand-soft text-brand-strong",
  }[tone];
  return (
    <div className={cx("flex gap-3 rounded-lg border px-4 py-3 text-sm", cls)} role={tone === "danger" ? "alert" : "status"}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cx("text-ink-2", title ? "mt-0.5" : null)}>{children}</div>}
      </div>
    </div>
  );
}
