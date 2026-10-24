"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Loader2 } from "lucide-react";
import { Alert, Field, buttonClass, inputClass } from "./ui";

export function LoginForm({ url, anonKey }: { url: string; anonKey: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "danger" | "success"; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const supabase = createBrowserClient(url, anonKey);
    const { error, data } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { display_name: name }, emailRedirectTo: `${window.location.origin}/auth/callback` } });
    setBusy(false);
    if (error) return setMsg({ tone: "danger", text: error.message });
    if (mode === "signup" && !data.session) return setMsg({ tone: "success", text: "Check your email to confirm your account, then sign in." });
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {mode === "signup" && (
        <Field label="Your name" htmlFor="name">
          <input id="name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" />
        </Field>
      )}
      <Field label="Email" htmlFor="email">
        <input id="email" type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </Field>
      <Field label="Password" htmlFor="password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
        <input id="password" type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
      </Field>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <button className={`${buttonClass("primary")} w-full`} disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {mode === "signin" ? "Sign in" : "Create account"}
      </button>
      <button type="button" className="w-full text-center text-sm text-brand hover:text-brand-strong" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
        {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
      <p className="text-center text-xs text-ink-3">New accounts are reporters. An administrator grants staff access.</p>
    </form>
  );
}
