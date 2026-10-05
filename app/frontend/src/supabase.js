import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseKey, supabaseConfigured } from './auth-config.js';
import { parseCsv } from '../../shared/csv.mjs';
import { bookingErrors, overlaps } from '../../shared/booking-rules.mjs';
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

async function hostedEvents(csv, importing) {
  const current = await session();
  if (current.user?.role !== 'admin' || current.user?.status !== 'approved') throw new Error('Administrator access required.');
  let parsed;
  try { parsed = parseCsv(csv); } catch (error) {
    if (importing) throw error;
    return { valid: false, rows: [{ row: 1, errors: [error.message] }] };
  }
  const spaces = checked(await supabase.from('spaces').select('*').eq('active', 1).eq('type', 'classroom'));
  const campusNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Qyzylorda' }));
  const rows = parsed.map(entry => {
    const matches = spaces.filter(space => /^\d+$/.test(entry.classroom) ? space.id === Number(entry.classroom) : space.name === entry.classroom);
    const space = matches.length === 1 ? matches[0] : null;
    const row = { ...entry, spaceId: space?.id, attendees: entry.attendees ? Number(entry.attendees) : 1 };
    return { ...row, errors: bookingErrors(row, space, campusNow) };
  });
  // Check each date without relying on the API's default row limit for the whole inventory.
  for (const date of new Set(rows.filter(row => !row.errors.length).map(row => row.date))) {
    const existing = checked(await supabase.rpc('booking_schedule', { from_date: date, to_date: date }));
    for (const row of rows.filter(row => row.date === date)) if (existing.some(other => overlaps(row, other))) row.errors.push('This room already has a reservation or event during that time.');
  }
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) if (rows[i].spaceId && overlaps(rows[i], rows[j])) {
    rows[i].errors.push(`Overlaps CSV row ${rows[j].row}.`);
    rows[j].errors.push(`Overlaps CSV row ${rows[i].row}.`);
  }
  const valid = rows.every(row => !row.errors.length);
  if (!importing) return { valid, rows };
  if (!valid) throw new Error('Correct the CSV errors before importing. No events were imported.');
  // A single Postgres INSERT is atomic; the exclusion constraint also catches racing bookings.
  const entries = checked(await supabase.from('bookings').insert(rows.map(({ spaceId, date, start, end, title, attendees }) => ({ spaceId, date, start, end, title, attendees, userId: current.user.id, source: 'event' }))).select('id,spaceId,date,start,end,title,attendees,source'));
  return { imported: entries.length, entries };
}

async function session() {
  const auth = checked(await supabase.auth.getSession());
  const setupRequired = checked(await supabase.rpc('setup_needed'));
  if (!auth.session) return { user: null, csrfToken: null, setupRequired };
  // Profile authorization comes from protected database columns, never user_metadata.
  const profile = checked(await supabase.from('profiles').select('id,name,email,role,status').eq('id', auth.session.user.id).single());
  return { user: profile, csrfToken: null, setupRequired };
}

export async function supabaseRequest(path, options = {}) {
  const url = new URL(path, window.location.origin);
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : {};
  if (url.pathname === '/api/auth/session') return session();
  if (url.pathname === '/api/admin/events/preview' && method === 'POST') return hostedEvents(body.csv, false);
  if (url.pathname === '/api/admin/events/import' && method === 'POST') return hostedEvents(body.csv, true);
  if (url.pathname === '/api/auth/setup') {
    let auth = await supabase.auth.signInWithPassword({ email: body.email, password: body.password });
    if (auth.error) auth = await supabase.auth.signUp({ email: body.email, password: body.password, options: { data: { full_name: body.name } } });
    const result = checked(auth);
    if (!result.session) throw new Error('Confirm your email before administrator setup.');
    if (!checked(await supabase.rpc('claim_admin', { setup_code: body.code }))) throw new Error('The setup code is invalid or an administrator already exists.');
    return session();
  }
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
