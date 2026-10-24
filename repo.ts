import type { Activity, Assessment, Issue, Status, Viewer } from "./domain";
import { seedDemoData } from "./seed";
import { supabaseConfigured } from "./config";

export type NewIssueRecord = Omit<Issue, "id" | "createdAt" | "updatedAt">;

/** Storage operations. Authorization (who may call what) lives in lib/service.ts. */
export interface Repo {
  mode: "demo" | "supabase";
  listIssues(viewer: Viewer): Promise<Issue[]>;
  getIssue(viewer: Viewer, id: string): Promise<Issue | null>;
  findIssueByRequestId(viewer: Viewer, clientRequestId: string): Promise<Issue | null>;
  insertIssue(data: NewIssueRecord, clientRequestId: string): Promise<Issue>;
  /** Returns null if the issue's status is no longer `expectStatus` (concurrent change). */
  updateIssue(id: string, patch: Partial<NewIssueRecord>, expectStatus: Status): Promise<Issue | null>;
  listAssessments(issueIds: string[]): Promise<Assessment[]>;
  insertAssessment(a: Omit<Assessment, "id" | "createdAt">): Promise<Assessment>;
  updateAssessment(id: string, patch: Partial<Omit<Assessment, "id" | "issueId" | "createdAt">>): Promise<void>;
  listActivity(issueIds: string[], limit?: number): Promise<Activity[]>;
  insertActivity(a: Omit<Activity, "id" | "createdAt">): Promise<Activity>;
  savePhoto(file: File): Promise<string>;
  photoDisplayUrl(ref: string | null): Promise<string | null>;
  photoForModel(ref: string | null): Promise<{ mimeType: string; base64: string } | null>;
}

// ---------- Local demo store (server memory, not shared or durable) ----------

interface DemoDb {
  issues: (Issue & { clientRequestId?: string })[];
  assessments: Assessment[];
  activity: Activity[];
}

const g = globalThis as unknown as { __fixtrailDemo?: DemoDb };

export function demoDb(): DemoDb {
  g.__fixtrailDemo ??= seedDemoData(new Date());
  return g.__fixtrailDemo;
}

export function resetDemoDb(empty = false) {
  g.__fixtrailDemo = empty ? { issues: [], assessments: [], activity: [] } : seedDemoData(new Date());
}

const now = () => new Date().toISOString();
const byNewest = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);
const visible = (viewer: Viewer, i: Issue) => viewer.role === "staff" || i.reporterId === viewer.id;
const strip = ({ clientRequestId: _c, ...issue }: Issue & { clientRequestId?: string }): Issue => issue;

export const memoryRepo: Repo = {
  mode: "demo",
  async listIssues(viewer) {
    return demoDb().issues.filter((i) => visible(viewer, i)).map(strip);
  },
  async getIssue(viewer, id) {
    const i = demoDb().issues.find((x) => x.id === id);
    return i && visible(viewer, i) ? strip(i) : null;
  },
  async findIssueByRequestId(viewer, clientRequestId) {
    const i = demoDb().issues.find((x) => x.clientRequestId === clientRequestId && x.reporterId === viewer.id);
    return i ? strip(i) : null;
  },
  async insertIssue(data, clientRequestId) {
    const issue = { ...data, id: crypto.randomUUID(), createdAt: now(), updatedAt: now(), clientRequestId };
    demoDb().issues.push(issue);
    return strip(issue);
  },
  async updateIssue(id, patch, expectStatus) {
    const i = demoDb().issues.find((x) => x.id === id);
    if (!i || i.status !== expectStatus) return null;
    Object.assign(i, patch, { updatedAt: now() });
    return strip(i);
  },
  async listAssessments(issueIds) {
    const ids = new Set(issueIds);
    return demoDb().assessments.filter((a) => ids.has(a.issueId)).sort(byNewest);
  },
  async insertAssessment(a) {
    const row = { ...a, id: crypto.randomUUID(), createdAt: now() };
    demoDb().assessments.push(row);
    return row;
  },
  async updateAssessment(id, patch) {
    const a = demoDb().assessments.find((x) => x.id === id);
    if (a) Object.assign(a, patch);
  },
  async listActivity(issueIds, limit = 500) {
    const ids = new Set(issueIds);
    return demoDb().activity.filter((a) => ids.has(a.issueId)).sort(byNewest).slice(0, limit);
  },
  async insertActivity(a) {
    const row = { ...a, id: crypto.randomUUID(), createdAt: now() };
    demoDb().activity.push(row);
    return row;
  },
  async savePhoto(file) {
    // ponytail: demo keeps photos as data URLs in memory; Supabase mode uses private Storage.
    return `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
  },
  async photoDisplayUrl(ref) {
    return ref;
  },
  async photoForModel(ref) {
    const m = ref?.match(/^data:([^;]+);base64,(.+)$/);
    return m ? { mimeType: m[1], base64: m[2] } : null;
  },
};

export async function getRepo(): Promise<Repo> {
  if (!supabaseConfigured()) return memoryRepo;
  const { supabaseRepo } = await import("./repo-supabase");
  return supabaseRepo;
}
