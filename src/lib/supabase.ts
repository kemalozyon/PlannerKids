import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Env yoksa null döner; uygulama demo moduna (localStorage) düşer. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

/** Supabase panelinde açık olan giriş yöntemleri (Authentication → Providers). Okunamazsa yalnızca e-posta varsayılır. */
export async function enabledProviders(): Promise<{ email: boolean; google: boolean }> {
  try {
    const r = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key! } });
    const s = (await r.json()) as { external?: Record<string, boolean> };
    return { email: s.external?.email !== false, google: !!s.external?.google };
  } catch {
    return { email: true, google: false };
  }
}
