import { describe, expect, it } from "vitest";
import { applySafetyRules, matchSafetyRules } from "@/lib/safety";
import { parseDecision } from "@/lib/gemma";
import { computeMetrics, findRecurring } from "@/lib/insights";
import { seedDemoData } from "@/lib/seed";
import type { GemmaDecision, Issue } from "@/lib/domain";

export const decision = (over: Partial<GemmaDecision> = {}): GemmaDecision => ({
  priority: "low",
  category: "electrical",
  responsibleTeam: "Electrical Services",
  summary: "Outlet cover is loose in the study room.",
  rationale: "The report describes a loose cover plate with no mention of injury or sparks.",
  safetyFlags: [],
  immediateActions: ["Schedule an electrician to inspect the outlet."],
  needsHumanReview: false,
  missingInformation: [],
  escalationRecommended: false,
  ...over,
});

describe("safety layer", () => {
  it("flags exposed wiring and raises a low AI priority to critical", () => {
    const r = applySafetyRules("Exposed wires behind the panel in Lab 3, students nearby", decision({ priority: "low" }));
    expect(r.applied).toBe(true);
    expect(r.matchedRules.map((m) => m.id)).toContain("exposed_wiring");
    expect(r.finalRecommendation?.priority).toBe("critical");
    expect(r.finalRecommendation?.needsHumanReview).toBe(true);
    expect(r.finalRecommendation?.escalationRecommended).toBe(true);
    expect(r.explanation).toMatch(/raised priority from low to critical/);
  });

  it("never downgrades a known severe hazard but keeps the model output separate", () => {
    const model = decision({ priority: "medium", category: "plumbing", responsibleTeam: "Plumbing" });
    const r = applySafetyRules("Water is dripping onto the power strip under the desk", model);
    expect(model.priority).toBe("medium"); // original untouched
    expect(r.finalRecommendation?.priority).toBe("critical");
    expect(r.matchedRules[0].id).toBe("water_electrical");
  });

  it("does not mark an override when the model already met the floor", () => {
    const r = applySafetyRules("Smell of smoke near the dryer", decision({ priority: "critical" }));
    expect(r.applied).toBe(false);
    expect(r.matchedRules.length).toBeGreaterThan(0);
    expect(r.finalRecommendation?.needsHumanReview).toBe(true);
  });

  it("leaves ordinary reports alone", () => {
    expect(matchSafetyRules("Projector remote has dead batteries")).toEqual([]);
    const r = applySafetyRules("Projector remote has dead batteries", decision({ priority: "low" }));
    expect(r.applied).toBe(false);
    expect(r.finalRecommendation?.priority).toBe("low");
  });
});

describe("model output validation", () => {
  it("accepts a valid decision, including fenced JSON", () => {
    expect(parseDecision("```json\n" + JSON.stringify(decision()) + "\n```").priority).toBe("low");
  });
  it.each([
    ["empty", ""],
    ["not json", "I think this is urgent."],
    ["bad priority", JSON.stringify(decision({ priority: "urgent" as never }))],
    ["unknown team", JSON.stringify(decision({ responsibleTeam: "Ghostbusters" as never }))],
    ["confidence out of range", JSON.stringify(decision({ confidence: 7 }))],
    ["missing field", JSON.stringify({ ...decision(), rationale: undefined })],
    ["extra field", JSON.stringify({ ...decision(), repaired: true })],
  ])("rejects %s", (_, raw) => {
    expect(() => parseDecision(raw)).toThrow(/model/i);
  });
});

describe("recurring issues", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  const { issues } = seedDemoData(now);

  it("groups the same leak at Maple Hall 214 despite different spellings", () => {
    const groups = findRecurring(issues, new Map(), now);
    const maple = groups.find((g) => g.building === "Maple Hall");
    expect(maple?.issues).toHaveLength(3);
    expect(maple?.sharedLocation).toEqual(expect.arrayContaining(["214", "bathroom"]));
    expect(maple?.reason).toMatch(/plumbing/);
  });

  it("matches ordinal variants (2nd vs second) and keeps unrelated issues out", () => {
    const groups = findRecurring(issues, new Map(), now);
    const lib = groups.find((g) => g.building === "Hartley Library");
    expect(lib?.issues.map((i) => i.category)).toEqual(["networking", "networking"]);
    const grouped = new Set(groups.flatMap((g) => g.issues.map((i) => i.id)));
    expect([...grouped].some((id) => issues.find((i) => i.id === id)?.title.includes("Projector"))).toBe(false);
  });

  it("does not group reports in different buildings", () => {
    const base = issues[0];
    const copy: Issue = { ...base, id: "x", building: "Science Center" };
    const groups = findRecurring([base, copy], new Map(), now);
    expect(groups).toHaveLength(0);
  });
});

describe("dashboard metrics", () => {
  it("derives every number from the records", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    const h = (n: number) => new Date(now.getTime() - n * 3_600_000).toISOString();
    const mk = (over: Partial<Issue>): Issue => ({
      id: Math.random().toString(36), title: "t", description: "d", building: "B", location: "L", category: "plumbing",
      reporterId: "r", reporterName: "R", priority: "medium", status: "triaged", assignedTeam: "Plumbing", assignedTo: null,
      createdAt: h(10), updatedAt: h(1), dueAt: h(-5), resolvedAt: null, resolutionNotes: null, photoRef: null, resolutionPhotoRef: null, ...over,
    });
    const issues = [
      mk({ priority: "critical", dueAt: h(1) }), // open, overdue
      mk({ priority: "high" }),
      mk({ status: "new", priority: null, category: null }),
      mk({ status: "resolved", resolvedAt: h(24 * 3) }),
      mk({ status: "resolved", resolvedAt: h(24 * 40) }),
    ];
    const m = computeMetrics(issues, new Map(), now, 30);
    expect(m).toMatchObject({ open: 3, criticalHigh: 2, overdue: 1, awaitingTriage: 1, resolvedInPeriod: 1 });
    expect(m.attention[0].priority).toBe("critical"); // overdue critical first
    expect(Object.fromEntries(m.categories)).toEqual({ plumbing: 2, uncategorized: 1 });
    expect(computeMetrics(issues, new Map(), now, 90).resolvedInPeriod).toBe(2);
  });
});
