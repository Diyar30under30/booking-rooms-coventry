export const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL;
export const supabaseKey = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabaseConfigured = Boolean(supabaseUrl && supabaseKey);
export const googleAuthEnabled = import.meta.env?.VITE_GOOGLE_AUTH_ENABLED === 'true';
