import {
  PRIORITY_RANK,
  SLA_HOURS,
  TRIAGE_SLA_HOURS,
  validateImage,
  type Assessment,
  type Issue,
  type NewIssueInput,
  type PatchIssueInput,
  type Status,
  type Viewer,
} from "./domain";
import { applySafetyRules, issueText, matchSafetyRules, safetyFloor } from "./safety";
import { GemmaError, PROMPT_VERSION, gemmaModel, triageWithGemma } from "./gemma";
import { getRepo, type NewIssueRecord } from "./repo";

export class ServiceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const requireStaff = (viewer: Viewer) => {
  if (viewer.role !== "staff") throw new ServiceError(403, "Only maintenance staff can make this change.");
};

async function loadIssue(viewer: Viewer, id: string) {
  const issue = await (await getRepo()).getIssue(viewer, id);
  // 404 rather than 403 so reporters cannot probe for other people's issue IDs.
  if (!issue) throw new ServiceError(404, "Issue not found.");
  return issue;
}

async function log(issueId: string, viewer: Viewer, actionType: string, details: Record<string, unknown>) {
  await (await getRepo()).insertActivity({ issueId, actorId: viewer.id, actorName: viewer.name, actionType, details });
}

// ---------- Create ----------

export async function createIssue(viewer: Viewer, input: NewIssueInput, photo: File | null) {
  const repo = await getRepo();
  const existing = await repo.findIssueByRequestId(viewer, input.clientRequestId);
  if (existing) return { issue: existing, duplicate: true };

  if (photo) {
    const err = validateImage(photo);
    if (err) throw new ServiceError(400, err);
  }

  const record: NewIssueRecord = {
    title: input.title,
    description: input.description,
    building: input.building,
    location: input.location,
    category: input.category ?? null,
    reporterId: viewer.id,
    reporterName: viewer.role === "reporter" || !input.reporterName ? viewer.name : input.reporterName,
    priority: null,
    status: "new",
    assignedTeam: null,
    assignedTo: null,
    dueAt: hoursFromNow(TRIAGE_SLA_HOURS),
    resolvedAt: null,
    resolutionNotes: null,
    photoRef: photo ? await repo.savePhoto(photo) : null,
    resolutionPhotoRef: null,
  };
  // The report is stored before any AI call so a model failure can never lose it.
  const issue = await repo.insertIssue(record, input.clientRequestId);
  await log(issue.id, viewer, "created", { title: issue.title, reporterCategory: issue.category, hasPhoto: Boolean(issue.photoRef) });
  return { issue, duplicate: false };
}

// ---------- Triage ----------

export async function runTriage(viewer: Viewer, issueId: string): Promise<Assessment> {
  const repo = await getRepo();
  const issue = await loadIssue(viewer, issueId);
  if (issue.status === "resolved") throw new ServiceError(409, "Resolved issues cannot be re-assessed. Reopen it first.");

  const previous = await repo.listAssessments([issue.id]);
  const latest = previous[0];
  if (latest?.status === "pending" && Date.now() - Date.parse(latest.createdAt) < 90_000) {
    throw new ServiceError(409, "A Gemma assessment is already running for this issue.");
  }
  if (viewer.role !== "staff" && previous.some((a) => a.status === "succeeded")) {
    throw new ServiceError(403, "This issue already has an AI assessment. Staff can request a new one.");
  }

  const assessment = await repo.insertAssessment({
    issueId: issue.id,
    modelName: gemmaModel(),
    promptVersion: PROMPT_VERSION,
    status: "pending",
    modelRecommendation: null,
    safetyOverride: null,
    error: null,
  });
  await log(issue.id, viewer, "ai_requested", { assessmentId: assessment.id, model: assessment.modelName });

  try {
    const image = await repo.photoForModel(issue.photoRef);
    const { model, decision } = await triageWithGemma({ ...issue, image });
    const safety = applySafetyRules(issueText(issue), decision);
    const done = { status: "succeeded" as const, modelName: model, modelRecommendation: decision, safetyOverride: safety };
    await repo.updateAssessment(assessment.id, done);
    await log(issue.id, viewer, "ai_succeeded", {
      assessmentId: assessment.id,
      model,
      promptVersion: PROMPT_VERSION,
      modelPriority: decision.priority,
      finalPriority: safety.finalRecommendation?.priority,
      safetyOverrideApplied: safety.applied,
    });
    return { ...assessment, ...done };
  } catch (err) {
    const message = err instanceof GemmaError ? err.message : "The Gemma assessment failed unexpectedly.";
    const code = err instanceof GemmaError ? err.code : "upstream";
    // Safety rules still run without the model; there is just no recommendation to adjust.
    const matchedRules = matchSafetyRules(issueText(issue));
    const safetyOverride = { applied: false, matchedRules, explanation: matchedRules.length ? `Safety rules matched: ${matchedRules.map((r) => r.label).join("; ")}.` : null, finalRecommendation: null };
    await repo.updateAssessment(assessment.id, { status: "failed", error: message, safetyOverride });
    await log(issue.id, viewer, "ai_failed", { assessmentId: assessment.id, code, error: message });
    return { ...assessment, status: "failed", error: message, safetyOverride };
  }
}

// ---------- Update ----------

const TRANSITIONS: Record<"start" | "resolve" | "reopen", { from: Status[]; to: Status }> = {
  start: { from: ["triaged"], to: "in_progress" },
  resolve: { from: ["triaged", "in_progress"], to: "resolved" },
  reopen: { from: ["resolved"], to: "in_progress" },
};

export async function updateIssue(viewer: Viewer, id: string, input: PatchIssueInput, photo: File | null = null): Promise<Issue> {
  const repo = await getRepo();
  const issue = await loadIssue(viewer, id);

  // Reporters may only reopen their own resolved issue; everything else is staff-only.
  if (!(input.action === "reopen" && issue.reporterId === viewer.id)) requireStaff(viewer);

  const save = async (patch: Partial<NewIssueRecord>) => {
    const updated = await repo.updateIssue(issue.id, patch, issue.status);
    if (!updated) throw new ServiceError(409, "This issue was changed by someone else. Refresh and try again.");
    return updated;
  };

  switch (input.action) {
    case "decide": {
      if (issue.status === "resolved") throw new ServiceError(409, "Reopen the issue before changing its decision.");
      const latest = (await repo.listAssessments([issue.id])).find((a) => a.status === "succeeded");
      const rec = latest?.safetyOverride?.finalRecommendation ?? null;

      if (input.mode === "manual" && rec) throw new ServiceError(400, "This issue has a Gemma assessment. Accept or override it.");
      if (input.mode !== "manual") {
        if (!latest || !rec || latest.id !== input.assessmentId) {
          throw new ServiceError(409, "The AI assessment changed. Refresh to review the latest recommendation.");
        }
      }
      const matches = rec && rec.priority === input.priority && rec.category === input.category && rec.responsibleTeam === input.team;
      if (input.mode === "accept" && !matches) throw new ServiceError(400, "Accepted values must match the recommendation. Use override to change them.");
      if (input.mode === "override" && (!input.reason || input.reason.length < 5)) {
        throw new ServiceError(400, "Overriding the AI recommendation requires a reason of at least 5 characters.");
      }
      const floor = safetyFloor(issueText(issue));
      const belowSafetyFloor = Boolean(floor && PRIORITY_RANK[input.priority] > PRIORITY_RANK[floor]);
      if (belowSafetyFloor && (!input.reason || input.reason.length < 5)) {
        throw new ServiceError(400, `This report matches a safety rule (minimum ${floor}). Setting a lower priority requires a reason.`);
      }

      const updated = await save({
        priority: input.priority,
        category: input.category,
        assignedTeam: input.team,
        assignedTo: input.assignedTo || issue.assignedTo,
        status: issue.status === "new" ? "triaged" : issue.status,
        dueAt: hoursFromNow(SLA_HOURS[input.priority]),
      });
      await log(issue.id, viewer, `decision_${input.mode === "accept" ? "accepted" : input.mode === "override" ? "overridden" : "manual"}`, {
        assessmentId: latest?.id ?? null,
        model: latest?.modelName ?? null,
        promptVersion: latest?.promptVersion ?? null,
        aiRecommendation: rec ? { priority: rec.priority, category: rec.category, team: rec.responsibleTeam } : null,
        final: { priority: input.priority, category: input.category, team: input.team, assignedTo: updated.assignedTo },
        safetyOverrideApplied: latest?.safetyOverride?.applied ?? false,
        belowSafetyFloor,
        reason: input.reason || null,
      });
      return updated;
    }
    case "assign": {
      if (issue.status === "new") throw new ServiceError(409, "Triage the issue before assigning it.");
      if (issue.status === "resolved") throw new ServiceError(409, "Reopen the issue before reassigning it.");
      const updated = await save({ assignedTeam: input.team, assignedTo: input.assignedTo || null });
      await log(issue.id, viewer, "assigned", { from: { team: issue.assignedTeam, person: issue.assignedTo }, to: { team: input.team, person: updated.assignedTo } });
      return updated;
    }
    case "start":
    case "resolve":
    case "reopen": {
      const t = TRANSITIONS[input.action];
      if (!t.from.includes(issue.status)) {
        throw new ServiceError(409, `Cannot ${input.action} an issue that is ${issue.status.replace("_", " ")}.`);
      }
      if (photo) {
        const err = validateImage(photo);
        if (err) throw new ServiceError(400, err);
      }
      const patch: Partial<NewIssueRecord> = { status: t.to };
      if (input.action === "resolve") {
        patch.resolvedAt = new Date().toISOString();
        patch.resolutionNotes = input.resolutionNotes;
        if (photo) patch.resolutionPhotoRef = await repo.savePhoto(photo);
      }
      if (input.action === "reopen") {
        patch.resolvedAt = null;
        patch.dueAt = hoursFromNow(SLA_HOURS[issue.priority ?? "medium"]);
      }
      const updated = await save(patch);
      const details: Record<string, unknown> = { from: issue.status, to: t.to };
      if (input.action === "resolve") Object.assign(details, { resolutionNotes: input.resolutionNotes, hasEvidencePhoto: Boolean(photo) });
      if (input.action === "reopen") details.reason = input.reason;
      await log(issue.id, viewer, input.action === "start" ? "status_changed" : input.action === "resolve" ? "resolved" : "reopened", details);
      return updated;
    }
  }
}

export async function addNote(viewer: Viewer, id: string, note: string) {
  requireStaff(viewer);
  const issue = await loadIssue(viewer, id);
  await log(issue.id, viewer, "note", { note });
}

// ---------- Reads ----------

export async function getIssueDetail(viewer: Viewer, id: string) {
  const repo = await getRepo();
  const issue = await loadIssue(viewer, id);
  const [assessments, activity, photoUrl, resolutionPhotoUrl] = await Promise.all([
    repo.listAssessments([issue.id]),
    repo.listActivity([issue.id]),
    repo.photoDisplayUrl(issue.photoRef),
    repo.photoDisplayUrl(issue.resolutionPhotoRef),
  ]);
  return { issue, assessments, activity, photoUrl, resolutionPhotoUrl };
}

/** Everything the dashboard, list, and recurring views need, scoped to what the viewer may see. */
export async function getWorkspace(viewer: Viewer) {
  const repo = await getRepo();
  const issues = await repo.listIssues(viewer);
  const ids = issues.map((i) => i.id);
  const [assessments, activity] = await Promise.all([repo.listAssessments(ids), repo.listActivity(ids, 40)]);
  const latestAssessment = new Map<string, Assessment>();
  for (const a of assessments) if (!latestAssessment.has(a.issueId)) latestAssessment.set(a.issueId, a);
  return { issues, latestAssessment, activity, mode: repo.mode };
}
