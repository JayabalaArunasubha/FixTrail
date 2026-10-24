"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Camera, CheckCircle2, ImageOff, Loader2, Send, Sparkles } from "lucide-react";
import { CATEGORIES, LABELS, MAX_IMAGE_BYTES, newIssueSchema, validateImage } from "@/lib/domain";
import { Alert, Field, buttonClass, cx, inputClass } from "./ui";

type Stage = "idle" | "saving" | "analyzing" | "done";

export function ReportForm({ reporterName, buildings, isStaff }: { reporterName: string; buildings: string[]; isStaff: boolean }) {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "", building: "", location: "", category: "", reporterName: "" });
  const busy = stage !== "idle";

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (errors[k]) setErrors(({ [k]: _drop, ...rest }) => rest);
  };

  function pickPhoto(file: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    const err = file ? validateImage(file) : null;
    setErrors(({ photo: _drop, ...rest }) => (err ? { ...rest, photo: err } : rest));
    setPhoto(err ? null : file);
    setPreview(file && !err ? URL.createObjectURL(file) : null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    requestId.current ??= crypto.randomUUID(); // same id on retry → server de-duplicates
    const payload = { ...form, category: form.category || null, reporterName: form.reporterName || undefined, clientRequestId: requestId.current };
    const check = newIssueSchema.safeParse(payload);
    if (!check.success) {
      const f: Record<string, string> = {};
      for (const i of check.error.issues) f[String(i.path[0])] ??= i.message;
      setErrors(f);
      setError("Please fix the highlighted fields.");
      document.getElementById(Object.keys(f)[0])?.focus();
      return;
    }

    setError(null);
    setStage("saving");
    const fd = new FormData();
    Object.entries(payload).forEach(([k, v]) => v != null && fd.set(k, String(v)));
    if (photo) fd.set("photo", photo);

    let issueId: string;
    try {
      const res = await fetch("/api/issues", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors(data.fields ?? {});
        setError(data.error ?? "Your report could not be saved. Please try again.");
        setStage("idle");
        return;
      }
      issueId = data.issue.id;
    } catch {
      setError("Network error — your report was not sent. Your text is still here; try again.");
      setStage("idle");
      return;
    }

    // The report is saved. Now ask Gemma; a failure here is shown on the issue page with a retry.
    setStage("analyzing");
    await fetch("/api/triage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ issueId }) }).catch(() => null);
    setStage("done");
    router.push(`/issues/${issueId}?submitted=1`);
  }

  if (busy) {
    const steps = [
      { key: "saving", label: "Saving your report" },
      { key: "analyzing", label: "Gemma 4 is assessing priority and safety" },
      { key: "done", label: "Opening the case" },
    ];
    const at = steps.findIndex((s) => s.key === stage);
    return (
      <div className="px-6 py-10" role="status" aria-live="polite">
        <div className="mx-auto max-w-sm">
          <div className="mb-6 flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand">
            <Sparkles className="size-5" aria-hidden />
          </div>
          <ol className="space-y-4">
            {steps.map((s, n) => (
              <li key={s.key} className={cx("flex items-center gap-3 text-sm", n > at ? "text-ink-3" : "text-ink")}>
                {n < at ? <CheckCircle2 className="size-4 text-brand" aria-hidden /> : n === at ? <Loader2 className="size-4 animate-spin text-brand" aria-hidden /> : <span className="size-4 rounded-full border border-line-strong" />}
                {s.label}
              </li>
            ))}
          </ol>
          {stage === "analyzing" && <p className="mt-6 text-xs text-ink-3">Your report is already saved. If the AI is unavailable, staff will triage it manually.</p>}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5 px-5 py-5 sm:px-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <Field label="What’s the problem?" htmlFor="title" error={errors.title} hint="A short summary, e.g. “Water leaking from ceiling near sinks”.">
        <input id="title" className={inputClass} value={form.title} onChange={set("title")} maxLength={120} aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? "title-error" : undefined} autoComplete="off" />
      </Field>

      <Field label="Describe what you see" htmlFor="description" error={errors.description} hint="What is happening, since when, and whether anyone is at risk. Plain language is fine.">
        <textarea id="description" rows={5} className={inputClass} value={form.description} onChange={set("description")} maxLength={4000} aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "description-error" : undefined} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Building" htmlFor="building" error={errors.building}>
          <input id="building" list="buildings" className={inputClass} value={form.building} onChange={set("building")} maxLength={80} aria-invalid={Boolean(errors.building)} placeholder="e.g. Maple Hall" />
          <datalist id="buildings">{buildings.map((b) => <option key={b} value={b} />)}</datalist>
        </Field>
        <Field label="Room or area" htmlFor="location" error={errors.location}>
          <input id="location" className={inputClass} value={form.location} onChange={set("location")} maxLength={120} aria-invalid={Boolean(errors.location)} placeholder="e.g. Room 214 bathroom" />
        </Field>
      </div>

      <Field label="Category" htmlFor="category" optional hint="Not sure? Leave it — Gemma will suggest one and staff will confirm.">
        <select id="category" className={inputClass} value={form.category} onChange={set("category")}>
          <option value="">I’m not sure</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{LABELS.category[c]}</option>)}
        </select>
      </Field>

      <Field label="Photo" htmlFor="photo" optional error={errors.photo} hint={`JPEG, PNG or WebP up to ${MAX_IMAGE_BYTES / 1024 / 1024} MB. Sent to Gemma with the report.`}>
        <div className="flex items-center gap-3">
          <label htmlFor="photo" className={cx(buttonClass("secondary", "sm"), "cursor-pointer")}>
            <Camera className="size-4" aria-hidden /> {photo ? "Change photo" : "Add photo"}
          </label>
          <input id="photo" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)} />
          {photo && (
            <button type="button" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-critical" onClick={() => pickPhoto(null)}>
              <ImageOff className="size-3.5" aria-hidden /> Remove
            </button>
          )}
        </div>
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
          <img src={preview} alt="Selected photo preview" className="mt-3 max-h-48 rounded-lg border border-line object-contain" />
        )}
      </Field>

      {isStaff ? (
        <Field label="Reported by" htmlFor="reporterName" optional hint={`Leave blank to file as ${reporterName}. Use when logging a call or walk-in.`}>
          <input id="reporterName" className={inputClass} value={form.reporterName} onChange={set("reporterName")} maxLength={80} />
        </Field>
      ) : (
        <p className="text-sm text-ink-3">Reporting as <span className="font-medium text-ink-2">{reporterName}</span></p>
      )}

      <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-ink-3">If you smell gas, see fire or sparks, or someone is hurt, call emergency services first.</p>
        <button type="submit" className={buttonClass("primary")} disabled={busy}>
          <Send className="size-4" aria-hidden /> Submit report
        </button>
      </div>
    </form>
  );
}
