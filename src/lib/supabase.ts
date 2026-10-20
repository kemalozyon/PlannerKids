import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Env yoksa null döner; uygulama demo moduna (localStorage) düşer. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

/**
 * Supabase panelinde açık olan giriş yöntemleri (Authentication → Providers) ve yeni hesap açılabiliyor mu
 * (Authentication → Sign In / Providers → "Allow new users to sign up"). Okunamazsa yalnızca e-postayla giriş varsayılır.
 */
export async function enabledProviders(): Promise<{ email: boolean; google: boolean; signup: boolean }> {
  try {
    const r = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key! } });
    const s = (await r.json()) as { external?: Record<string, boolean>; disable_signup?: boolean };
    return { email: s.external?.email !== false, google: !!s.external?.google, signup: !s.disable_signup };
  } catch {
    return { email: true, google: false, signup: false };
  }
}
