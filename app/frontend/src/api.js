import { supabaseConfigured } from './auth-config.js';
let csrfToken = null;
export const previewMode = import.meta.env?.MODE === 'preview' && !supabaseConfigured;
export const setCsrfToken = token => { csrfToken = token; };

export async function request(path, options = {}) {
  if (supabaseConfigured) {
    const { supabaseRequest } = await import('./supabase.js');
    return supabaseRequest(path, options);
  }
  if (previewMode) {
    if (path === '/api/auth/session') return { user: null, csrfToken: null, setupRequired: false };
    if (path === '/api/spaces' && (!options.method || options.method === 'GET')) path = '/preview-spaces.json';
    else throw new Error('This is a visual preview. Accounts and bookings are not enabled.');
  }
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (options.method && options.method !== 'GET' && csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  if (response.status === 401 && path !== '/api/auth/login') {
    csrfToken = null;
    window.dispatchEvent(new Event('session-expired'));
  }
  let data;
  try { data = await response.json(); }
  catch {
    const error = new Error('The server returned an unexpected response. Please try again.');
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(data?.error || data?.message || 'Something went wrong. Please try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export const mutate = (path, method, body) => request(path, { method, body: JSON.stringify(body) });
