import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { supabaseConfigured } from "./config";
import { DEMO_USERS } from "./seed";
import type { Viewer } from "./domain";

export const DEMO_ROLE_COOKIE = "ft_demo_role";

/** Supabase client bound to the signed-in user's session cookies (anon key, RLS applies). */
export async function supabaseServerClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component; the proxy refreshes the session instead.
        }
      },
    },
  });
}

/**
 * Who is making this request. The role always comes from the server:
 * - Supabase mode: verified session + `profiles.role` (never from the client).
 * - Demo mode: a simulated identity chosen in the UI. This is NOT authentication.
 */
export async function getViewer(): Promise<Viewer | null> {
  if (!supabaseConfigured()) {
    const role = (await cookies()).get(DEMO_ROLE_COOKIE)?.value === "reporter" ? "reporter" : "staff";
    return DEMO_USERS[role];
  }
  const supabase = await supabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: profile } = await supabase.from("profiles").select("display_name, role").eq("id", data.user.id).single();
  return {
    id: data.user.id,
    name: profile?.display_name || data.user.email || "Signed-in user",
    role: profile?.role === "staff" ? "staff" : "reporter",
  };
}

/** For pages: the current viewer, or a redirect to sign-in (Supabase mode only; demo always has a viewer). */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}
