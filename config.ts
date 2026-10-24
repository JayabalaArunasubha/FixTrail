/** Supabase mode requires all three values; otherwise the app runs in the labelled local demo mode. */
export function supabaseConfigured() {
  const real = (v?: string) => Boolean(v && !v.startsWith("your_"));
  return (
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")) &&
    real(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
    real(process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
}

export function gemmaConfigured() {
  const key = process.env.GEMINI_API_KEY?.trim();
  return Boolean(key && !key.startsWith("your_"));
}
