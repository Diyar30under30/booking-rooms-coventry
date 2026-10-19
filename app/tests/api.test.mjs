import test from 'node:test';
import assert from 'node:assert/strict';
import { request, setCsrfToken } from '../frontend/src/api.js';

function watchSessionEvents(t) {
  const events = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  globalThis.window = { dispatchEvent: event => events.push(event.type) };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete globalThis.window;
    setCsrfToken(null);
  });
  return events;
}

test('incorrect login does not dispatch a session-expired event', async t => {
  const events = watchSessionEvents(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Email or password is incorrect.' }, { status: 401 }));
  await assert.rejects(request('/api/auth/login', { method: 'POST' }), { status: 401, message: 'Email or password is incorrect.' });
  assert.deepEqual(events, []);
});

test('non-JSON unauthorized response still expires the session and clears CSRF', async t => {
  const events = watchSessionEvents(t);
  let headers;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_path, options) => {
    headers = options.headers;
    return calls++ === 0 ? new Response('Unauthorized', { status: 401 }) : Response.json({ ok: true });
  });
  setCsrfToken('expired-token');
  await assert.rejects(request('/api/bookings'), { status: 401, message: /unexpected response/ });
  assert.deepEqual(events, ['session-expired']);
  await request('/api/bookings', { method: 'POST' });
  assert.equal(headers.has('X-CSRF-Token'), false);
});

test('proxy HTML errors retain their HTTP status and give a readable error', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>Bad gateway</html>', { status: 502 }));
  await assert.rejects(request('/api/spaces'), { status: 502, message: /unexpected response/ });
});
