import { ArrowRightLeft, CheckCircle2, CircleDot, FilePlus2, MessageSquare, RotateCcw, Sparkles, UserCheck, XCircle, ShieldAlert } from "lucide-react";
import type { Activity } from "@/lib/domain";
import { dateTime, relative, titleCase } from "@/lib/format";

const s = (v: unknown) => (typeof v === "string" ? v : "");

/** AI outcomes are attributed to the model; the requesting person is on the preceding "requested" event. */
export const actorLabel = (a: Activity) => (a.actionType === "ai_succeeded" || a.actionType === "ai_failed" ? "Gemma 4" : a.actorName);

export function describeActivity(a: Activity): string {
  const d = a.details;
  const final = d.final as { priority?: string; team?: string } | undefined;
  switch (a.actionType) {
    case "created": return "reported this issue";
    case "ai_requested": return `requested a Gemma assessment`;
    case "ai_succeeded": return `recommended ${s(d.finalPriority) || s(d.modelPriority)} priority${d.safetyOverrideApplied ? " (raised by a safety rule)" : ""}`;
    case "ai_failed": return "could not complete the assessment";
    case "decision_accepted": return `accepted the AI recommendation: ${s(final?.priority)}, ${s(final?.team)}`;
    case "decision_overridden": return `overrode the AI recommendation → ${s(final?.priority)}, ${s(final?.team)}`;
    case "decision_manual": return `triaged manually: ${s(final?.priority) || s(d.priority)}, ${s(final?.team) || s(d.team)}`;
    case "assigned": return `reassigned to ${s((d.to as { team?: string })?.team)}`;
    case "status_changed": return `moved to ${titleCase(s(d.to))}`;
    case "resolved": return "marked this resolved";
    case "reopened": return "reopened this issue";
    case "note": return "added a note";
    default: return titleCase(a.actionType);
  }
}

const ICONS: Record<string, typeof CircleDot> = {
  created: FilePlus2,
  ai_requested: Sparkles,
  ai_succeeded: Sparkles,
  ai_failed: XCircle,
  decision_accepted: UserCheck,
  decision_overridden: ArrowRightLeft,
  decision_manual: UserCheck,
  assigned: ArrowRightLeft,
  resolved: CheckCircle2,
  reopened: RotateCcw,
  note: MessageSquare,
};

function Detail({ a }: { a: Activity }) {
  const d = a.details;
  const rec = d.aiRecommendation as { priority: string; category: string; team: string } | null | undefined;
  const final = d.final as { priority: string; category: string; team: string } | undefined;
  const quote = (t: string) => <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-subtle px-3 py-2 text-[13px] text-ink-2">{t}</p>;

  if (a.actionType === "decision_overridden" && rec && final) {
    return (
      <div className="mt-1.5 space-y-1.5 text-[13px]">
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-ink-3">
          <span>AI</span>
          <span>{rec.priority} · {rec.category} · {rec.team}</span>
          <span className="text-ink">Final</span>
          <span className="text-ink">{final.priority} · {final.category} · {final.team}</span>
        </div>
        {Boolean(d.belowSafetyFloor) && (
          <p className="flex items-center gap-1 text-xs text-high"><ShieldAlert className="size-3.5" aria-hidden /> Set below a safety-rule minimum</p>
        )}
        {s(d.reason) && quote(`Reason: ${s(d.reason)}`)}
      </div>
    );
  }
  if (a.actionType === "ai_failed") return <p className="mt-1 text-[13px] text-high">{s(d.error)}</p>;
  if (a.actionType === "ai_succeeded" || a.actionType === "decision_accepted")
    return s(d.model) ? <p className="mt-0.5 font-mono text-[11px] text-ink-3">{s(d.model)} · {s(d.promptVersion)}</p> : null;
  if (a.actionType === "note") return quote(s(d.note));
  if (a.actionType === "resolved") return quote(s(d.resolutionNotes));
  if (a.actionType === "reopened") return quote(`Reason: ${s(d.reason)}`);
  if (a.actionType === "decision_manual" && s(d.note)) return <p className="mt-0.5 text-xs text-ink-3">{s(d.note)}</p>;
  if (a.actionType === "decision_manual" && s(d.reason)) return quote(`Reason: ${s(d.reason)}`);
  return null;
}

export function Timeline({ activity, now }: { activity: Activity[]; now: Date }) {
  const items = activity.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return (
    <ol className="relative space-y-5 px-5 py-5">
      <span className="absolute bottom-7 left-[33px] top-7 w-px bg-line" aria-hidden />
      {items.map((a) => {
        const Icon = ICONS[a.actionType] ?? CircleDot;
        const ai = a.actionType.startsWith("ai_");
        return (
          <li key={a.id} className="relative flex gap-3">
            <span className={`relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border bg-surface ${a.actionType === "ai_failed" ? "border-high-line text-high" : ai ? "border-brand-line text-brand" : "border-line text-ink-3"}`}>
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm text-ink-2">
                <span className="font-medium text-ink">{actorLabel(a)}</span> {describeActivity(a)}
              </p>
              <time dateTime={a.createdAt} title={dateTime(a.createdAt)} className="text-xs text-ink-3">
                {dateTime(a.createdAt)} · {relative(a.createdAt, now)}
              </time>
              <Detail a={a} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
