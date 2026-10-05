import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseKey, supabaseConfigured } from './auth-config.js';
export const supabase = supabaseConfigured ? createClient(supabaseUrl, supabaseKey, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
}) : null;

if (supabase && typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') setTimeout(() => window.dispatchEvent(new Event('session-expired')), 0);
    if (event === 'SIGNED_IN' || event === 'USER_UPDATED') setTimeout(() => window.dispatchEvent(new Event('auth-changed')), 0);
  });
}

export async function signInWithGoogle() {
  if (!supabase) throw new Error('Google sign-in is awaiting the hosted authentication setup.');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google', options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

function checked(result) {
  if (result.error) {
    const error = new Error(result.error.code === '23P01' ? 'This room is already booked during that time.' : result.error.message);
    error.status = result.error.status || (result.error.code === '23P01' ? 409 : 400);
    throw error;
  }
  return result.data;
}

async function session() {
  const auth = checked(await supabase.auth.getSession());
  if (!auth.session) return { user: null, csrfToken: null, setupRequired: false };
  // Profile authorization comes from protected database columns, never user_metadata.
  const profile = checked(await supabase.from('profiles').select('id,name,email,role,status').eq('id', auth.session.user.id).single());
  return { user: profile, csrfToken: null, setupRequired: false };
}

export async function supabaseRequest(path, options = {}) {
  const url = new URL(path, window.location.origin);
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : {};
  if (url.pathname === '/api/auth/session') return session();
  if (url.pathname === '/api/auth/login') {
    checked(await supabase.auth.signInWithPassword({ email: body.email, password: body.password }));
    return session();
  }
  if (url.pathname === '/api/auth/register') {
    const result = checked(await supabase.auth.signUp({ email: body.email, password: body.password,
      options: { emailRedirectTo: window.location.origin, data: { full_name: body.name, requested_role: body.role } } }));
    return { user: result.user, confirmationRequired: !result.session };
  }
  if (url.pathname === '/api/auth/logout') { checked(await supabase.auth.signOut()); return { ok: true }; }
  if (url.pathname === '/api/spaces') return checked(await supabase.from('spaces').select('*').order('id'));
  if (url.pathname === '/api/bookings' && method === 'GET') {
    return checked(await supabase.rpc('booking_schedule', { from_date: url.searchParams.get('from'), to_date: url.searchParams.get('to') || url.searchParams.get('from') }));
  }
  if (url.pathname === '/api/bookings/mine') return checked(await supabase.rpc('my_bookings'));
  if (url.pathname === '/api/bookings' && method === 'POST') {
    const current = await session();
    if (!current.user) throw new Error('Sign in to book a room.');
    return checked(await supabase.from('bookings').insert({ spaceId: body.spaceId, date: body.date, start: body.start, end: body.end, title: body.title, attendees: body.attendees, userId: current.user.id, source: 'booking' }).select('id').single());
  }
  if (/^\/api\/bookings\/\d+$/.test(url.pathname) && method === 'DELETE') {
    const rows = checked(await supabase.from('bookings').delete().eq('id', Number(url.pathname.split('/').pop())).select('id'));
    if (!rows.length) throw new Error('This booking cannot be cancelled by your account.');
    return { deleted: true };
  }
  if (url.pathname === '/api/admin/users' && method === 'GET') {
    let query = supabase.from('profiles').select('id,name,email,role,status').order('name');
    const status = url.searchParams.get('status');
    if (status && status !== 'all') query = query.eq('status', status);
    return checked(await query);
  }
  if (url.pathname.startsWith('/api/admin/users/') && method === 'PATCH') return { user: checked(await supabase.from('profiles').update({ status: body.status }).eq('id', url.pathname.split('/').pop()).select('id,name,email,role,status').single()) };
  throw new Error('This operation is not enabled for the hosted booking service yet.');
}
