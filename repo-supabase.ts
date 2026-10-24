import { createClient } from "@supabase/supabase-js";
import type { Activity, Assessment, Issue } from "./domain";
import type { NewIssueRecord, Repo } from "./repo";

// Service-role client: server-only, bypasses RLS. Every query below scopes rows to the viewer explicitly;
// RLS policies in supabase/schema.sql protect the tables from direct browser access with the anon key.
const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const BUCKET = "attachments";

type Row = Record<string, unknown>;

const toIssue = (r: Row): Issue => ({
  id: r.id as string,
  title: r.title as string,
  description: r.description as string,
  building: r.building as string,
  location: r.location as string,
  category: (r.category as Issue["category"]) ?? null,
  reporterId: r.reporter_id as string,
  reporterName: r.reporter_name as string,
  priority: (r.priority as Issue["priority"]) ?? null,
  status: r.status as Issue["status"],
  assignedTeam: (r.assigned_team as Issue["assignedTeam"]) ?? null,
  assignedTo: (r.assigned_to as string) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
  dueAt: (r.due_at as string) ?? null,
  resolvedAt: (r.resolved_at as string) ?? null,
  resolutionNotes: (r.resolution_notes as string) ?? null,
  photoRef: (r.photo_path as string) ?? null,
  resolutionPhotoRef: (r.resolution_photo_path as string) ?? null,
});

const COLS: Record<keyof NewIssueRecord, string> = {
  title: "title",
  description: "description",
  building: "building",
  location: "location",
  category: "category",
  reporterId: "reporter_id",
  reporterName: "reporter_name",
  priority: "priority",
  status: "status",
  assignedTeam: "assigned_team",
  assignedTo: "assigned_to",
  dueAt: "due_at",
  resolvedAt: "resolved_at",
  resolutionNotes: "resolution_notes",
  photoRef: "photo_path",
  resolutionPhotoRef: "resolution_photo_path",
  isSample: "",
};

const toRow = (patch: Partial<NewIssueRecord>) =>
  Object.fromEntries(
    Object.entries(patch).flatMap(([k, v]) => (COLS[k as keyof NewIssueRecord] ? [[COLS[k as keyof NewIssueRecord], v]] : [])),
  );

const toAssessment = (r: Row): Assessment => ({
  id: r.id as string,
  issueId: r.issue_id as string,
  modelName: r.model_name as string,
  promptVersion: r.prompt_version as string,
  status: r.assessment_status as Assessment["status"],
  modelRecommendation: (r.model_recommendation as Assessment["modelRecommendation"]) ?? null,
  safetyOverride: (r.safety_override as Assessment["safetyOverride"]) ?? null,
  error: (r.error as string) ?? null,
  createdAt: r.created_at as string,
});

const toActivity = (r: Row): Activity => ({
  id: r.id as string,
  issueId: r.issue_id as string,
  actorId: r.actor_id as string,
  actorName: r.actor_name as string,
  actionType: r.action_type as string,
  details: (r.details as Record<string, unknown>) ?? {},
  createdAt: r.created_at as string,
});

/** Thrown when FixTrail's tables or bucket don't exist yet (supabase/schema.sql not applied). */
export class DatabaseSetupError extends Error {
  readonly databaseSetup = true;
}

const MISSING_TABLE = new Set(["PGRST205", "42P01"]);

function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error && MISSING_TABLE.has(res.error.code ?? "")) throw new DatabaseSetupError(res.error.message);
  if (res.error) throw new Error(`Database error: ${res.error.message}`);
  return res.data;
}

export const FIXTRAIL_TABLES = ["profiles", "issues", "ai_assessments", "issue_activity"] as const;

let schemaReady = false;
/** Read-only probe of the four tables and the storage bucket. Cached once everything is present. */
export async function checkSchema(): Promise<{ ok: boolean; missing: string[]; error?: string }> {
  if (schemaReady) return { ok: true, missing: [] };
  try {
    const missing: string[] = [];
    for (const t of FIXTRAIL_TABLES) {
      const { error } = await db().from(t).select("*").limit(0); // GET, not HEAD: HEAD drops the PGRST205 code
      if (error && MISSING_TABLE.has(error.code ?? "")) missing.push(`table public.${t}`);
      else if (error) return { ok: false, missing, error: `Could not query ${t}: ${error.message}` };
    }
    const { data, error } = await db().storage.getBucket(BUCKET);
    if (error || !data) missing.push(`storage bucket "${BUCKET}"`);
    schemaReady = missing.length === 0;
    return { ok: schemaReady, missing };
  } catch (e) {
    return { ok: false, missing: [], error: e instanceof Error ? e.message : "Could not reach Supabase." };
  }
}

export const supabaseRepo: Repo = {
  mode: "supabase",
  async listIssues(viewer) {
    let q = db().from("issues").select("*").order("created_at", { ascending: false }).limit(2000);
    if (viewer.role !== "staff") q = q.eq("reporter_id", viewer.id);
    return (check(await q) as Row[]).map(toIssue);
  },
  async getIssue(viewer, id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    let q = db().from("issues").select("*").eq("id", id);
    if (viewer.role !== "staff") q = q.eq("reporter_id", viewer.id);
    const row = check(await q.maybeSingle()) as Row | null;
    return row ? toIssue(row) : null;
  },
  async findIssueByRequestId(viewer, clientRequestId) {
    const row = check(
      await db().from("issues").select("*").eq("client_request_id", clientRequestId).eq("reporter_id", viewer.id).maybeSingle(),
    ) as Row | null;
    return row ? toIssue(row) : null;
  },
  async insertIssue(data, clientRequestId) {
    const row = check(await db().from("issues").insert({ ...toRow(data), client_request_id: clientRequestId }).select().single()) as Row;
    return toIssue(row);
  },
  async updateIssue(id, patch, expectStatus) {
    const row = check(
      await db()
        .from("issues")
        .update({ ...toRow(patch), updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", expectStatus)
        .select()
        .maybeSingle(),
    ) as Row | null;
    return row ? toIssue(row) : null;
  },
  async listAssessments(issueIds) {
    if (issueIds.length === 0) return [];
    const rows = check(await db().from("ai_assessments").select("*").in("issue_id", issueIds).order("created_at", { ascending: false })) as Row[];
    return rows.map(toAssessment);
  },
  async insertAssessment(a) {
    const row = check(
      await db()
        .from("ai_assessments")
        .insert({
          issue_id: a.issueId,
          model_name: a.modelName,
          prompt_version: a.promptVersion,
          assessment_status: a.status,
          model_recommendation: a.modelRecommendation,
          safety_override: a.safetyOverride,
          error: a.error,
        })
        .select()
        .single(),
    ) as Row;
    return toAssessment(row);
  },
  async updateAssessment(id, p) {
    const row: Row = {};
    if (p.status) row.assessment_status = p.status;
    if (p.modelName) row.model_name = p.modelName;
    if (p.modelRecommendation !== undefined) row.model_recommendation = p.modelRecommendation;
    if (p.safetyOverride !== undefined) row.safety_override = p.safetyOverride;
    if (p.error !== undefined) row.error = p.error;
    check(await db().from("ai_assessments").update(row).eq("id", id));
  },
  async listActivity(issueIds, limit = 500) {
    if (issueIds.length === 0) return [];
    const rows = check(
      await db().from("issue_activity").select("*").in("issue_id", issueIds).order("created_at", { ascending: false }).limit(limit),
    ) as Row[];
    return rows.map(toActivity);
  },
  async insertActivity(a) {
    const row = check(
      await db()
        .from("issue_activity")
        .insert({ issue_id: a.issueId, actor_id: a.actorId, actor_name: a.actorName, action_type: a.actionType, details: a.details })
        .select()
        .single(),
    ) as Row;
    return toActivity(row);
  },
  async savePhoto(file) {
    const ext = file.type.split("/")[1];
    const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
    check(await db().storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false }));
    return path;
  },
  async photoDisplayUrl(ref) {
    if (!ref) return null;
    const { data } = await db().storage.from(BUCKET).createSignedUrl(ref, 600);
    return data?.signedUrl ?? null;
  },
  async photoForModel(ref) {
    if (!ref) return null;
    const { data } = await db().storage.from(BUCKET).download(ref);
    if (!data) return null;
    return { mimeType: data.type || "image/jpeg", base64: Buffer.from(await data.arrayBuffer()).toString("base64") };
  },
};
