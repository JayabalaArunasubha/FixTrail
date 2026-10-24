"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, Loader2, Play, RotateCcw, Sparkles, X } from "lucide-react";
import { CATEGORIES, LABELS, PRIORITIES, PRIORITY_RANK, TEAMS, type Category, type Priority, type Team } from "@/lib/domain";
import { Alert, Field, buttonClass, cx, inputClass } from "./ui";

type Result = { ok: true } | { ok: false; error: string; fields?: Record<string, string> };

async function send(url: string, method: string, body: unknown): Promise<Result> {
  try {
    const res = await fetch(url, {
      method,
      ...(body instanceof FormData ? { body } : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error ?? `Request failed (${res.status}).`, fields: data.fields };
  } catch {
    return { ok: false, error: "Network error. Check your connection and try again." };
  }
}

/** Runs a mutation, then refreshes server data. Keeps the busy state until the refresh lands. */
function useMutation() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  async function run(url: string, method: string, body: unknown, onDone?: () => void) {
    setBusy(true);
    setError(null);
    setFields({});
    const r = await send(url, method, body);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setFields(r.fields ?? {});
      return false;
    }
    onDone?.();
    start(() => router.refresh());
    return true;
  }
  return { run, busy: busy || refreshing, error, fields, setError };
}

const Spinner = () => <Loader2 className="size-4 animate-spin" aria-hidden />;

// ---------- Gemma ----------

export function RunAssessmentButton({ issueId, label = "Run Gemma assessment", variant = "primary" }: { issueId: string; label?: string; variant?: "primary" | "secondary" }) {
  const m = useMutation();
  return (
    <div className="space-y-2">
      <button className={buttonClass(variant, "sm")} disabled={m.busy} onClick={() => m.run("/api/triage", "POST", { issueId })}>
        {m.busy ? <Spinner /> : <Sparkles className="size-4" aria-hidden />}
        {m.busy ? "Gemma is analyzing the report…" : label}
      </button>
      {m.busy && <p className="text-xs text-ink-3" role="status">Gemma reasons before answering, so this can take up to a minute. The report is already saved.</p>}
      {m.error && <p className="text-xs text-high" role="alert">{m.error}</p>}
    </div>
  );
}

// ---------- Human decision ----------

interface Rec {
  assessmentId: string;
  priority: Priority;
  category: Category;
  team: Team;
}

export function DecisionPanel({ issueId, rec, current, floor }: { issueId: string; rec: Rec | null; floor: Priority | null; current: { priority: Priority | null; category: Category | null; team: Team | null; assignedTo: string | null } }) {
  const m = useMutation();
  const [mode, setMode] = useState<"review" | "edit">(rec && !current.priority ? "review" : "edit");
  const [priority, setPriority] = useState<Priority>(current.priority ?? rec?.priority ?? floor ?? "medium");
  const [category, setCategory] = useState<Category>(current.category ?? rec?.category ?? "other");
  const [team, setTeam] = useState<Team>(current.team ?? rec?.team ?? "General Maintenance");
  const [assignedTo, setAssignedTo] = useState(current.assignedTo ?? "");
  const [reason, setReason] = useState("");

  const differs = rec && (priority !== rec.priority || category !== rec.category || team !== rec.team);
  const decisionMode = !rec ? "manual" : differs ? "override" : "accept";
  const belowFloor = Boolean(floor && PRIORITY_RANK[priority] > PRIORITY_RANK[floor]);
  const reasonRequired = decisionMode === "override" || belowFloor;

  function submit(e: FormEvent) {
    e.preventDefault();
    m.run(`/api/issues/${issueId}`, "PATCH", {
      action: "decide",
      mode: decisionMode,
      assessmentId: rec?.assessmentId,
      priority,
      category,
      team,
      assignedTo: assignedTo || undefined,
      reason: reason || undefined,
    });
  }

  if (rec && mode === "review") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-2">
          Gemma recommends <strong className="capitalize text-ink">{rec.priority}</strong> priority, routed to <strong className="text-ink">{rec.team}</strong>.
        </p>
        <div className="flex flex-col gap-2">
          <input aria-label="Assign to a person (optional)" placeholder="Assign to a person (optional)" className={inputClass} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} maxLength={80} />
          <button
            className={buttonClass("primary")}
            disabled={m.busy}
            onClick={() =>
              m.run(`/api/issues/${issueId}`, "PATCH", { action: "decide", mode: "accept", assessmentId: rec.assessmentId, priority: rec.priority, category: rec.category, team: rec.team, assignedTo: assignedTo || undefined })
            }
          >
            {m.busy ? <Spinner /> : <CheckCircle2 className="size-4" aria-hidden />} Accept recommendation
          </button>
          <button className={buttonClass("secondary")} disabled={m.busy} onClick={() => setMode("edit")}>
            Override…
          </button>
        </div>
        {m.error && <Alert tone="danger">{m.error}</Alert>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3.5" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority" htmlFor="d-priority">
          <select id="d-priority" className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}{rec?.priority === p ? " (AI)" : ""}</option>
            ))}
          </select>
        </Field>
        <Field label="Category" htmlFor="d-category">
          <select id="d-category" className={inputClass} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{LABELS.category[c]}{rec?.category === c ? " (AI)" : ""}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Responsible team" htmlFor="d-team">
        <select id="d-team" className={inputClass} value={team} onChange={(e) => setTeam(e.target.value as Team)}>
          {TEAMS.map((t) => (
            <option key={t} value={t}>{t}{rec?.team === t ? " (AI)" : ""}</option>
          ))}
        </select>
      </Field>
      <Field label="Assigned person" htmlFor="d-person" optional>
        <input id="d-person" className={inputClass} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} maxLength={80} placeholder="e.g. Luis Ortega" />
      </Field>
      {(decisionMode !== "accept" || belowFloor) && (
        <Field
          label={decisionMode === "override" ? "Reason for override" : belowFloor ? "Reason for going below the safety minimum" : "Triage note"}
          htmlFor="d-reason"
          optional={!reasonRequired}
          error={m.fields.reason}
          hint={belowFloor ? `Required: this report matches a safety rule with minimum priority “${floor}”.` : decisionMode === "override" ? "Required. Recorded in the audit history next to the AI recommendation." : "Recorded in the audit history."}
        >
          <textarea id="d-reason" rows={3} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} aria-invalid={Boolean(m.fields.reason)} />
        </Field>
      )}
      {m.error && <Alert tone="danger">{m.error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className={buttonClass("primary")}
          disabled={m.busy || (reasonRequired && reason.trim().length < 5)}
        >
          {m.busy && <Spinner />}
          {decisionMode === "override" ? "Save override" : decisionMode === "accept" ? "Accept recommendation" : "Save triage decision"}
        </button>
        {rec && (
          <button type="button" className={buttonClass("ghost")} onClick={() => { setMode("review"); setPriority(rec.priority); setCategory(rec.category); setTeam(rec.team); }}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

// ---------- Status, assignment, notes ----------

function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
    if (!open && d?.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(520px,calc(100vw-32px))] rounded-xl border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-ink/30 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-subtle hover:text-ink" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}

export function StatusActions({ issueId, status, canResolve, canReopen }: { issueId: string; status: string; canResolve: boolean; canReopen: boolean }) {
  const m = useMutation();
  const [dialog, setDialog] = useState<null | "resolve" | "reopen">(null);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);

  const close = () => {
    setDialog(null);
    m.setError(null);
  };

  function resolve(e: FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("payload", JSON.stringify({ action: "resolve", resolutionNotes: notes }));
    if (photo) fd.set("photo", photo);
    m.run(`/api/issues/${issueId}`, "PATCH", fd, () => setDialog(null));
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canResolve && status === "triaged" && (
        <button className={buttonClass("secondary", "sm")} disabled={m.busy} onClick={() => m.run(`/api/issues/${issueId}`, "PATCH", { action: "start" })}>
          {m.busy && !dialog ? <Spinner /> : <Play className="size-3.5" aria-hidden />} Start work
        </button>
      )}
      {canResolve && (status === "triaged" || status === "in_progress") && (
        <button className={buttonClass("primary", "sm")} onClick={() => setDialog("resolve")}>
          <CheckCircle2 className="size-3.5" aria-hidden /> Mark resolved…
        </button>
      )}
      {canReopen && status === "resolved" && (
        <button className={buttonClass("secondary", "sm")} onClick={() => setDialog("reopen")}>
          <RotateCcw className="size-3.5" aria-hidden /> Reopen…
        </button>
      )}
      {m.error && !dialog && <p className="w-full text-xs text-critical" role="alert">{m.error}</p>}

      <Dialog open={dialog === "resolve"} onClose={close} title="Resolve this issue">
        <form onSubmit={resolve} className="space-y-4" noValidate>
          <Field label="What was done?" htmlFor="r-notes" error={m.fields.resolutionNotes} hint="Describe the repair and what you verified. This is the resolution record.">
            <textarea id="r-notes" rows={4} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} aria-invalid={Boolean(m.fields.resolutionNotes)} />
          </Field>
          <Field label="Evidence photo" htmlFor="r-photo" optional hint="JPEG, PNG or WebP, up to 5 MB.">
            <input id="r-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-md file:border-0 file:bg-subtle file:px-3 file:py-1.5 file:text-sm file:text-ink" />
          </Field>
          {m.error && <Alert tone="danger">{m.error}</Alert>}
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass("ghost")} onClick={close}>Cancel</button>
            <button type="submit" className={buttonClass("primary")} disabled={m.busy || notes.trim().length < 10}>
              {m.busy && <Spinner />} Confirm resolution
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={dialog === "reopen"} onClose={close} title="Reopen this issue">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            m.run(`/api/issues/${issueId}`, "PATCH", { action: "reopen", reason }, () => setDialog(null));
          }}
          className="space-y-4"
          noValidate
        >
          <p className="text-sm text-ink-2">The issue returns to “In progress” with a new deadline. The original resolution stays in the history.</p>
          <Field label="Why is it being reopened?" htmlFor="ro-reason" error={m.fields.reason}>
            <textarea id="ro-reason" rows={3} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          </Field>
          {m.error && <Alert tone="danger">{m.error}</Alert>}
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass("ghost")} onClick={close}>Cancel</button>
            <button type="submit" className={buttonClass("primary")} disabled={m.busy || reason.trim().length < 5}>
              {m.busy && <Spinner />} Reopen issue
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

export function AssignForm({ issueId, team, assignedTo }: { issueId: string; team: Team; assignedTo: string | null }) {
  const m = useMutation();
  const [open, setOpen] = useState(false);
  const [t, setT] = useState<Team>(team);
  const [person, setPerson] = useState(assignedTo ?? "");
  if (!open) {
    return (
      <button className="text-xs font-medium text-brand hover:text-brand-strong" onClick={() => setOpen(true)}>
        Change assignment
      </button>
    );
  }
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        m.run(`/api/issues/${issueId}`, "PATCH", { action: "assign", team: t, assignedTo: person || undefined }, () => setOpen(false));
      }}
    >
      <select aria-label="Team" className={inputClass} value={t} onChange={(e) => setT(e.target.value as Team)}>
        {TEAMS.map((x) => <option key={x}>{x}</option>)}
      </select>
      <input aria-label="Assigned person" placeholder="Person (optional)" className={inputClass} value={person} onChange={(e) => setPerson(e.target.value)} maxLength={80} />
      {m.error && <p className="text-xs text-critical">{m.error}</p>}
      <div className="flex gap-2">
        <button className={buttonClass("primary", "sm")} disabled={m.busy}>{m.busy && <Spinner />} Save</button>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

export function NoteForm({ issueId }: { issueId: string }) {
  const m = useMutation();
  const [note, setNote] = useState("");
  return (
    <form
      className="border-t border-line px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        m.run(`/api/issues/${issueId}/activity`, "POST", { note }, () => setNote(""));
      }}
    >
      <label htmlFor="note" className="sr-only">Add a staff note</label>
      <textarea id="note" rows={2} placeholder="Add a staff note (visible in the timeline)…" className={cx(inputClass, "resize-y")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-critical" role="alert">{m.error}</span>
        <button className={buttonClass("secondary", "sm")} disabled={m.busy || note.trim().length < 2}>
          {m.busy && <Spinner />} Add note
        </button>
      </div>
    </form>
  );
}
