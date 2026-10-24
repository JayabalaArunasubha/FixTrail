import Link from "next/link";
import { ChevronRight, Clock, MapPin, Users } from "lucide-react";
import { LABELS, type Assessment, type Issue } from "@/lib/domain";
import { effectiveCategory, effectivePriority, isOverdue } from "@/lib/insights";
import { relative } from "@/lib/format";
import { AiStatusBadge, PriorityBadge, SampleTag, StatusBadge, cx } from "./ui";

/** One issue as a list row; stacks on mobile. */
export function IssueRow({ issue, assessment, now, compact }: { issue: Issue; assessment?: Assessment; now: Date; compact?: boolean }) {
  const p = effectivePriority(issue, assessment);
  const category = effectiveCategory(issue, assessment);
  const overdue = isOverdue(issue, now);
  return (
    <li>
      <Link
        href={`/issues/${issue.id}`}
        className={cx(
          "group flex items-start gap-4 px-5 py-3.5 transition-colors hover:bg-subtle/50",
          p.priority === "critical" && issue.status !== "resolved" && "shadow-[inset_3px_0_0_var(--color-critical)]",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-ink group-hover:text-brand-strong sm:truncate">{issue.title}</span>
            {issue.isSample && <SampleTag />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" aria-hidden />
              {issue.building} · {issue.location}
            </span>
            {category && <span>{LABELS.category[category]}</span>}
            {!compact && issue.assignedTeam && (
              <span className="inline-flex items-center gap-1">
                <Users className="size-3" aria-hidden />
                <span className="sr-only">Team:</span>
                {issue.assignedTeam}
              </span>
            )}
            <span>Reported {relative(issue.createdAt, now)}</span>
            {issue.dueAt && issue.status !== "resolved" && (
              <span className={cx("inline-flex items-center gap-1", overdue && "font-medium text-critical")}>
                <Clock className="size-3" aria-hidden />
                {overdue ? `Overdue ${relative(issue.dueAt, now).replace("ago", "")}`.trim() : `Due ${relative(issue.dueAt, now)}`}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-2">
          <PriorityBadge priority={p.priority} suggested={p.source === "human" ? null : p.source} />
          {!compact && <span className="hidden md:inline-flex"><AiStatusBadge status={assessment?.status ?? null} /></span>}
          <StatusBadge status={issue.status} />
          <ChevronRight className="hidden size-4 text-ink-3 sm:block" aria-hidden />
        </div>
      </Link>
    </li>
  );
}
