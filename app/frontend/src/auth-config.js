export const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL;
export const supabaseKey = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabaseConfigured = import.meta.env?.MODE !== 'campus-local' && Boolean(supabaseUrl && supabaseKey);
export const googleAuthEnabled = supabaseConfigured && import.meta.env?.VITE_GOOGLE_AUTH_ENABLED === 'true';
