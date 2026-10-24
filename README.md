# FixTrail — AI Maintenance Intelligence & Resolution System

FixTrail helps colleges and apartment communities go from **“something is broken”** to **“fixed, and here is the proof”**, with an AI that recommends and a human who decides.

## The problem

Maintenance reports arrive as free text from people who don't know whether a dripping ceiling is cosmetic or a hazard. Staff have to work out urgency, route the job, chase it, and remember that the same bathroom leaked twice last month. Spreadsheets and email lose that trail.

## The solution

1. **Report** — anyone submits a plain-language report (optional photo). It is **saved before any AI call**, so nothing is lost.
2. **Gemma 4 assesses** — the server sends the report to Google's **Gemma 4** model, which returns a structured recommendation: priority, category, responsible team, fact-based rationale, safety flags, next steps, escalation advice, and missing information.
3. **Safety layer** — fixed, transparent rules (exposed wiring, shock, sparks, smoke/fire, gas, structural danger, water near electrics, …) check the report text. A known hazard can never be ranked below its minimum. The original model output and the post-rule recommendation are stored separately.
4. **Human decision** — staff accept the recommendation or override it (a reason is required). Going below a safety minimum also requires a reason.
5. **Track & resolve** — assign, start work, resolve with notes and an optional evidence photo, reopen if it wasn't really fixed.
6. **Audit trail** — every report, AI request/result, decision, assignment, status change, and note is recorded with the model name and prompt version.
7. **Insight** — the dashboard shows open, critical/high, overdue, and resolved counts derived from real records; the Recurring view groups repeat reports at the same place.

## Features

| Screen | What it does |
| --- | --- |
| Overview | Metrics, “needs attention” list (overdue → priority), category breakdown, recurring issues, activity feed, period selector |
| Report an issue | Accessible form, client + server validation, photo upload (JPEG/PNG/WebP ≤ 5 MB), duplicate-submit protection, progress steps |
| Issues | Search (title/description/location), filters (status, priority, category, team), sort (severity, deadline, newest, oldest), pagination, mobile layout |
| Issue detail | Original report, **Gemma 4 AI Assessment** panel, safety-rule check, AI vs. approved comparison, decision form, assignment, status actions, resolution evidence, full timeline, staff notes |
| Recurring | Deterministic grouping with the exact reason each group was formed |
| AI & settings | What Gemma does, what is sent, the safety rules, override policy, failure behaviour, config status |

## Architecture

```
app/                      Next.js 16 App Router (server components for pages)
  api/issues              POST create · GET list (filters via query string)
  api/issues/[id]         GET detail · PATCH decide/assign/start/resolve/reopen
  api/issues/[id]/activity POST staff note
  api/triage              POST run a real Gemma 4 assessment
  api/demo                demo-mode identity switch / data reset (disabled with Supabase)
components/               UI (ui.tsx design primitives, AI panel, forms, timeline)
lib/
  domain.ts               types, constants, Zod schemas (requests + Gemma decision)
  gemma.ts                @google/genai client, versioned system instruction, validation, retries
  safety.ts               deterministic hazard rules
  service.ts              workflow + authorization (single place every route goes through)
  repo.ts                 storage interface + in-memory demo store
  repo-supabase.ts        Supabase PostgreSQL + Storage implementation
  insights.ts             metrics, recurring detection, list filtering
  auth.ts                 who is the viewer (Supabase session or demo identity)
supabase/schema.sql       tables, constraints, indexes, RLS, storage bucket
tests/                    Vitest suites (+ optional live Gemma test)
```

**Who builds what:** *Claude Code* (Anthropic's coding agent) was used to develop this application. *Gemma 4* (Google's open model, called at runtime through the Gemini API) makes the triage recommendations inside the running app. They are unrelated at runtime.

## How Gemma 4 is used

- SDK: official `@google/genai`, server-side only (`lib/gemma.ts`, called from `app/api/triage/route.ts`).
- Model: `GEMMA_MODEL` (default `gemma-4-26b-a4b-it`). **No fallback model** — if it is unavailable the assessment fails visibly.
- The request uses a versioned system instruction (`triage-v1.1`) that spells out the exact JSON shape, asks for JSON output (`responseMimeType`), and wraps the report in `<report>` tags marked as untrusted data. If the hosted model rejects system instructions or JSON mode, the *same model* is retried with the instructions inlined.
- Every field is validated (enums, team from a fixed list, lengths, confidence 0–1, no extra keys). Malformed output → one retry → `failed`.
- `responseJsonSchema` is not sent; the JSON shape is in the system instruction and every field is validated server-side. Gemma 4 always reasons before answering (thinking cannot be disabled on this model), so typical latency is 10–60 s.
- The hosted Gemma 4 endpoint intermittently returns `HTTP 500 INTERNAL` within about a second (observed on roughly half of requests in October 2026). FixTrail retries 5xx up to 4 times with short backoff, rate limits and malformed output once, and timeouts (90 s) not at all, then a stored `failed` assessment with a safe message and a **Retry** button. The issue stays “Awaiting triage” for manual handling.
- Assessments are `pending`, `succeeded`, or `failed`; the UI never shows a failed or missing assessment as a successful one. Sample records ship **without** AI output — we never fabricate it.
- Data sent: title, description, building, location, optional category, optional photo. Not sent: names, IDs, notes, other cases.

## Setup

Requirements: Node.js 20+.

```bash
npm install
cp .env.example .env.local   # then put real values in .env.local (never in .env.example)
npm run dev                  # open http://localhost:3000
```

FixTrail is **one Next.js server**: the pages and the backend API routes (`/api/*`) run together on port 3000. There is no separate backend to start, and nothing else needs to run alongside it.

> **Opened the wrong app?** In the Claude desktop Code tab, the **Servers** menu and preview use the `.claude/launch.json` of the folder the *session was created in*; changing directory mid-session does not switch it. Start a new session on this `FixTrail AI` folder (its launch config has one server, `fixtrail`, on port 3000), or just run `npm run dev` here. The dev script pins port 3000 and fails with `EADDRINUSE` if something else holds it, instead of silently moving to 3001.

### Environment variables

| Variable | Needed for | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | AI triage | Server-only. Never prefixed with `NEXT_PUBLIC_`. |
| `GEMMA_MODEL` | AI triage | Defaults to `gemma-4-26b-a4b-it`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Persistent mode | Public by design. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Persistent mode | Your **publishable** key (`sb_publishable_…`) or legacy anon key. Public by design; RLS protects tables. |
| `SUPABASE_SERVICE_ROLE_KEY` | Persistent mode | Your **secret** key (`sb_secret_…`) or legacy service-role key. **Server-only.** Never exposed to the browser. |

Real values go in **`.env.local`** only. Next.js does not read `.env.example`, and `.env.example` is meant to be committed, so it must contain placeholders only.

**Getting a Gemini API key:** open [Google AI Studio → API keys](https://aistudio.google.com/apikey), sign in, click **Create API key**, and paste it into `.env.local` as `GEMINI_API_KEY=...` on your machine. Restart `npm run dev`. Don't paste it into source code or share it. `.env*` files (except `.env.example`) are git-ignored.

**Check model access:** with the key set, run `npm run test:live`. It makes one real call to the configured Gemma model. If it reports *“Model … is not available to this API key”*, the model isn't enabled for your account/region — FixTrail will not substitute another model. Check the model list in AI Studio and set `GEMMA_MODEL` to an available Gemma 4 variant.

### Modes

- **Local demo mode** (no Supabase variables): data is kept in the server's memory, seeded with clearly labelled *Sample* records, not shared between server instances, and reset on restart. A banner says so on every page. A **Demo identity** switcher lets you act as a staff member or a reporter — this simulates roles and is **not authentication**. Staff can restore or clear demo data in *AI & settings*.
- **Supabase mode** (all three Supabase variables set): real persistence and email/password auth.

### Database setup (Supabase)

1. Create a Supabase project. Copy the URL, publishable key, and secret key into `.env.local`. Until the schema exists, FixTrail shows a **Database setup required** screen listing what is missing.
2. Optional: run [`supabase/inspect.sql`](supabase/inspect.sql) (read-only) to check for name clashes with anything already in the project.
3. In the SQL editor, run [`supabase/schema.sql`](supabase/schema.sql). It creates `profiles`, `issues`, `ai_assessments`, `issue_activity`, constraints, indexes, RLS policies, and a private `attachments` storage bucket.
4. In Authentication → URL Configuration, set **Site URL** to `http://localhost:3000` and add `http://localhost:3000/auth/callback` to **Redirect URLs** (email confirmation links land there).
5. Sign up in the app (new users are reporters). Promote staff in SQL:
   ```sql
   update public.profiles set role = 'staff' where id = '<auth user uuid>';
   ```

Authorization: the server derives the role from `profiles.role` (never from the client) and scopes every query in `lib/service.ts` / `lib/repo-supabase.ts`. Reporters see only their own issues (others return 404), can reopen their own resolved issues, and cannot triage, assign, resolve, override, or add staff notes. RLS gives signed-in users read-only access to their own rows through the anon key; all writes go through the server.

## Testing

```bash
npm run lint
npm run typecheck
npm test            # no credentials needed; the Gemini SDK is mocked
npm run test:live   # optional: real Gemma 4 call, skipped without GEMINI_API_KEY
npm run build
```

The automated suite covers: valid submission, missing fields, duplicate submit, unauthenticated access, successful (mocked) Gemma assessment, malformed and out-of-range AI output, missing API key, API failure without data loss + retry, unavailable model without substitution, electrical hazard override, low AI priority vs. severe hazard, safety rules when the model fails, reporter authorization, override-requires-reason, accept-must-match, status transitions/resolution/reopen, manual triage, recurring detection, and dashboard metrics.

## Deployment

Deploy to any Node.js host that runs Next.js (e.g. Vercel): set the environment variables in the host's dashboard (keep `GEMINI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` server-only), use Supabase mode, and run `npm run build`. Demo mode is not suitable for deployment: memory isn't shared across serverless instances. The rate limiter is per-process; put a shared limiter (e.g. Redis) in front for multi-instance production.

## Known limitations

- Safety rules are regular expressions over English text; they reduce, but cannot eliminate, missed hazards.
- Recurring detection is lexical (shared location, category, and wording), not semantic, and does not establish root cause.
- Supabase mode was written against the documented APIs but needs a real project to verify end-to-end.

## License

[MIT](LICENSE)
