"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { buttonClass } from "./ui";

export function DemoControls() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  async function reset(empty: boolean) {
    if (!confirm(empty ? "Remove all demo data, including reports you created? This cannot be undone." : "Restore the sample data? Reports you created will be removed.")) return;
    const res = await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reset", empty }) });
    setMsg(res.ok ? (empty ? "Demo data cleared." : "Sample data restored.") : "Reset failed.");
    start(() => router.refresh());
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className={buttonClass("secondary", "sm")} disabled={pending} onClick={() => reset(false)}>
        <RotateCcw className="size-3.5" aria-hidden /> Restore sample data
      </button>
      <button className={buttonClass("ghost", "sm")} disabled={pending} onClick={() => reset(true)}>
        <Trash2 className="size-3.5" aria-hidden /> Start empty
      </button>
      {msg && <span className="text-xs text-ink-3" role="status">{msg}</span>}
    </div>
  );
}
