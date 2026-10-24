import { Database, ExternalLink, TerminalSquare } from "lucide-react";

/** Shown instead of the app when Supabase is configured but FixTrail's tables/bucket don't exist yet. */
export function SetupRequired({ missing, error }: { missing: string[]; error?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl rounded-xl border border-line bg-surface p-6 shadow-card sm:p-8">
        <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-high-soft text-high">
          <Database className="size-5" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Database setup required</h1>
        <p className="mt-2 text-sm text-ink-2">
          FixTrail is connected to your Supabase project, but its tables are not there yet. No data has been changed; FixTrail never creates tables on its own.
        </p>
        {error ? (
          <p className="mt-4 rounded-lg bg-critical-soft px-4 py-3 text-sm text-critical">{error}</p>
        ) : (
          <div className="mt-4 rounded-lg bg-subtle px-4 py-3 text-sm">
            <p className="font-medium text-ink">Missing</p>
            <ul className="mt-1 list-disc pl-5 text-ink-2">
              {missing.map((m) => <li key={m}>{m}</li>)}
            </ul>
          </div>
        )}
        <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm text-ink-2">
          <li>
            Optional: run <code className="font-mono text-[13px]">supabase/inspect.sql</code> in the Supabase SQL editor to confirm nothing conflicts.
          </li>
          <li>
            Run <code className="font-mono text-[13px]">supabase/schema.sql</code> in the SQL editor.
          </li>
          <li>Reload this page.</li>
        </ol>
        <p className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
          <span className="inline-flex items-center gap-1"><TerminalSquare className="size-3.5" aria-hidden /> To use the local demo instead, remove the Supabase values from .env.local and restart.</span>
          <a className="inline-flex items-center gap-1 text-brand hover:text-brand-strong" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">
            Open Supabase dashboard <ExternalLink className="size-3" aria-hidden />
          </a>
        </p>
      </div>
    </div>
  );
}
