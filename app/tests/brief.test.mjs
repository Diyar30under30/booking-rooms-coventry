import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../backend/index.mjs';

const password = 'A secure testing passphrase';
async function fixture(t) {
  const options = { setupCode: 'test-only', authRateLimit: 100, now: () => new Date(2030, 3, 11, 12), telegram: { token: '', chatId: '' } };
  const server = createServer(':memory:', options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  options.appOrigin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function api(route, method = 'GET', body, actor) {
    const response = await fetch(options.appOrigin + '/api' + route, { method, headers: { Origin: options.appOrigin, 'Content-Type': 'application/json', ...(actor ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.csrfToken } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const setup = await api('/auth/setup', 'POST', { code: 'test-only', name: 'Estates admin', email: 'admin@example.edu', password });
  const admin = { ...setup.data, cookie: setup.cookie };
  async function account(role, email = role + '@example.edu') {
    const registered = await api('/auth/register', 'POST', { role: role === 'room_admin' ? 'staff' : role, email, name: role + ' tester', password, department: 'Computing' });
    assert.equal(registered.status, 201);
    const updated = await api('/admin/users/' + registered.data.user.id, 'PATCH', { status: 'approved', role }, admin);
    assert.equal(updated.status, 200, JSON.stringify(updated.data));
    const login = await api('/auth/login', 'POST', { email, password });
    return { ...login.data, cookie: login.cookie };
  }
  const rooms = (await api('/spaces')).data;
  const request = { spaceId: rooms.find(r => r.active && r.type === 'classroom').id, date: '2030-04-12', start: '09:00', end: '10:00', title: 'Module workshop', moduleCode: '4009SCN', attendees: 2 };
  return { api, admin, account, rooms, request, options };
}

test('students only book study rooms; study auto-approves; teaching requests require review', async t => {
  const f = await fixture(t), student = await f.account('student'), staff = await f.account('staff');
  assert.equal((await f.api('/bookings', 'POST', f.request, student)).status, 403);
  const study = f.rooms.find(r => r.active && r.type === 'study-room');
  assert.ok(study, 'catalogue includes a group study room');
  const own = await f.api('/bookings', 'POST', { ...f.request, spaceId: study.id }, student);
  assert.equal(own.status, 201); assert.equal(own.data.status, 'approved');
  const requested = await f.api('/bookings', 'POST', f.request, staff);
  assert.equal(requested.status, 201); assert.equal(requested.data.status, 'requested');
  assert.equal(requested.data.moduleCode, '4009SCN');
  const overlap = await f.api('/bookings', 'POST', f.request, f.admin);
  assert.equal(overlap.status, 409); assert.match(overlap.data.error, new RegExp('#' + requested.data.id));
  assert.equal((await f.api('/admin/bookings/' + requested.data.id, 'PATCH', { status: 'approved' }, student)).status, 403);
  const approved = await f.api('/admin/bookings/' + requested.data.id, 'PATCH', { status: 'approved', approvalNote: 'Room checked' }, f.admin);
  assert.equal(approved.status, 200); assert.equal(approved.data.status, 'approved');
});

test('decline and cancel preserve history and free slots; past records cannot be cancelled', async t => {
  const f = await fixture(t), staff = await f.account('staff');
  const first = await f.api('/bookings', 'POST', f.request, staff);
  assert.equal((await f.api('/admin/bookings/' + first.data.id, 'PATCH', { status: 'declined' }, f.admin)).status, 200);
  const second = await f.api('/bookings', 'POST', f.request, staff);
  assert.equal(second.status, 201);
  assert.equal((await f.api('/bookings/' + second.data.id, 'DELETE', {}, staff)).status, 200);
  const history = (await f.api('/bookings/mine', 'GET', undefined, staff)).data;
  assert.deepEqual(history.map(b => b.status).sort(), ['cancelled', 'declined']);
  assert.equal((await f.api('/bookings?from=2030-04-12', 'GET', undefined, staff)).data.length, 0);
  const third = await f.api('/bookings', 'POST', f.request, staff);
  f.options.now = () => new Date(2030, 3, 13, 12);
  assert.equal((await f.api('/bookings/' + third.data.id, 'DELETE', {}, f.admin)).status, 400);
  assert.equal((await f.api('/bookings/mine', 'GET', undefined, staff)).data.length, 3);
});

test('room admins manage requests/catalogue while Estates controls roles and opening hours', async t => {
  const f = await fixture(t), manager = await f.account('room_admin'), staff = await f.account('staff');
  assert.equal((await f.api('/admin/users', 'GET', undefined, manager)).status, 403);
  const campus = await f.api('/admin/campuses', 'POST', { name: 'City campus', opens: '10:00', closes: '18:00' }, f.admin);
  assert.equal(campus.status, 201);
  assert.equal((await f.api('/admin/campuses', 'POST', { name: 'Forbidden', opens: '08:00', closes: '20:00' }, manager)).status, 403);
  const body = { name: 'Computing lab', campus: 'City campus', building: 'Technology', floor: 'Floor 1', room: 'T101', capacity: 24, type: 'lab', amenities: ['Projector', 'Accessible desk'], accessible: true, bookableBy: ['staff', 'teacher'], active: 1, photo: '' };
  const created = await f.api('/admin/rooms', 'POST', body, manager);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal((await f.api('/bookings', 'POST', { ...f.request, spaceId: created.data.id }, staff)).status, 400);
  const reserved = await f.api('/bookings', 'POST', { ...f.request, spaceId: created.data.id, start: '10:00', end: '11:00' }, staff);
  assert.equal(reserved.status, 201);
  assert.equal((await f.api('/admin/bookings/' + reserved.data.id, 'PATCH', { status: 'approved' }, manager)).status, 200);
  const day = await f.api('/admin/bookings?date=2030-04-12&spaceId=' + created.data.id, 'GET', undefined, manager);
  assert.equal(day.status, 200); assert.equal(day.data[0].requesterName, staff.user.name);
  assert.equal((await f.api('/admin/rooms/' + created.data.id, 'PATCH', { active: 0 }, manager)).status, 200);
  assert.equal((await f.api('/bookings', 'POST', { ...f.request, spaceId: created.data.id, start: '11:00', end: '12:00' }, staff)).status, 400);
  assert.equal((await f.api('/admin/users/' + f.admin.user.id, 'PATCH', { role: 'student' }, f.admin)).status, 403);
});

test('registration keeps department optional and rejects role spoofing; role updates obey administrator boundaries', async t => {
  const f = await fixture(t);
  const plain = { name: 'New staff', email: 'new@example.edu', password, role: 'staff' };
  const registered = await f.api('/auth/register', 'POST', { ...plain, status: 'approved' });
  assert.equal(registered.status, 201); assert.equal(registered.data.user.department, '');
  assert.equal(registered.data.user.status, 'pending');
  for (const role of ['admin', 'room_admin']) assert.equal((await f.api('/auth/register', 'POST', { ...plain, email: role + '@example.edu', role })).status, 400);
  for (const department of [42, 'x'.repeat(101)]) assert.equal((await f.api('/auth/register', 'POST', { ...plain, email: 'bad@example.edu', department })).status, 400);
  const manager = await f.account('room_admin');
  const route = '/admin/users/' + registered.data.user.id;
  assert.equal((await f.api(route, 'PATCH', { status: 'approved' }, manager)).status, 403);
  for (const body of [{}, { role: 'superuser' }, { status: 'pending' }, { role: 'room_admin' }]) assert.equal((await f.api(route, 'PATCH', body, f.admin)).status, 400);
  const promoted = await f.api(route, 'PATCH', { role: 'admin', status: 'approved' }, f.admin);
  assert.equal(promoted.status, 200); assert.equal(promoted.data.user.role, 'admin');
  assert.equal((await f.api(route, 'PATCH', { status: 'rejected' }, f.admin)).status, 400);
  assert.equal((await f.api(route, 'PATCH', { role: 'staff', status: 'rejected' }, f.admin)).status, 200);
  assert.equal((await f.api('/admin/users/' + manager.user.id, 'PATCH', { status: 'rejected' }, f.admin)).status, 400);
});

test('catalogue rejects invalid changes and duplicate configuration; edited campus hours govern booking and review', async t => {
  const f = await fixture(t), staff = await f.account('staff'), manager = await f.account('room_admin');
  const room = f.rooms.find(r => r.id === f.request.spaceId);
  assert.equal((await f.api('/admin/rooms/' + room.id, 'PATCH', { capacity: 12 }, staff)).status, 403);
  for (const body of [{ capacity: 0 }, { capacity: 2.5 }, { campus: 'Missing' }, { type: 'missing' }, { bookableBy: ['student'] }, { bookableBy: [] }, { photo: 'javascript:alert(1)' }, { accessible: 'yes' }, { active: 2 }, { amenities: [null] }]) {
    assert.equal((await f.api('/admin/rooms/' + room.id, 'PATCH', body, manager)).status, 400, JSON.stringify(body));
  }
  const original = (await f.api('/spaces')).data.find(r => r.id === room.id);
  assert.deepEqual(original, room);
  const campus = (await f.api('/config')).data.campuses.find(c => c.name === room.campus);
  assert.equal((await f.api('/admin/campuses', 'POST', campus, f.admin)).status, 409);
  assert.equal((await f.api('/admin/room-types', 'POST', { id: 'lab', name: 'Another lab' }, f.admin)).status, 409);
  assert.equal((await f.api('/admin/room-types', 'POST', { id: 'new-type', name: 'Computer lab' }, f.admin)).status, 409);
  assert.equal((await f.api('/admin/room-types', 'POST', { id: 'new-type', name: 'New type' }, manager)).status, 403);
  const type = await f.api('/admin/room-types', 'POST', { id: 'studio', name: 'Studio' }, f.admin);
  assert.equal(type.status, 201);
  assert.equal((await f.api('/admin/room-types/studio', 'PATCH', { name: 'Media studio' }, f.admin)).data.name, 'Media studio');
  const requested = await f.api('/bookings', 'POST', f.request, staff);
  assert.equal(requested.status, 201);
  const campusRoute = '/admin/campuses/' + campus.id;
  assert.equal((await f.api(campusRoute, 'PATCH', { opens: '18:00', closes: '09:00' }, f.admin)).status, 400);
  assert.equal((await f.api(campusRoute, 'PATCH', { opens: '10:00', closes: '18:00' }, manager)).status, 403);
  assert.equal((await f.api(campusRoute, 'PATCH', { name: 'Renamed campus', opens: '10:00', closes: '18:00' }, f.admin)).status, 200);
  assert.equal((await f.api('/spaces')).data.find(r => r.id === room.id).campus, 'Renamed campus');
  assert.equal((await f.api('/admin/bookings/' + requested.data.id, 'PATCH', { status: 'approved' }, manager)).status, 400);
  assert.equal((await f.api('/bookings', 'POST', { ...f.request, start: '18:00', end: '19:00' }, staff)).status, 400);
  assert.equal((await f.api('/bookings', 'POST', { ...f.request, start: '10:00', end: '11:00' }, staff)).status, 201);
});

test('concurrent requests reserve one slot; only pending future requests may change status', async t => {
  const f = await fixture(t), staff = await f.account('staff');
  const results = await Promise.all([f.api('/bookings', 'POST', f.request, staff), f.api('/bookings', 'POST', f.request, staff)]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  const saved = results.find(r => r.status === 201).data, route = '/admin/bookings/' + saved.id;
  assert.equal((await f.api('/bookings', 'POST', { ...f.request, id: saved.id }, staff)).status, 409, 'client-supplied IDs cannot hide an existing conflict');
  for (const body of [{ status: 'cancelled' }, { status: 'requested' }, { status: 'approved', approvalNote: 42 }, { status: 'approved', approvalNote: 'x'.repeat(501) }]) assert.equal((await f.api(route, 'PATCH', body, f.admin)).status, 400);
  assert.equal((await f.api(route, 'PATCH', { status: 'approved' }, staff)).status, 403);
  assert.equal((await f.api(route, 'PATCH', { status: 'approved' }, f.admin)).status, 200);
  assert.equal((await f.api(route, 'PATCH', { status: 'declined' }, f.admin)).status, 409);
  const later = await f.api('/bookings', 'POST', { ...f.request, start: '11:00', end: '12:00' }, staff);
  const before = (await f.api('/bookings/mine', 'GET', undefined, staff)).data;
  f.options.now = () => new Date(2030, 3, 13, 12);
  assert.equal((await f.api('/admin/bookings/' + later.data.id, 'PATCH', { status: 'declined' }, f.admin)).status, 400);
  assert.equal((await f.api('/bookings/' + saved.id, 'DELETE', {}, staff)).status, 400);
  const after = (await f.api('/bookings/mine', 'GET', undefined, staff)).data;
  assert.deepEqual(after.map(({canCancel, ...b}) => b), before.map(({canCancel, ...b}) => b));
  assert.ok(after.every(b => b.canCancel === false));
});

test('bookable roles restrict studies and labs and approval rechecks current requester permissions', async t => {
  const f = await fixture(t), student = await f.account('student'), staff = await f.account('staff');
  const study = f.rooms.find(r => r.active && r.type === 'study-room');
  assert.equal((await f.api('/admin/rooms/' + study.id, 'PATCH', { bookableBy: ['teacher'] }, f.admin)).status, 200);
  assert.equal((await f.api('/bookings', 'POST', { ...f.request, spaceId: study.id, role: 'teacher' }, student)).status, 403);
  const lab = f.rooms.find(r => r.active && r.type === 'lab');
  assert.equal((await f.api('/bookings', 'POST', { ...f.request, spaceId: lab.id }, student)).status, 403);
  const saved = await f.api('/bookings', 'POST', { ...f.request, spaceId: lab.id }, staff);
  assert.equal(saved.status, 201); assert.equal(saved.data.status, 'requested');
  assert.equal((await f.api('/admin/users/' + staff.user.id, 'PATCH', { role: 'student' }, f.admin)).status, 200);
  assert.equal((await f.api('/admin/bookings/' + saved.data.id, 'PATCH', { status: 'approved' }, f.admin)).status, 400);
  assert.equal((await f.api('/bookings/mine', 'GET', undefined, staff)).data[0].status, 'requested');
});
