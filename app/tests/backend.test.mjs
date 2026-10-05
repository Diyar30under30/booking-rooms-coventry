import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from '../backend/index.mjs';
import { parseCsv } from '../backend/csv.mjs';
import { initialize } from '../backend/db.mjs';
import { compareLabels, compareRooms } from '../shared/rooms.mjs';
import { createBookingNotifier } from '../backend/telegram.mjs';

const password = 'Classroom passphrase 2026';
const setupCode = 'isolated-test-code';
const booking = { spaceId: 17, date: '2030-04-12', start: '09:00', end: '10:00', title: 'Research seminar', attendees: 1 };
const close = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
async function open(t, dbPath = ':memory:', extra = {}) {
  const options = { setupCode, telegram: { token: '', chatId: '' }, appOrigin: 'http://localhost:3001', now: () => new Date(2030, 3, 11, 12), ...extra };
  const server = createServer(dbPath, options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  options.appOrigin = base;
  if (t) t.after(() => close(server));
  const api = async (route, method = 'GET', body, client, headers = {}) => {
    const response = await fetch(`${base}/api${route}`, { method, headers: { ...(method !== 'GET' ? { Origin: base, 'Content-Type': 'application/json' } : {}), ...(client ? { Cookie: client.cookie, 'X-CSRF-Token': client.csrfToken } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, data, response };
  };
  const client = result => ({ ...result.data, cookie: result.response.headers.get('set-cookie')?.split(';')[0] });
  const admin = async () => {
    const result = await api('/auth/setup', 'POST', { code: setupCode, name: 'Campus administrator', email: 'admin@example.edu', password });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return client(result);
  };
  const register = async (role = 'student', email = `${role}@example.edu`) => {
    const result = await api('/auth/register', 'POST', { name: `Campus ${role}`, email, password, role });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data.user;
  };
  const login = async email => {
    const result = await api('/auth/login', 'POST', { email, password });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return client(result);
  };
  const approved = async (adminClient, role = 'student') => {
    const user = await register(role);
    assert.equal((await api(`/admin/users/${user.id}`, 'PATCH', { status: 'approved' }, adminClient)).status, 200);
    return login(user.email);
  };
  return { api, admin, approved, register, login, client, server, base, options };
}
const temp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'classroom-account-test-'));
  return dir;
};
const csv = rows => `classroom,date,start,end,title,attendees\n${rows.join('\n')}\n`;

test('Telegram sends only committed bookings with the reason; failure leaves the booking saved', async t => {
  const dir = temp(), dbPath = path.join(dir, 'notifications.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let succeed = true;
  const messages = [];
  const app = await open(null, dbPath, { telegram: { token: 'test-token', chatId: '123456', fetch: async (url, options) => {
    assert.equal(url, 'https://api.telegram.org/bottest-token/sendMessage');
    const message = JSON.parse(options.body);
    messages.push(message);
    const check = new DatabaseSync(dbPath, { readOnly: true });
    assert.equal(check.prepare("SELECT count(*) AS n FROM bookings WHERE title = 'Reason for room'").get().n, messages.length);
    check.close();
    return { ok: succeed, json: async () => ({ ok: succeed }) };
  } } });
  try {
    const admin = await app.admin();
    const rooms = (await app.api('/spaces')).data.filter(space => space.building === 'Coventry');
    const input = { ...booking, spaceId: rooms[0].id, title: 'Reason for room' };
    assert.equal((await app.api('/bookings', 'POST', { ...input, title: '' }, admin)).status, 400);
    const saved = await app.api('/bookings', 'POST', input, admin);
    assert.equal(saved.status, 201); assert.equal(saved.data.notification, 'sent');
    assert.equal(messages[0].chat_id, '123456');
    for (const part of ['Campus administrator', 'Classroom 201', 'Coventry, Floor 2', '2030-04-12', '09:00', '10:00', 'Reason for room']) assert.ok(messages[0].text.includes(part));
    assert.equal((await app.api('/bookings', 'POST', input, admin)).status, 409);
    assert.equal(messages.length, 1);
    succeed = false;
    const second = await app.api('/bookings', 'POST', { ...input, spaceId: rooms[1].id }, admin);
    assert.equal(second.status, 201); assert.equal(second.data.notification, 'failed');
    assert.equal((await app.api('/bookings/mine', 'GET', undefined, admin)).data.length, 2);
    assert.equal(messages.length, 2);
  } finally { await close(app.server); }
});

test('Telegram disabled, invalid configuration, API errors and network timeouts are handled', async () => {
  assert.equal(await createBookingNotifier({ token: '', chatId: '' })(), 'disabled');
  assert.throws(() => createBookingNotifier({ token: 'test', chatId: '@diorik00' }), /numeric/);
  const input = { booking: { id: 1, date: '2030-04-12', start: '09:00', end: '10:00', title: 'Purpose', attendees: 1 }, space: { name: 'Classroom 201', building: 'Coventry', floor: 'Floor 2' }, user: { name: 'Test' } };
  for (const send of [async () => { throw new Error('Network timeout'); }, async () => ({ ok: true, json: async () => ({ ok: false }) }), async () => ({ ok: true, json: async () => { throw new Error('Invalid JSON'); } })]) {
    assert.equal(await createBookingNotifier({ token: 'test', chatId: '123', fetch: send })(input), 'failed');
  }
});

test('room and floor sorting is numeric, including multi-digit floors', () => {
  assert.deepEqual(['Floor 10', 'Floor 4', 'Floor 2', 'Floor 3'].sort(compareLabels), ['Floor 2', 'Floor 3', 'Floor 4', 'Floor 10']);
  const rooms = ['1001', '208', '201', '301', '401'].map(room => ({ id: Number(room), name: `Classroom ${room}`, room, building: 'Coventry', floor: `Floor ${Math.floor(Number(room) / 100)}` }));
  assert.deepEqual(rooms.sort(compareRooms).map(room => room.room), ['201', '208', '301', '401', '1001']);
});

test('Coventry capacity is optional; purposes and booking/event conflicts still apply', async t => {
  const app = await open(t);
  const admin = await app.admin();
  const user = await app.approved(admin);
  const spaces = (await app.api('/spaces')).data.filter(space => space.building === 'Coventry');
  const input = { ...booking, spaceId: spaces[0].id, attendees: 100 };
  for (const changes of [{ title: '' }, { attendees: 0 }, { attendees: -1 }, { attendees: 1.5 }, { attendees: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal((await app.api('/bookings', 'POST', { ...input, ...changes }, user)).status, 400);
  }
  const results = await Promise.all([app.api('/bookings', 'POST', input, user), app.api('/bookings', 'POST', input, user)]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal((await app.api('/bookings', 'POST', { ...input, spaceId: spaces[1].id }, user)).status, 201);
  assert.equal((await app.api('/bookings', 'POST', { ...input, start: '10:00', end: '11:00' }, user)).status, 201);
  const eventCsv = csv([`${spaces[2].name},${input.date},09:00,10:00,Coventry seminar,100`]);
  assert.equal((await app.api('/admin/events/import', 'POST', { csv: eventCsv }, admin)).status, 201);
  assert.equal((await app.api('/bookings', 'POST', { ...input, spaceId: spaces[2].id }, user)).status, 409);
  assert.equal((await app.api('/admin/events/import', 'POST', { csv: csv([`${spaces[0].name},${input.date},09:00,10:00,Conflicting event,1`]) }, admin)).status, 409);
});

test('Coventry migration adds only missing rooms and preserves existing rows, bookings and retirement across restarts', t => {
  const dir = temp(), dbPath = path.join(dir, 'coventry.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let db = new DatabaseSync(dbPath);
  initialize(db);
  db.exec("DELETE FROM spaces WHERE building = 'Coventry'; PRAGMA user_version = 3;");
  const insert = db.prepare("INSERT INTO spaces (name, type, building, floor, amenities, capacity, room, bookingScope, active, resourceKey) VALUES (?, 'classroom', ?, ?, '[\"Existing equipment\"]', 17, ?, 'whole-room', ?, ?)");
  const id = insert.run('Room 201', ' Coventry ', 'Floor 2', '201', 1, null).lastInsertRowid;
  insert.run('Classroom 202', 'Coventry', 'Floor 2', 'Classroom 202', 0, 'older-key');
  insert.run('Custom room name', 'Coventry', 'Floor 3', 'Custom label', 1, 'coventry:classroom-301');
  db.prepare("INSERT INTO bookings (spaceId,date,start,end,title,attendees) VALUES (?, '2030-04-12', '09:00', '10:00', 'Existing purpose', 8)").run(id);
  const beforeSpaces = db.prepare('SELECT * FROM spaces ORDER BY id').all();
  const beforeBookings = db.prepare('SELECT * FROM bookings ORDER BY id').all();
  initialize(db);
  const after = db.prepare('SELECT * FROM spaces ORDER BY id').all();
  assert.equal(after.length, beforeSpaces.length + 21);
  assert.deepEqual(after.filter(space => beforeSpaces.some(old => old.id === space.id)), beforeSpaces.map(space => space.resourceKey === 'coventry:classroom-301' ? Object.assign(Object.create(null), space, { name: 'Library 301' }) : space));
  assert.deepEqual(db.prepare('SELECT * FROM bookings ORDER BY id').all(), beforeBookings);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.throws(() => db.prepare("INSERT INTO bookings (spaceId,date,start,end,title) VALUES (999999,'2030-04-12','09:00','10:00','Invalid room')").run(), /FOREIGN KEY/);
  db.close();
  db = new DatabaseSync(dbPath);
  initialize(db);
  assert.deepEqual(db.prepare('SELECT * FROM spaces ORDER BY id').all(), after);
  assert.deepEqual(db.prepare('SELECT * FROM bookings ORDER BY id').all(), beforeBookings);
  db.close();
});

test('Coventry migration failure rolls back inserted rooms and restores foreign-key enforcement', () => {
  const db = new DatabaseSync(':memory:');
  try {
    initialize(db);
    db.exec("DELETE FROM spaces WHERE building = 'Coventry'; PRAGMA user_version = 3;");
    db.exec("CREATE TRIGGER reject_coventry BEFORE INSERT ON spaces WHEN NEW.name = 'Classroom 204' BEGIN SELECT RAISE(ABORT, 'Simulated insertion failure'); END;");
    const before = db.prepare('SELECT * FROM spaces ORDER BY id').all();
    assert.throws(() => initialize(db), /Simulated insertion failure/);
    assert.deepEqual(db.prepare('SELECT * FROM spaces ORDER BY id').all(), before);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name = 'spaces_v4'").get().n, 0);
  } finally { db.close(); }
});

test('registration prevents admin escalation, normalizes email, and pending users need approval', async t => {
  const app = await open(t);
  assert.deepEqual((await app.api('/auth/session')).data, { user: null, csrfToken: null, setupRequired: true });
  assert.equal((await app.api('/bookings')).status, 401);
  assert.equal((await app.api('/profiles')).status, 404);
  assert.equal((await app.api('/auth/register', 'POST', { name: 'Evil admin', email: 'evil@example.edu', password, role: 'admin' })).status, 400);
  const admin = await app.admin();
  const pending = await app.register('staff', ' STAFF@EXAMPLE.EDU ');
  assert.equal(pending.email, 'staff@example.edu');
  assert.equal(pending.status, 'pending');
  const staff = await app.login(pending.email);
  assert.equal((await app.api('/bookings', 'GET', undefined, staff)).status, 200);
  assert.equal((await app.api('/bookings', 'POST', booking, staff)).status, 403);
  assert.equal((await app.api('/admin/users', 'GET', undefined, staff)).status, 403);
  const users = (await app.api('/admin/users?status=pending', 'GET', undefined, admin)).data;
  assert.deepEqual(users, [pending]);
  assert.ok(!JSON.stringify(users).includes('password'));
  assert.equal((await app.api(`/admin/users/${pending.id}`, 'PATCH', { status: 'approved', role: 'admin' }, admin)).status, 200);
  // Existing session observes approval immediately; no login refresh required.
  const created = await app.api('/bookings', 'POST', { ...booking, userId: admin.user.id, profileId: 'teacher-jordan', role: 'admin' }, staff);
  assert.equal(created.status, 201);
  assert.equal(created.data.isMine, true);
  assert.equal((await app.api('/bookings/mine', 'GET', undefined, admin)).data.length, 0);
  assert.equal((await app.api(`/admin/users/${pending.id}`, 'PATCH', { status: 'rejected' }, admin)).status, 200);
  assert.equal((await app.api('/bookings', 'POST', { ...booking, start: '10:00', end: '11:00' }, staff)).status, 403);
  assert.equal((await app.api(`/admin/users/${admin.user.id}`, 'PATCH', { status: 'rejected' }, admin)).status, 403);
});

test('approved student, teacher and staff can book all classrooms with floors 2, 3 and 4', async t => {
  const app = await open(t);
  const admin = await app.admin();
  const spaces = (await app.api('/spaces')).data;
  const classrooms = spaces.filter(space => space.active === 1);
  assert.equal(classrooms.length, 30);
  for (const floor of [2, 3, 4]) {
    const rooms = classrooms.filter(space => space.building === 'Coventry' && space.floor === `Floor ${floor}`);
    const names = { 204: 'Large lecture room 204', 301: 'Library 301', 302: 'Club room 302', 303: 'Large lecture room 303' };
    assert.deepEqual(rooms.map(space => space.name), Array.from({ length: 8 }, (_, i) => names[floor * 100 + i + 1] || `Classroom ${floor * 100 + i + 1}`));
    assert.ok(rooms.every(space => space.capacity === null && space.amenities.length === 0));
  }
  for (const building of ['Science Center', 'Main Library']) assert.deepEqual(classrooms.filter(space => space.building === building).map(space => space.floor).sort(), ['Floor 2', 'Floor 3', 'Floor 4']);
  assert.ok(classrooms.every(space => space.type === 'classroom' && space.bookingScope === 'whole-room'));
  for (const [index, role] of ['student', 'teacher', 'staff'].entries()) {
    const user = await app.approved(admin, role);
    for (const space of classrooms) assert.equal((await app.api('/bookings', 'POST', { ...booking, spaceId: space.id, date: `2030-04-${12 + index}`, attendees: space.capacity ?? 2 }, user)).status, 201);
  }
});

test('purpose, times, capacity and classroom-only validation remain mandatory', async t => {
  const app = await open(t);
  const user = await app.approved(await app.admin());
  for (const changes of [{ title: undefined }, { title: '  ' }, { title: 'ab' }, { title: 'x'.repeat(121) }, { title: 42 }, { date: '2030-02-30' }, { date: '2020-01-01' }, { start: '07:59' }, { end: '22:01' }, { end: '09:00' }, { end: '18:00' }, { start: '9:00' }, { spaceId: 1 }, { spaceId: 18 }, { spaceId: 999 }, { attendees: 31 }, { attendees: 0 }, { attendees: 1.5 }, { attendees: '1' }]) {
    assert.equal((await app.api('/bookings', 'POST', { ...booking, ...changes }, user)).status, 400, JSON.stringify(changes));
  }
  assert.equal((await app.api('/bookings', 'POST', null, user)).status, 400);
  assert.equal((await app.api('/bookings', 'POST', { ...booking, date: '2030-04-11', start: '11:00', end: '12:00' }, user)).status, 400);
  assert.equal((await app.api('/bookings', 'POST', { ...booking, date: '2030-04-11', start: '12:00', end: '13:00' }, user)).status, 400, 'start must be strictly after now');
  const concurrent = await Promise.all([app.api('/bookings', 'POST', booking, user), app.api('/bookings', 'POST', booking, user)]);
  assert.deepEqual(concurrent.map(row => row.status).sort(), [201, 409]);
  assert.equal((await app.api('/bookings', 'POST', { ...booking, start: '10:00', end: '11:00' }, user)).status, 201);
});

test('cookies, CSRF, exact Origin, JSON type, logout and absolute expiry protect sessions', async t => {
  let clock = new Date(2030, 3, 11, 12);
  const app = await open(t, ':memory:', { now: () => clock });
  const admin = await app.admin();
  assert.match(admin.cookie, /^campus_session=[a-f0-9]{64}$/);
  const session = await app.api('/auth/session', 'GET', undefined, admin);
  assert.equal(session.data.setupRequired, false);
  assert.equal(session.data.csrfToken, admin.csrfToken);
  assert.equal((await app.api('/bookings', 'POST', booking, admin, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await app.api('/bookings', 'POST', booking, admin, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await app.api('/bookings', 'POST', booking, admin, { Origin: '' })).status, 403);
  assert.equal((await app.api('/bookings', 'POST', booking, admin, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await app.api('/bookings', 'POST', booking, admin, { 'Content-Type': 'text/plain' })).status, 415);
  const loggedOut = await app.api('/auth/logout', 'POST', {}, admin);
  assert.equal(loggedOut.status, 200);
  assert.match(loggedOut.response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await app.api('/bookings', 'GET', undefined, admin)).status, 401);
  const fresh = await app.login(admin.user.email);
  clock = new Date(clock.getTime() + 7 * 86400000);
  assert.equal((await app.api('/bookings', 'GET', undefined, fresh)).status, 401);
});

test('HTTPS origins automatically create Secure HttpOnly cookies and DB stores only token hashes', async t => {
  const dir = temp(t);
  const dbPath = path.join(dir, 'test.sqlite');
  const app = await open(t, dbPath, { appOrigin: 'https://campus.example' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = await app.api('/auth/setup', 'POST', { code: setupCode, name: 'Campus Admin', email: 'admin@example.edu', password });
  assert.equal(result.status, 201);
  assert.match(result.response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Path=\//);
  assert.match(result.response.headers.get('set-cookie'), /; Secure$/);
  const token = app.client(result).cookie.split('=')[1];
  const db = new DatabaseSync(dbPath);
  const session = db.prepare('SELECT * FROM sessions').get();
  assert.notEqual(session.tokenHash, token);
  assert.equal(session.tokenHash, createHash('sha256').update(token).digest('hex'));
  const account = db.prepare('SELECT * FROM users').get();
  assert.equal(account.passwordSalt.length, 32);
  assert.equal(account.passwordHash.length, 128);
  assert.notEqual(account.passwordHash, password);
  db.close();
});

test('setup runs once atomically and authentication is rate limited before hashing', async t => {
  const app = await open(t, ':memory:', { authRateLimit: 2 });
  const input = { code: setupCode, name: 'Campus Admin', email: 'first@example.edu', password };
  const results = await Promise.all([app.api('/auth/setup', 'POST', input), app.api('/auth/setup', 'POST', { ...input, email: 'second@example.edu' })]);
  assert.deepEqual(results.map(row => row.status).sort(), [201, 409]);
  assert.equal((await app.api('/auth/setup', 'POST', input)).status, 429);
  for (let i = 0; i < 2; i++) assert.equal((await app.api('/auth/login', 'POST', { email: 'none@example.edu', password })).status, 401);
  assert.equal((await app.api('/auth/login', 'POST', { email: 'none@example.edu', password })).status, 429);
  for (let i = 0; i < 2; i++) assert.equal((await app.api('/auth/register', 'POST', { role: 'admin' })).status, 400);
  assert.equal((await app.api('/auth/register', 'POST', { role: 'admin' })).status, 429);
});

test('unified schedule hides other booking purposes and identities, and restricts cancellation', async t => {
  const app = await open(t);
  const admin = await app.admin();
  const student = await app.approved(admin);
  const teacher = await app.approved(admin, 'teacher');
  const made = (await app.api('/bookings', 'POST', { ...booking, title: 'Private thesis consultation' }, student)).data;
  const uploaded = await app.api('/admin/events/import', 'POST', { csv: csv(['Classroom L03,2030-04-12,09:00,10:00,Public guest lecture,20']) }, admin);
  assert.equal(uploaded.status, 201);
  const schedule = (await app.api('/bookings?from=2030-04-12&to=2030-04-12', 'GET', undefined, teacher)).data;
  assert.deepEqual(schedule.map(row => row.title), ['Classroom reservation', 'Public guest lecture']);
  assert.ok(schedule.every(row => !('userId' in row) && !('profileId' in row) && !('email' in row) && !('name' in row)));
  assert.equal(schedule[0].canCancel, false);
  assert.equal((await app.api('/bookings/mine', 'GET', undefined, student)).data[0].title, 'Private thesis consultation');
  assert.equal((await app.api('/bookings?from=2030-04-12&to=2030-05-13', 'GET', undefined, teacher)).status, 400);
  assert.equal((await app.api('/bookings', 'GET', undefined, teacher)).data.length, 0);
  assert.equal((await app.api(`/bookings/${made.id}`, 'DELETE', { userId: student.user.id, profileId: 'student-alex' }, teacher)).status, 403);
  assert.equal((await app.api(`/bookings/${uploaded.data.entries[0].id}`, 'DELETE', {}, student)).status, 403);
  assert.equal((await app.api(`/bookings/${made.id}`, 'DELETE', {}, student)).status, 200);
  assert.equal((await app.api(`/bookings/${uploaded.data.entries[0].id}`, 'DELETE', {}, admin)).status, 200);
});

test('CSV handles BOM, quoting, escaped quotes and newlines; malformed headers and row bounds reject', async t => {
  assert.equal(parseCsv('\uFEFFclassroom,date,start,end,title\r\nClassroom 102,2030-04-12,09:00,10:00,"Talk, ""science""\nworkshop"\r\n')[0].title, 'Talk, "science"\nworkshop');
  for (const text of ['classroom,date,start,end,wrong\n1,2030-04-12,09:00,10:00,Test', 'classroom,date,start,end,title,title\n1,a,b,c,d,e', 'classroom,date,start,end,title\n1,a,b,c,"open', 'classroom,date,start,end,title\n1,a,b,c,"closed"oops', 'classroom,date,start,end,title\n1,a,b,c']) assert.throws(() => parseCsv(text));
  assert.throws(() => parseCsv('x'.repeat(256 * 1024 + 1)), /256 KB/);
  assert.throws(() => parseCsv(`classroom,date,start,end,title\n${'1,2030-04-12,09:00,10:00,Talk\n'.repeat(501)}`), /500/);
});

test('admin CSV preview and import validates every row and imports atomically with event blocking', async t => {
  const app = await open(t);
  const admin = await app.admin();
  const student = await app.approved(admin);
  const input = '\uFEFFclassroom,date,start,end,title\r\nClassroom 102,2030-04-12,09:00,10:00,"Science, ""open"" day"\r\n21,2030-04-12,09:00,10:00,Library talk\r\n';
  assert.equal((await app.api('/admin/events/preview', 'POST', { csv: input }, student)).status, 403);
  const preview = (await app.api('/admin/events/preview', 'POST', { csv: input }, admin)).data;
  assert.equal(preview.valid, true);
  assert.deepEqual(preview.rows.map(row => row.attendees), [1, 1]);
  const blankOptional = await app.api('/admin/events/preview', 'POST', { csv: csv(['Classroom 104,2030-04-12,09:00,10:00,Optional attendee count,']) }, admin);
  assert.equal(blankOptional.data.valid, true);
  assert.equal(blankOptional.data.rows[0].attendees, 1);
  assert.equal((await app.api('/bookings?from=2030-04-12', 'GET', undefined, student)).data.length, 0);
  const commit = await app.api('/admin/events/import', 'POST', { csv: input }, admin);
  assert.equal(commit.status, 201);
  assert.equal(commit.data.imported, 2);
  assert.ok(commit.data.entries.every(row => row.source === 'event'));
  assert.equal((await app.api('/admin/events/import', 'POST', { csv: input }, admin)).status, 409);
  assert.equal((await app.api('/bookings', 'POST', booking, student)).status, 409);
  assert.equal((await app.api('/bookings?from=2030-04-12', 'GET', undefined, student)).data.length, 2);
  const bad = csv(['Classroom 104,2030-04-12,09:00,10:00,Valid row,20', 'Classroom 102,2030-04-12,09:30,10:30,Conflicting row,20']);
  const invalid = await app.api('/admin/events/import', 'POST', { csv: bad }, admin);
  assert.equal(invalid.status, 409);
  assert.equal((await app.api('/bookings?from=2030-04-12', 'GET', undefined, student)).data.length, 2);
  const duplicates = csv(['Classroom 104,2030-04-12,09:00,10:00,First row,20', 'Classroom 104,2030-04-12,09:30,10:30,Second row,20']);
  const overlap = (await app.api('/admin/events/preview', 'POST', { csv: duplicates }, admin)).data;
  assert.equal(overlap.valid, false);
  assert.ok(overlap.rows.every(row => row.errors.some(error => error.includes('Overlaps'))));
  const invalidRoom = (await app.api('/admin/events/preview', 'POST', { csv: csv(['Unknown room,2030-04-12,09:00,10:00,Unknown,1', 'Classroom 106,2030-04-12,09:00,10:00,Capacity,21']) }, admin)).data;
  assert.equal(invalidRoom.valid, false);
  assert.equal(invalidRoom.rows[0].spaceId, null);
});

test('CSV import revalidates after preview when an intervening booking consumes a room', async t => {
  const app = await open(t);
  const admin = await app.admin();
  const student = await app.approved(admin);
  const input = csv(['Classroom 102,2030-04-12,09:00,10:00,Campus event,20', 'Classroom L03,2030-04-12,09:00,10:00,Another event,20']);
  assert.equal((await app.api('/admin/events/preview', 'POST', { csv: input }, admin)).data.valid, true);
  assert.equal((await app.api('/bookings', 'POST', booking, student)).status, 201);
  assert.equal((await app.api('/admin/events/import', 'POST', { csv: input }, admin)).status, 409);
  const schedule = (await app.api('/bookings?from=2030-04-12', 'GET', undefined, student)).data;
  assert.equal(schedule.length, 1);
  assert.equal(schedule[0].source, 'booking');
});

test('a slow booking request rechecks approval and session after its body finishes', async t => {
  const app = await open(t);
  const admin = await app.admin();
  const student = await app.approved(admin);
  async function delayed(change, expected) {
    const body = JSON.stringify(booking);
    const received = new Promise(resolve => app.server.once('request', resolve));
    let sending;
    const response = new Promise((resolve, reject) => {
      sending = request(`${app.base}/api/bookings`, { method: 'POST', headers: { Origin: app.base, 'Content-Type': 'application/json', Cookie: student.cookie, 'X-CSRF-Token': student.csrfToken } }, incoming => {
        incoming.resume(); incoming.on('end', () => resolve(incoming.statusCode));
      });
      sending.on('error', reject);
      sending.write(body.slice(0, 20));
    });
    await received;
    await change();
    sending.end(body.slice(20));
    assert.equal(await response, expected);
  }
  await delayed(() => app.api(`/admin/users/${student.user.id}`, 'PATCH', { status: 'rejected' }, admin), 403);
  await app.api(`/admin/users/${student.user.id}`, 'PATCH', { status: 'approved' }, admin);
  await delayed(() => app.api('/auth/logout', 'POST', {}, student), 401);
  assert.equal((await app.api('/bookings?from=2030-04-12', 'GET', undefined, admin)).data.length, 0);
});

function legacyDatabase(dbPath, version = 0) {
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE spaces (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, building TEXT NOT NULL, floor TEXT NOT NULL, amenities TEXT NOT NULL);
    CREATE TABLE bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, spaceId INTEGER NOT NULL REFERENCES spaces(id), date TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, title TEXT NOT NULL);
    INSERT INTO spaces VALUES (1, 'Legacy room', 'meeting', 'Old campus', 'Old floor', '["Original amenity"]');
    INSERT INTO bookings VALUES (91, 1, '2030-04-12', '09:00', '10:00', 'Original purpose');`);
  if (version === 2) {
    db.exec(`CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL);
      INSERT INTO profiles VALUES ('student-alex', 'Alex Morgan', 'student');
      ALTER TABLE spaces ADD COLUMN capacity INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE spaces ADD COLUMN room TEXT NOT NULL DEFAULT '';
      ALTER TABLE spaces ADD COLUMN bookingScope TEXT NOT NULL DEFAULT 'whole-room';
      ALTER TABLE spaces ADD COLUMN active INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE spaces ADD COLUMN resourceKey TEXT;
      CREATE UNIQUE INDEX spaces_resource_key ON spaces(resourceKey);
      ALTER TABLE bookings ADD COLUMN profileId TEXT REFERENCES profiles(id);
      ALTER TABLE bookings ADD COLUMN attendees INTEGER NOT NULL DEFAULT 1;
      UPDATE bookings SET profileId = 'student-alex';
      INSERT INTO spaces VALUES (17, 'Classroom 102', 'classroom', 'Science Center', 'First floor', '[]', 30, 'Classroom 102', 'whole-room', 1, 'science-center:classroom-102');
      INSERT INTO bookings VALUES (92, 17, '2030-04-12', '09:00', '10:00', 'Previous demo purpose', 'student-alex', 5);
      PRAGMA user_version = 2;`);
  }
  return db;
}

test('atomic migration retains legacy IDs and demo profile data without assigning real account ownership', async t => {
  for (const version of [0, 2]) {
    const dir = temp(t), dbPath = path.join(dir, `v${version}.sqlite`);
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const legacy = legacyDatabase(dbPath, version);
    legacy.close();
    const app = await open(null, dbPath);
    const admin = await app.admin();
    const student = await app.approved(admin);
    const schedule = (await app.api('/bookings?from=2030-04-12', 'GET', undefined, student)).data;
    assert.ok(schedule.every(row => !row.isMine && !row.canCancel && row.title === 'Classroom reservation'));
    assert.equal((await app.api('/bookings/91', 'DELETE', { profileId: 'student-alex' }, student)).status, 403);
    const db = new DatabaseSync(dbPath);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
    assert.equal(db.prepare('SELECT userId FROM bookings WHERE id = 91').get().userId, null);
    assert.equal(db.prepare('SELECT title FROM bookings WHERE id = 91').get().title, 'Original purpose');
    assert.equal(db.prepare('SELECT name FROM spaces WHERE id = 1').get().name, 'Legacy room');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    if (version === 2) {
      assert.equal(db.prepare('SELECT profileId, userId FROM bookings WHERE id = 92').get().profileId, 'student-alex');
      assert.equal(db.prepare('SELECT userId FROM bookings WHERE id = 92').get().userId, null);
      assert.equal(db.prepare('SELECT floor FROM spaces WHERE id = 17').get().floor, 'Floor 2');
      const preview = await app.api('/admin/events/preview', 'POST', { csv: csv(['Classroom 102,2030-04-12,09:00,10:00,Conflicts legacy,1']) }, admin);
      assert.equal(preview.data.valid, false);
    }
    db.close();
    const spaces = (await app.api('/spaces')).data;
    await close(app.server);
    const restart = await open(null, dbPath);
    assert.deepEqual((await restart.api('/spaces')).data, spaces);
    const restored = await restart.login(student.user.email);
    assert.equal((await restart.api('/bookings?from=2030-04-12', 'GET', undefined, restored)).data.length, schedule.length);
    await close(restart.server);
  }
});

test('failed migration rolls back schema, resources and version together', t => {
  const dir = temp(t), dbPath = path.join(dir, 'legacy.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = legacyDatabase(dbPath);
  db.exec('CREATE INDEX spaces_resource_key ON spaces(name)');
  db.close();
  assert.throws(() => createServer(dbPath, { setupCode }), /already exists/);
  const check = new DatabaseSync(dbPath);
  assert.equal(check.prepare('PRAGMA user_version').get().user_version, 0);
  assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'users'").get().n, 0);
  assert.equal(check.prepare('SELECT title FROM bookings').get().title, 'Original purpose');
  assert.deepEqual(check.prepare('PRAGMA table_info(bookings)').all().map(row => row.name), ['id', 'spaceId', 'date', 'start', 'end', 'title']);
  check.close();
});

test('version 3 failure rolls back without assigning legacy ownership or changing existing floors', t => {
  const dir = temp(), dbPath = path.join(dir, 'v2.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const original = legacyDatabase(dbPath, 2);
  original.exec('CREATE TABLE users (incompatibleColumn TEXT)');
  const spaces = original.prepare('SELECT * FROM spaces ORDER BY id').all();
  const bookings = original.prepare('SELECT * FROM bookings ORDER BY id').all();
  original.close();
  assert.throws(() => createServer(dbPath, { setupCode }), /already exists/);
  const db = new DatabaseSync(dbPath);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.deepEqual(db.prepare('SELECT * FROM spaces ORDER BY id').all(), spaces);
  assert.deepEqual(db.prepare('SELECT * FROM bookings ORDER BY id').all(), bookings);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'sessions'").get().n, 0);
  db.close();
});

test('persistent startup writes an exclusive bootstrap file, and static serving stays safe', async t => {
  const dir = temp(t), dbPath = path.join(dir, 'test.sqlite'), dist = path.join(dir, 'dist');
  mkdirSync(dist);
  writeFileSync(path.join(dist, 'index.html'), '<h1>Campus</h1>');
  writeFileSync(path.join(dir, 'secret.txt'), 'private');
  const server = createServer(dbPath, { distDir: dist });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await close(server); rmSync(dir, { recursive: true, force: true }); });
  assert.equal(existsSync(path.join(dir, 'admin-setup-code.txt')), true);
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await (await fetch(`${base}/schedule`)).text(), '<h1>Campus</h1>');
  assert.equal((await fetch(`${base}/missing.js`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e%2fsecret.txt`)).status, 403);
});
