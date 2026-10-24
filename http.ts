import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getViewer } from "./auth";
import { ServiceError } from "./service";
import type { Viewer } from "./domain";

export const jsonError = (status: number, error: string, fields?: Record<string, string>) =>
  NextResponse.json({ error, ...(fields ? { fields } : {}) }, { status });

export function zodFields(err: ZodError) {
  const fields: Record<string, string> = {};
  for (const i of err.issues) fields[String(i.path[0] ?? "form")] ??= i.message;
  return fields;
}

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw r.error;
  return r.data;
}

// ponytail: in-memory fixed window per process; use Upstash/Redis when running multiple instances.
const hits = new Map<string, { count: number; reset: number }>();
export function rateLimited(key: string, limit: number, windowMs = 60_000) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { count: 1, reset: now + windowMs });
    return false;
  }
  return ++h.count > limit;
}

/** Wrap a route handler: resolve the viewer, map known errors to safe responses, never leak internals. */
export function handler<C>(fn: (req: Request, viewer: Viewer, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      const viewer = await getViewer();
      if (!viewer) return jsonError(401, "Sign in to continue.");
      return await fn(req, viewer, ctx);
    } catch (err) {
      if (err instanceof ServiceError) return jsonError(err.status, err.message);
      if (err instanceof Error && "databaseSetup" in err) {
        return jsonError(503, "The FixTrail database tables are not set up yet. Apply supabase/schema.sql in your Supabase project.");
      }
      if (err instanceof ZodError) return jsonError(400, "Please fix the highlighted fields.", zodFields(err));
      if (err instanceof SyntaxError) return jsonError(400, "Request body must be valid JSON.");
      console.error("[api] unexpected error:", err instanceof Error ? err.message : "unknown");
      return jsonError(500, "Something went wrong on our side. Your data has not been lost; please try again.");
    }
  };
}
