import { issueText, safetyFloor } from "./safety";
import { PRIORITY_RANK, type Assessment, type Category, type Issue, type Priority } from "./domain";

type LatestMap = Map<string, Assessment>;

export const aiRecommendation = (a: Assessment | undefined) =>
  a?.status === "succeeded" ? (a.safetyOverride?.finalRecommendation ?? null) : null;

/**
 * Human-approved priority; else the AI's post-safety-rule recommendation; else the deterministic
 * safety floor (so hazards stay visible when the model is unavailable). Non-human values show as "suggested".
 */
export function effectivePriority(issue: Issue, a?: Assessment): { priority: Priority | null; source: "human" | "ai" | "rule" | null } {
  if (issue.priority) return { priority: issue.priority, source: "human" };
  const rec = aiRecommendation(a);
  if (rec) return { priority: rec.priority, source: "ai" };
  const floor = safetyFloor(issueText(issue));
  return floor ? { priority: floor, source: "rule" } : { priority: null, source: null };
}

export const effectiveCategory = (issue: Issue, a?: Assessment): Category | null =>
  issue.status !== "new" ? issue.category : (aiRecommendation(a)?.category ?? issue.category);

export const isOpen = (i: Issue) => i.status !== "resolved";
export const isOverdue = (i: Issue, now: Date) => isOpen(i) && !!i.dueAt && Date.parse(i.dueAt) < now.getTime();

const rank = (p: Priority | null) => (p ? PRIORITY_RANK[p] : 2.5); // unknown sits between medium and low

export function attentionScore(i: Issue, a: Assessment | undefined, now: Date) {
  return (isOverdue(i, now) ? 0 : 10) + rank(effectivePriority(i, a).priority);
}

// ---------- Dashboard metrics ----------

export function computeMetrics(issues: Issue[], latest: LatestMap, now: Date, periodDays: number) {
  const open = issues.filter(isOpen);
  const since = now.getTime() - periodDays * 86_400_000;
  const categories = new Map<string, number>();
  for (const i of open) {
    const c = effectiveCategory(i, latest.get(i.id)) ?? "uncategorized";
    categories.set(c, (categories.get(c) ?? 0) + 1);
  }
  return {
    open: open.length,
    criticalHigh: open.filter((i) => i.priority === "critical" || i.priority === "high").length,
    aiFlaggedUntriaged: open.filter((i) => {
      const p = effectivePriority(i, latest.get(i.id));
      return p.source !== "human" && (p.priority === "critical" || p.priority === "high");
    }).length,
    overdue: open.filter((i) => isOverdue(i, now)).length,
    awaitingTriage: open.filter((i) => i.status === "new").length,
    resolvedInPeriod: issues.filter((i) => i.resolvedAt && Date.parse(i.resolvedAt) >= since).length,
    categories: [...categories.entries()].sort((a, b) => b[1] - a[1]),
    attention: open
      .slice()
      .sort((a, b) => attentionScore(a, latest.get(a.id), now) - attentionScore(b, latest.get(b.id), now) || (a.dueAt ?? "").localeCompare(b.dueAt ?? ""))
      .slice(0, 6),
  };
}

// ---------- Recurring issues ----------

const STOP = new Set(
  "a an the and or of in on at to for from with is are was were be been it its this that there near by again still very some our my we i they has have had not no but so as up down into out about over".split(" "),
);
const ORDINALS: Record<string, string> = { first: "1", second: "2", third: "3", fourth: "4", fifth: "5", "1st": "1", "2nd": "2", "3rd": "3", "4th": "4", "5th": "5" };
const LOCATION_NOISE = new Set(["room", "rm", "no", "number", "the", "near", "by", "of"]);

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "") || w;

export const locationTokens = (location: string) =>
  new Set(words(location).map((w) => ORDINALS[w] ?? w).filter((w) => !LOCATION_NOISE.has(w)).map(stem));
export const textTokens = (s: string) => new Set(words(s).filter((w) => w.length > 2 && !STOP.has(w)).map(stem));
export const normalizeBuilding = (b: string) => words(b).join(" ");

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
const shared = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x));

export const RECURRING_RULES = {
  windowDays: 90,
  minLocationSimilarity: 0.5,
  minTextSimilarity: 0.12,
};

export interface RecurringGroup {
  key: string;
  issues: Issue[];
  building: string;
  category: Category | null;
  sharedLocation: string[];
  sharedTerms: string[];
  reason: string;
}

/**
 * Deterministic grouping: two reports are linked when they share a building and category,
 * their normalized locations overlap, and their wording overlaps. Groups are connected components.
 * ponytail: O(n²) pair scan over the 90-day window; fine for thousands of reports, bucket by building if it grows.
 */
export function findRecurring(issues: Issue[], latest: LatestMap, now: Date): RecurringGroup[] {
  const since = now.getTime() - RECURRING_RULES.windowDays * 86_400_000;
  const items = issues
    .filter((i) => Date.parse(i.createdAt) >= since)
    .map((i) => ({
      issue: i,
      building: normalizeBuilding(i.building),
      category: effectiveCategory(i, latest.get(i.id)),
      loc: locationTokens(i.location),
      text: textTokens(`${i.title} ${i.description}`),
    }));

  const parent = items.map((_, n) => n);
  const find = (n: number): number => (parent[n] === n ? n : (parent[n] = find(parent[n])));
  for (let x = 0; x < items.length; x++) {
    for (let y = x + 1; y < items.length; y++) {
      const a = items[x];
      const b = items[y];
      if (a.building !== b.building || !a.category || a.category !== b.category) continue;
      if (jaccard(a.loc, b.loc) < RECURRING_RULES.minLocationSimilarity) continue;
      if (jaccard(a.text, b.text) < RECURRING_RULES.minTextSimilarity) continue;
      parent[find(x)] = find(y);
    }
  }

  const groups = new Map<number, typeof items>();
  items.forEach((it, n) => groups.set(find(n), [...(groups.get(find(n)) ?? []), it]));

  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      const sharedLocation = g.slice(1).reduce((acc, it) => new Set(shared(acc, it.loc)), g[0].loc);
      const termCounts = new Map<string, number>();
      g.forEach((it) => it.text.forEach((t) => termCounts.set(t, (termCounts.get(t) ?? 0) + 1)));
      const sharedTerms = [...termCounts.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
      const sorted = g.map((it) => it.issue).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const first = g[0];
      return {
        key: sorted.map((i) => i.id).join("|"),
        issues: sorted,
        building: first.issue.building,
        category: first.category,
        sharedLocation: [...sharedLocation],
        sharedTerms,
        reason: `${g.length} reports in ${first.issue.building} within ${RECURRING_RULES.windowDays} days share the category “${first.category}”, a matching location (${[...sharedLocation].join(", ") || "overlapping area"}), and similar wording (${sharedTerms.join(", ") || "overlapping terms"}).`,
      };
    })
    .sort((a, b) => b.issues.length - a.issues.length || b.issues[0].createdAt.localeCompare(a.issues[0].createdAt));
}

// ---------- List filtering ----------

export interface IssueQuery {
  q?: string;
  priority?: string;
  category?: string;
  team?: string;
  status?: string;
  sort?: string;
}

export function filterIssues(issues: Issue[], latest: LatestMap, query: IssueQuery, now: Date) {
  const q = query.q?.trim().toLowerCase();
  const out = issues.filter((i) => {
    const a = latest.get(i.id);
    if (q && ![i.title, i.description, i.building, i.location].some((f) => f.toLowerCase().includes(q))) return false;
    if (query.priority && effectivePriority(i, a).priority !== query.priority) return false;
    if (query.category && effectiveCategory(i, a) !== query.category) return false;
    if (query.team && i.assignedTeam !== query.team) return false;
    if (query.status === "open" && !isOpen(i)) return false;
    if (query.status === "overdue" && !isOverdue(i, now)) return false;
    if (query.status && !["open", "overdue"].includes(query.status) && i.status !== query.status) return false;
    return true;
  });
  const sort = query.sort ?? "severity";
  return out.sort((a, b) => {
    if (sort === "newest") return b.createdAt.localeCompare(a.createdAt);
    if (sort === "oldest") return a.createdAt.localeCompare(b.createdAt);
    if (sort === "deadline") return (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999");
    const resolved = Number(!isOpen(a)) - Number(!isOpen(b));
    return resolved || attentionScore(a, latest.get(a.id), now) - attentionScore(b, latest.get(b.id), now) || a.createdAt.localeCompare(b.createdAt);
  });
}
