import { AlertTriangle, CircleHelp, Clock, Info, ListChecks, Loader2, ShieldAlert, Sparkles, Siren, UserCheck } from "lucide-react";
import { LABELS, type Activity, type Assessment, type Issue } from "@/lib/domain";
import { dateTime, relative, titleCase } from "@/lib/format";
import { Alert, Card, PriorityBadge, Tag, cx } from "./ui";
import { RunAssessmentButton } from "./issue-actions";

const DECISIONS = ["decision_accepted", "decision_overridden", "decision_manual"];

export function latestDecision(activity: Activity[]) {
  return activity.find((a) => DECISIONS.includes(a.actionType)) ?? null; // activity is newest-first
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-3">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

export function AiPanel({ issue, assessments, activity, canRun, now }: { issue: Issue; assessments: Assessment[]; activity: Activity[]; canRun: boolean; now: Date }) {
  const latest = assessments[0];
  const stalePending = latest?.status === "pending" && now.getTime() - Date.parse(latest.createdAt) > 90_000;
  const decision = latestDecision(activity);
  const canRunNow = canRun && issue.status !== "resolved";

  return (
    <Card className="overflow-hidden" aria-labelledby="ai-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-brand-line/60 bg-brand-soft/60 px-5 py-4">
        <div>
          <h2 id="ai-heading" className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Sparkles className="size-4 text-brand" aria-hidden />
            Gemma 4 AI Assessment
          </h2>
          <p className="mt-0.5 text-xs text-ink-2">Decision support only — a recommendation, not a verified inspection.</p>
        </div>
        {latest && (
          <div className="text-right text-xs text-ink-3">
            <div className="font-mono text-[11px] text-ink-2">{latest.modelName}</div>
            <div>
              {latest.promptVersion} · <time dateTime={latest.createdAt}>{dateTime(latest.createdAt)}</time>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-5 px-5 py-5">
        {!latest && (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">
              {issue.isSample
                ? "This is a sample record. No AI assessment was stored, and FixTrail never shows invented model output. You can run a real Gemma assessment now."
                : "No AI assessment has been run for this report yet. The report is saved and can be triaged by staff either way."}
            </p>
            {canRunNow && <RunAssessmentButton issueId={issue.id} />}
          </div>
        )}

        {latest?.status === "pending" && !stalePending && (
          <p className="flex items-center gap-2 text-sm text-ink-2" role="status">
            <Loader2 className="size-4 animate-spin text-brand" aria-hidden /> Assessment in progress — started {relative(latest.createdAt, now)}.
          </p>
        )}

        {(latest?.status === "failed" || stalePending) && (
          <div className="space-y-3">
            <Alert tone="warn" icon={<AlertTriangle className="size-4" />} title="Gemma assessment unavailable">
              {latest.error ?? "The assessment did not complete."}{" "}
              {issue.status === "new" ? "The report is saved and remains pending for human triage." : "Staff triaged this case without an AI recommendation."}
            </Alert>
            {canRunNow && <RunAssessmentButton issueId={issue.id} label="Retry assessment" variant="secondary" />}
          </div>
        )}

        {latest?.status === "succeeded" && latest.modelRecommendation && latest.safetyOverride?.finalRecommendation && (
          <Succeeded issue={issue} a={latest} decision={decision} canRerun={canRunNow} />
        )}

        {assessments.length > 1 && (
          <details className="text-xs text-ink-3">
            <summary className="cursor-pointer select-none hover:text-ink">Assessment history ({assessments.length})</summary>
            <ul className="mt-2 space-y-1">
              {assessments.map((a) => (
                <li key={a.id} className="flex flex-wrap gap-x-2">
                  <span className={cx("font-medium", a.status === "failed" ? "text-high" : a.status === "succeeded" ? "text-brand-strong" : "text-ink-2")}>{titleCase(a.status)}</span>
                  <span>{dateTime(a.createdAt)}</span>
                  <span className="font-mono">{a.modelName}</span>
                  {a.status === "succeeded" && <span>→ {a.safetyOverride?.finalRecommendation?.priority}</span>}
                  {a.error && <span>— {a.error}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}

function Succeeded({ issue, a, decision, canRerun }: { issue: Issue; a: Assessment; decision: Activity | null; canRerun: boolean }) {
  const model = a.modelRecommendation!;
  const safety = a.safetyOverride!;
  const rec = safety.finalRecommendation!;
  const decidedOnThis = decision && decision.details.assessmentId === a.id;
  const reviewLabel = !decision ? "Awaiting staff review" : decision.actionType === "decision_overridden" ? "Overridden by staff" : decision.actionType === "decision_accepted" ? "Accepted by staff" : "Triaged manually";
  const ReviewIcon = decision ? UserCheck : Clock;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <div className="text-xs text-ink-3">Recommended priority</div>
          <div className="mt-1.5 flex items-center gap-2">
            <PriorityBadge priority={rec.priority} />
            {safety.applied && <span className="text-xs text-ink-3 line-through decoration-ink-3/60" title="Model's original priority">{model.priority}</span>}
          </div>
        </div>
        <div>
          <div className="text-xs text-ink-3">Detected category</div>
          <div className="mt-1.5 text-sm font-medium">{LABELS.category[rec.category]}</div>
        </div>
        <div>
          <div className="text-xs text-ink-3">Responsible team</div>
          <div className="mt-1.5 text-sm font-medium">{rec.responsibleTeam}</div>
        </div>
      </div>

      {safety.explanation && (
        <Alert tone={safety.applied ? "danger" : "warn"} icon={<ShieldAlert className="size-4" />} title={safety.applied ? "Deterministic safety override applied" : "Safety rules matched"}>
          {safety.explanation}
        </Alert>
      )}

      <div className="rounded-lg bg-subtle/70 px-4 py-3">
        <p className="text-sm font-medium text-ink">{model.summary}</p>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{model.rationale}</p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Section icon={<ListChecks className="size-3.5" />} title="Recommended next steps">
          <ol className="list-decimal space-y-1 pl-4 text-sm text-ink-2 marker:text-ink-3">
            {rec.immediateActions.map((x, n) => <li key={n}>{x}</li>)}
          </ol>
        </Section>
        <div className="space-y-5">
          <Section icon={<ShieldAlert className="size-3.5" />} title="Safety considerations">
            {rec.safetyFlags.length ? (
              <div className="flex flex-wrap gap-1.5">
                {rec.safetyFlags.map((f) => <Tag key={f} className={safety.matchedRules.some((r) => r.id === f) ? "bg-critical-soft text-critical" : ""}>{f.replace(/_/g, " ")}</Tag>)}
              </div>
            ) : (
              <p className="text-sm text-ink-3">No hazards identified in the report.</p>
            )}
          </Section>
          <Section icon={<Siren className="size-3.5" />} title="Escalation">
            <p className="text-sm text-ink-2">{rec.escalationRecommended ? "Escalation recommended" : "No escalation recommended"} · {rec.needsHumanReview ? "human review required" : "routine review"}</p>
          </Section>
        </div>
      </div>

      <Section icon={<CircleHelp className="size-3.5" />} title="Missing information & uncertainty">
        {model.missingInformation.length ? (
          <ul className="list-disc space-y-1 pl-4 text-sm text-ink-2 marker:text-ink-3">
            {model.missingInformation.map((x, n) => <li key={n}>{x}</li>)}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">The model did not flag missing details.</p>
        )}
        {model.confidence !== undefined && (
          <p className="mt-2 flex items-center gap-1 text-xs text-ink-3">
            <Info className="size-3" aria-hidden /> Model self-reported confidence {Math.round(model.confidence * 100)}% — an uncalibrated estimate, not a probability.
          </p>
        )}
      </Section>

      <div className="rounded-lg border border-line">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <span className="text-sm font-medium">AI recommendation vs. approved decision</span>
          <span className={cx("inline-flex items-center gap-1 text-xs", decision ? "text-brand-strong" : "text-high")}>
            <ReviewIcon className="size-3.5" aria-hidden /> {reviewLabel}
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-3">
              <th scope="col" className="px-4 py-2 font-normal" />
              <th scope="col" className="px-4 py-2 font-normal">Gemma (after safety rules)</th>
              <th scope="col" className="px-4 py-2 font-normal">Staff-approved</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {[
              ["Priority", rec.priority, issue.priority],
              ["Category", LABELS.category[rec.category], issue.status === "new" ? null : issue.category && LABELS.category[issue.category]],
              ["Team", rec.responsibleTeam, issue.assignedTeam],
            ].map(([label, ai, human]) => (
              <tr key={label}>
                <th scope="row" className="px-4 py-2 text-left text-xs font-normal text-ink-3">{label}</th>
                <td className="px-4 py-2 capitalize">{ai}</td>
                <td className={cx("px-4 py-2 capitalize", human && human !== ai && "font-medium text-high")}>{human ?? <span className="normal-case text-ink-3">Not yet decided</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {decision && !decidedOnThis && <p className="border-t border-line px-4 py-2 text-xs text-ink-3">The current decision was made before this assessment ran.</p>}
      </div>

      {canRerun && (
        <div className="flex justify-end">
          <RunAssessmentButton issueId={issue.id} label="Re-run assessment" variant="secondary" />
        </div>
      )}
    </>
  );
}
