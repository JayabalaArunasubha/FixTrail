import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Viewer } from "@/lib/domain";
import { DEMO_USERS } from "@/lib/seed";
import { decision } from "./logic.test";

// ---- Mocks: identity and the Google Gen AI SDK (no network, no credentials) ----
let viewer: Viewer | null = DEMO_USERS.staff;
vi.mock("@/lib/auth", () => ({ getViewer: async () => viewer }));

const generateContent = vi.fn();
vi.mock("@google/genai", async (orig) => {
  const actual = await orig<typeof import("@google/genai")>();
  return { ...actual, GoogleGenAI: vi.fn(function () { return { models: { generateContent } }; }) };
});

const { POST: createIssue, GET: listIssues } = await import("@/app/api/issues/route");
const { GET: getIssue, PATCH: patchIssue } = await import("@/app/api/issues/[id]/route");
const { POST: addActivity } = await import("@/app/api/issues/[id]/activity/route");
const { POST: triage } = await import("@/app/api/triage/route");
const { resetDemoDb, demoDb } = await import("@/lib/repo");
const { ApiError } = await import("@google/genai");

const json = (url: string, method: string, body: unknown) =>
  new Request(`http://test${url}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const report = (over: Record<string, unknown> = {}) => ({
  title: "Outlet cover loose in study room",
  description: "The cover plate on the outlet by the window is hanging off. Nothing else seems wrong.",
  building: "Hartley Library",
  location: "Study room 3",
  clientRequestId: crypto.randomUUID(),
  ...over,
});

async function submit(over: Record<string, unknown> = {}) {
  const res = await createIssue(json("/api/issues", "POST", report(over)), undefined);
  return { res, body: await res.json() };
}
const runTriage = async (issueId: string) => {
  const res = await triage(json("/api/triage", "POST", { issueId }), undefined);
  return { res, body: await res.json() };
};
const patch = async (id: string, body: unknown) => {
  const res = await patchIssue(json(`/api/issues/${id}`, "PATCH", body), ctx(id));
  return { res, body: await res.json() };
};
const modelReturns = (d: unknown) => generateContent.mockResolvedValue({ text: typeof d === "string" ? d : JSON.stringify(d) });

let clock = Date.now();
beforeEach(() => {
  // Advance the clock past the per-minute rate-limit window so tests don't throttle each other.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime((clock += 120_000));
  resetDemoDb(true);
  viewer = DEMO_USERS.staff;
  generateContent.mockReset();
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.GEMMA_MODEL;
});

describe("issue submission", () => {
  it("stores a valid complaint and records the audit event", async () => {
    viewer = DEMO_USERS.reporter;
    const { res, body } = await submit();
    expect(res.status).toBe(201);
    expect(body.issue).toMatchObject({ status: "new", priority: null, reporterId: "demo-reporter", reporterName: "Priya Nair" });
    expect(demoDb().activity.map((a) => a.actionType)).toEqual(["created"]);
  });

  it("rejects missing required fields with field messages", async () => {
    const { res, body } = await submit({ title: "", building: undefined });
    expect(res.status).toBe(400);
    expect(body.fields).toHaveProperty("title");
    expect(body.fields).toHaveProperty("building");
    expect(demoDb().issues).toHaveLength(0);
  });

  it("de-duplicates a repeated submission with the same request id", async () => {
    const id = crypto.randomUUID();
    const a = await submit({ clientRequestId: id });
    const b = await submit({ clientRequestId: id });
    expect(b.res.status).toBe(200);
    expect(b.body.duplicate).toBe(true);
    expect(b.body.issue.id).toBe(a.body.issue.id);
    expect(demoDb().issues).toHaveLength(1);
  });

  it("requires a signed-in user", async () => {
    viewer = null;
    const { res } = await submit();
    expect(res.status).toBe(401);
  });
});

describe("Gemma triage", () => {
  it("stores a validated assessment from the configured model", async () => {
    process.env.GEMMA_MODEL = "gemma-4-26b-a4b-it";
    modelReturns(decision({ priority: "medium" }));
    const { body: created } = await submit();
    const { res, body } = await runTriage(created.issue.id);

    expect(res.status).toBe(200);
    expect(body.assessment).toMatchObject({ status: "succeeded", modelName: "gemma-4-26b-a4b-it", promptVersion: "triage-v1.1" });
    expect(body.assessment.modelRecommendation.priority).toBe("medium");
    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe("gemma-4-26b-a4b-it");
    expect(call.config.systemInstruction).toMatch(/untrusted data/);
    expect(call.config.responseMimeType).toBe("application/json");
    expect(call.contents[0].parts[0].text).toContain("<report>");
    // AI never sets the approved priority on its own.
    expect(demoDb().issues[0]).toMatchObject({ priority: null, status: "new" });
  });

  it("rejects malformed AI output (after one retry) without losing the complaint", async () => {
    modelReturns({ ...decision(), priority: "super-urgent" });
    const { body: created } = await submit();
    const { res, body } = await runTriage(created.issue.id);
    expect(res.status).toBe(502);
    expect(body.assessment.status).toBe("failed");
    expect(body.error).toMatch(/failed validation/);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(demoDb().issues[0].status).toBe("new");
  });

  it("fails clearly when the API key is missing and never calls the SDK", async () => {
    delete process.env.GEMINI_API_KEY;
    const { body: created } = await submit();
    const { res, body } = await runTriage(created.issue.id);
    expect(res.status).toBe(502);
    expect(body.error).toMatch(/GEMINI_API_KEY is not configured/);
    expect(generateContent).not.toHaveBeenCalled();
    expect(demoDb().assessments[0].status).toBe("failed");
  });

  it("preserves the complaint when the API fails, and the case can be retried", async () => {
    generateContent.mockRejectedValue(new ApiError({ message: "backend error", status: 503 }));
    const { body: created } = await submit();
    const first = await runTriage(created.issue.id);
    expect(first.body.assessment.status).toBe("failed");
    expect(generateContent).toHaveBeenCalledTimes(5); // 1 try + 4 quick retries on 5xx
    expect(first.body.error).toMatch(/HTTP 503\)\. \(5 attempts\)/);
    expect(first.body.error).not.toMatch(/test-key/);
    expect(demoDb().issues).toHaveLength(1);

    generateContent.mockReset();
    generateContent.mockRejectedValueOnce(new ApiError({ message: "flaky", status: 500 })).mockResolvedValue({ text: JSON.stringify(decision()) });
    const retry = await runTriage(created.issue.id); // a transient 500 followed by success is recovered automatically
    expect(retry.body.assessment.status).toBe("succeeded");
    expect(demoDb().activity.map((a) => a.actionType)).toEqual(["created", "ai_requested", "ai_failed", "ai_requested", "ai_succeeded"]);
  });

  it("reports an unavailable model instead of substituting another", async () => {
    generateContent.mockRejectedValue(new ApiError({ message: "models/gemma-x is not found", status: 404 }));
    const { body: created } = await submit();
    const { body } = await runTriage(created.issue.id);
    expect(body.error).toMatch(/not available to this API key/);
    expect(new Set(generateContent.mock.calls.map((c) => c[0].model))).toEqual(new Set(["gemma-4-26b-a4b-it"]));
  });

  it("applies the safety override when the AI under-rates an electrical hazard", async () => {
    modelReturns(decision({ priority: "low" }));
    const { body: created } = await submit({ description: "There are exposed wires hanging out of the wall socket and I got a small shock." });
    const { body } = await runTriage(created.issue.id);
    expect(body.assessment.modelRecommendation.priority).toBe("low");
    expect(body.assessment.safetyOverride.applied).toBe(true);
    expect(body.assessment.safetyOverride.finalRecommendation.priority).toBe("critical");
    expect(body.assessment.safetyOverride.matchedRules.map((r: { id: string }) => r.id)).toEqual(expect.arrayContaining(["exposed_wiring", "electric_shock"]));
  });
});

describe("staff decisions and authorization", () => {
  async function triaged() {
    modelReturns(decision({ priority: "medium" }));
    const { body } = await submit();
    const { body: t } = await runTriage(body.issue.id);
    return { id: body.issue.id as string, assessmentId: t.assessment.id as string };
  }

  it("blocks reporters from modifying cases and hides other people's issues", async () => {
    const { id, assessmentId } = await triaged(); // filed by staff
    viewer = DEMO_USERS.reporter;
    const { res } = await patch(id, { action: "decide", mode: "accept", assessmentId, priority: "medium", category: "electrical", team: "Electrical Services" });
    expect(res.status).toBe(404); // cannot even see it
    expect((await getIssue(new Request("http://test"), ctx(id))).status).toBe(404);

    // Even on their own issue a reporter cannot approve priority or add staff notes.
    const own = await submit();
    expect((await patch(own.body.issue.id, { action: "decide", mode: "manual", priority: "critical", category: "other", team: "Custodial" })).res.status).toBe(403);
    expect((await addActivity(json("/x", "POST", { note: "hi there" }), ctx(own.body.issue.id))).status).toBe(403);
    expect(demoDb().issues.find((i) => i.id === own.body.issue.id)?.priority).toBeNull();
    const list = await (await listIssues(new Request("http://test/api/issues"), undefined)).json();
    expect(list.issues.map((i: { id: string }) => i.id)).toEqual([own.body.issue.id]);
  });

  it("requires a reason to override the AI recommendation and records both values", async () => {
    const { id, assessmentId } = await triaged();
    const override = { action: "decide", mode: "override", assessmentId, priority: "high", category: "electrical", team: "Electrical Services" };
    expect((await patch(id, override)).res.status).toBe(400);

    const ok = await patch(id, { ...override, reason: "Building is occupied by a summer camp this week." });
    expect(ok.res.status).toBe(200);
    expect(ok.body.issue).toMatchObject({ priority: "high", status: "triaged", assignedTeam: "Electrical Services" });
    const audit = demoDb().activity.find((a) => a.actionType === "decision_overridden")!;
    expect(audit.details).toMatchObject({ aiRecommendation: { priority: "medium" }, final: { priority: "high" }, reason: expect.stringContaining("summer camp"), model: "gemma-4-26b-a4b-it" });
  });

  it("rejects an 'accept' whose values don't match the recommendation", async () => {
    const { id, assessmentId } = await triaged();
    const { res } = await patch(id, { action: "decide", mode: "accept", assessmentId, priority: "low", category: "electrical", team: "Electrical Services" });
    expect(res.status).toBe(400);
  });

  it("walks through valid status transitions and blocks invalid ones", async () => {
    const { id, assessmentId } = await triaged();
    expect((await patch(id, { action: "start" })).res.status).toBe(409); // not triaged yet
    await patch(id, { action: "decide", mode: "accept", assessmentId, priority: "medium", category: "electrical", team: "Electrical Services", assignedTo: "Kwame Mensah" });
    expect((await patch(id, { action: "start" })).body.issue.status).toBe("in_progress");
    expect((await patch(id, { action: "start" })).res.status).toBe(409); // repeated change
    expect((await patch(id, { action: "resolve", resolutionNotes: "short" })).res.status).toBe(400);

    const done = await patch(id, { action: "resolve", resolutionNotes: "Replaced the outlet cover plate and tested the outlet." });
    expect(done.body.issue).toMatchObject({ status: "resolved", resolutionNotes: expect.stringContaining("cover plate") });
    expect(done.body.issue.resolvedAt).toBeTruthy();
    expect((await patch(id, { action: "decide", mode: "accept", assessmentId, priority: "medium", category: "electrical", team: "Electrical Services" })).res.status).toBe(409);

    const reopened = await patch(id, { action: "reopen", reason: "Cover fell off again the next day." });
    expect(reopened.body.issue).toMatchObject({ status: "in_progress", resolvedAt: null });
    expect(demoDb().activity.map((a) => a.actionType)).toEqual(
      expect.arrayContaining(["decision_accepted", "status_changed", "resolved", "reopened"]),
    );
  });

  it("lets staff triage manually when the AI failed", async () => {
    delete process.env.GEMINI_API_KEY;
    const { body } = await submit();
    await runTriage(body.issue.id);
    const { res, body: updated } = await patch(body.issue.id, { action: "decide", mode: "manual", priority: "low", category: "electrical", team: "Electrical Services" });
    expect(res.status).toBe(200);
    expect(updated.issue.status).toBe("triaged");
  });
});

describe("safety rules without the model", () => {
  it("records hazards on a failed assessment and requires a reason to triage below the floor", async () => {
    delete process.env.GEMINI_API_KEY;
    const { body } = await submit({ description: "Smoke is coming out of the breaker panel in the hallway closet." });
    const { body: t } = await runTriage(body.issue.id);
    expect(t.assessment.status).toBe("failed");
    expect(t.assessment.safetyOverride.matchedRules.map((r: { id: string }) => r.id)).toContain("fire_smoke");

    const low = { action: "decide", mode: "manual", priority: "low", category: "electrical", team: "Electrical Services" };
    expect((await patch(body.issue.id, low)).res.status).toBe(400);
    const ok = await patch(body.issue.id, { ...low, reason: "Electrician confirmed it was dust from a renovation, not smoke." });
    expect(ok.res.status).toBe(200);
    expect(demoDb().activity.find((a) => a.actionType === "decision_manual")?.details.belowSafetyFloor).toBe(true);
  });
});
