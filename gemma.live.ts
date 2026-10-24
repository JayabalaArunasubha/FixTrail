// Real integration test: calls the configured Gemma 4 model through the Gemini API.
// Run with `npm run test:live`. Skipped when GEMINI_API_KEY is not set.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const { triageWithGemma, gemmaModel } = await import("@/lib/gemma");
const { applySafetyRules } = await import("@/lib/safety");

describe.skipIf(!process.env.GEMINI_API_KEY)(`live Gemma triage (${gemmaModel()})`, () => {
  it("returns a schema-valid decision for a real hazard report", async () => {
    const report = {
      title: "Sparks from outlet in dorm kitchen",
      description: "When I plugged in the kettle the outlet next to the sink sparked and there is a burning smell. The wall around it is wet from a leak.",
      building: "Maple Hall",
      location: "3rd floor kitchen",
      category: null,
    };
    const { model, decision } = await triageWithGemma(report);
    process.stderr.write(`model=${model} priority=${decision.priority}\n`);
    expect(model).toBe(gemmaModel());
    expect(["critical", "high"]).toContain(decision.priority);
    expect(applySafetyRules(`${report.title}\n${report.description}`, decision).finalRecommendation?.priority).toBe("critical");
  }, 120_000);
});

// Route-level check: POST /api/triage -> service -> Gemma -> safety rules, with the real SDK.
// Forces the in-memory demo store so no database records are created or changed.
describe.skipIf(!process.env.GEMINI_API_KEY)("live POST /api/triage (in-memory store)", () => {
  it("stores a succeeded assessment from the configured Gemma model", async () => {
    for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) delete process.env[k];
    const { vi } = await import("vitest");
    const { DEMO_USERS } = await import("@/lib/seed");
    vi.doMock("@/lib/auth", () => ({ getViewer: async () => DEMO_USERS.staff }));
    const { resetDemoDb } = await import("@/lib/repo");
    resetDemoDb(true);
    const { POST: createIssue } = await import("@/app/api/issues/route");
    const { POST: triage } = await import("@/app/api/triage/route");
    const req = (url: string, body: unknown) => new Request(`http://local${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    const created = await (await createIssue(req("/api/issues", {
      title: "Projector flickering in lecture hall",
      description: "The ceiling projector in Lecture Hall B flickers every few seconds and sometimes turns off during class.",
      building: "Science Center", location: "Lecture Hall B", clientRequestId: crypto.randomUUID(),
    }), undefined)).json();
    const res = await triage(req("/api/triage", { issueId: created.issue.id }), undefined);
    const body = await res.json();
    process.stderr.write(`status=${res.status} assessment=${body.assessment?.status} model=${body.assessment?.modelName} error=${body.error ?? "none"}\n`);
    process.stderr.write(`final recommendation: ${JSON.stringify(body.assessment?.safetyOverride?.finalRecommendation ?? null, null, 2)}\n`);
    expect(res.status).toBe(200);
    expect(body.assessment.status).toBe("succeeded");
    expect(body.assessment.modelName).toBe(gemmaModel());
  }, 120_000);
});
