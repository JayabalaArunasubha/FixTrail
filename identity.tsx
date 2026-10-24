"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LogOut, UserRound } from "lucide-react";
import type { Viewer } from "@/lib/domain";

export function DemoIdentity({ viewer }: { viewer: Viewer }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);

  async function switchRole(role: string) {
    setError(false);
    const res = await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "role", role }) });
    if (!res.ok) return setError(true);
    start(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="demo-role" className="hidden text-xs text-ink-3 sm:block">
        Demo identity
      </label>
      <div className="relative">
        <UserRound className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
        <select
          id="demo-role"
          value={viewer.role}
          disabled={pending}
          onChange={(e) => switchRole(e.target.value)}
          aria-describedby="demo-role-note"
          className="h-8 appearance-none rounded-lg border border-line bg-surface pl-8 pr-7 text-[13px] text-ink hover:border-line-strong disabled:opacity-60"
        >
          <option value="staff">Jordan Reyes · Staff</option>
          <option value="reporter">Priya Nair · Reporter</option>
        </select>
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-ink-3">▼</span>
      </div>
      <span id="demo-role-note" className="sr-only">
        Simulated identity for the local demo. Not real authentication.
      </span>
      {error && <span className="text-xs text-critical">Couldn’t switch</span>}
    </div>
  );
}

export function SignedInIdentity({ viewer }: { viewer: Viewer }) {
  return (
    <form action="/auth/signout" method="post" className="flex items-center gap-2 text-[13px]">
      <span className="text-ink-2">
        {viewer.name} <span className="text-ink-3">· {viewer.role === "staff" ? "Staff" : "Reporter"}</span>
      </span>
      <button className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-ink-3 hover:bg-subtle hover:text-ink" aria-label="Sign out">
        <LogOut className="size-3.5" aria-hidden />
      </button>
    </form>
  );
}
