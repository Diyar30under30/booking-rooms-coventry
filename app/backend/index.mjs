import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialize } from './db.mjs';
import { compareRooms } from '../shared/rooms.mjs';
import { createBookingNotifier } from './telegram.mjs';
import { adminExists, publicUser, credentials, passwordRecord, verifyPassword, setupSecret, sameSecret, createAuth } from './auth.mjs';
import { bookingErrors, existingConflict, conflictMessage, localDate, validDate, fail } from './rules.mjs';
import { validateEvents, previewResult } from './csv.mjs';
import { roomAdmin, roomView, configuration, permittedRoom, saveRoom, saveCampus, saveRoomType } from './catalogue.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.json': 'application/json' };
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
async function readBody(req, limit = 16384) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw fail(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail(400, 'Send a valid JSON body.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'Send a JSON object.');
  return body;
}
const insertUser = (db, input, password, role, status) => {
  try {
    return db.prepare('INSERT INTO users (name, email, passwordSalt, passwordHash, role, status, department) VALUES (?, ?, ?, ?, ?, ?, ?)').run(input.name, input.email, password.salt, password.hash, role, status, input.department || '').lastInsertRowid;
  } catch (error) {
    if (/UNIQUE constraint failed: users.email/.test(error.message)) throw fail(409, 'An account with that email already exists.');
    throw error;
  }
};
const bookingView = (booking, user, privateTitle = false, now = new Date()) => ({
  id: booking.id, spaceId: booking.spaceId, date: booking.date, start: booking.start, end: booking.end,
  title: booking.source === 'event' || privateTitle || booking.userId === user.id ? booking.title : 'Classroom reservation',
  attendees: booking.attendees, source: booking.source, status: booking.status, moduleCode: privateTitle || roomAdmin(user) || booking.userId === user.id ? booking.moduleCode : '',
  approvalNote: privateTitle || roomAdmin(user) || booking.userId === user.id ? booking.approvalNote : '',
  isMine: booking.userId === user.id && booking.source === 'booking',
  canCancel: ['requested','approved','declined'].includes(booking.status) && new Date(`${booking.date}T${booking.start}:00`) > now && (roomAdmin(user) || (booking.userId === user.id && booking.source === 'booking')),
});

/** Persistent API. Isolated in-memory callers must explicitly provide a setupCode. */
export function createServer(dbPath = path.join(process.env.DATA_DIR || path.join(root, '..', 'data'), 'bookings.sqlite'), options = {}) {
  const notifyBooking = createBookingNotifier(options.telegram);
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  let auth;
  try { initialize(db); auth = createAuth(db, options, setupSecret(db, dbPath, options)); }
  catch (error) { db.close(); throw error; }
  const dist = path.resolve(options.distDir || path.join(root, 'dist'));
  const now = () => options.now ? options.now() : new Date();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;
      if (pathname.startsWith('/api/') && ['POST', 'PATCH', 'DELETE'].includes(req.method)) auth.checkOrigin(req);
      if (pathname === '/api/auth/session' && req.method === 'GET') {
        const session = auth.session(req);
        return json(res, 200, { user: publicUser(session?.user), csrfToken: session?.csrfToken || null, setupRequired: !adminExists(db) });
      }
      if (pathname === '/api/auth/register' && req.method === 'POST') {
        auth.rateLimit(req, 'register');
        const body = await readBody(req);
        if (!['student', 'teacher', 'staff'].includes(body.role)) throw fail(400, 'Choose student, teacher, or staff.');
        const input = credentials(body, true);
        const password = await passwordRecord(input.password);
        const id = insertUser(db, input, password, body.role, 'pending');
        return json(res, 201, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
      }
      if (pathname === '/api/auth/login' && req.method === 'POST') {
        auth.rateLimit(req, 'login');
        const body = await readBody(req);
        let input;
        try { input = credentials(body); } catch { throw fail(401, 'Email or password is incorrect.'); }
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(input.email);
        if (!await verifyPassword(input.password, user)) throw fail(401, 'Email or password is incorrect.');
        return json(res, 200, auth.issue(user.id, res));
      }
      if (pathname === '/api/auth/setup' && req.method === 'POST') {
        auth.rateLimit(req, 'setup');
        if (adminExists(db)) throw fail(409, 'An administrator has already been created.');
        const body = await readBody(req);
        if (!sameSecret(body.code, auth.secret)) throw fail(403, 'Invalid administrator setup code.');
        const input = credentials(body, true);
        const password = await passwordRecord(input.password);
        db.exec('BEGIN IMMEDIATE');
        let id;
        try {
          if (adminExists(db)) throw fail(409, 'An administrator has already been created.');
          if (!sameSecret(body.code, auth.secret)) throw fail(403, 'Invalid administrator setup code.');
          id = insertUser(db, input, password, 'admin', 'approved');
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 201, auth.issue(id, res));
      }
      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        auth.require(req, { mutation: true });
        await readBody(req);
        const session = auth.require(req, { mutation: true });
        auth.logout(session, res);
        return json(res, 200, { ok: true });
      }
      if (pathname === '/api/spaces' && req.method === 'GET') {
        return json(res, 200, db.prepare('SELECT * FROM spaces').all().sort(compareRooms).map(roomView));
      }
      if (pathname === '/api/config' && req.method === 'GET') return json(res, 200, configuration(db));
      if (pathname === '/api/bookings/mine' && req.method === 'GET') {
        const { user } = auth.require(req);
        const rows = db.prepare("SELECT * FROM bookings WHERE userId = ? AND source = 'booking' ORDER BY date, start, id").all(user.id);
        return json(res, 200, rows.map(row => bookingView(row, user, true, now())));
      }
      if (pathname === '/api/bookings' && req.method === 'GET') {
        const { user } = auth.require(req);
        const from = url.searchParams.get('from') || localDate(now());
        const to = url.searchParams.get('to') || from;
        if (!validDate(from) || !validDate(to) || to < from || (Date.parse(to) - Date.parse(from)) / 86400000 > 30) throw fail(400, 'Choose a valid date range of up to 31 days.');
        const rows = db.prepare("SELECT * FROM bookings WHERE date >= ? AND date <= ? AND status IN ('requested','approved') ORDER BY date, start, id").all(from, to);
        return json(res, 200, rows.map(row => bookingView(row, user, roomAdmin(user), now())));
      }
      if (pathname === '/api/bookings' && req.method === 'POST') {
        auth.require(req, { mutation: true, approved: true });
        const body = await readBody(req);
        const { user } = auth.require(req, { mutation: true, approved: true });
        const space = Number.isInteger(body.spaceId) ? db.prepare('SELECT * FROM spaces WHERE id = ?').get(body.spaceId) : null;
        const hours = space && db.prepare('SELECT * FROM campuses WHERE name=?').get(space.campus);
        const errors = bookingErrors(body, space, now(), hours || undefined);
        if (errors.length) throw fail(400, errors[0]);
        if (!permittedRoom(user, space)) throw fail(403, 'Your role cannot book this room. Students may book designated group study rooms only.');
        const moduleCode = body.moduleCode ?? '';
        if (typeof moduleCode !== 'string' || moduleCode.trim().length > 40) throw fail(400, 'Module code must be at most 40 characters.');
        db.exec('BEGIN IMMEDIATE');
        let booking;
        try {
          const conflict = existingConflict(db, body);
          if (conflict) throw fail(409, conflictMessage(conflict));
          const status = space.type === 'study-room' ? 'approved' : 'requested';
          const id = db.prepare("INSERT INTO bookings (spaceId, date, start, end, title, attendees, userId, source, status, moduleCode) VALUES (?, ?, ?, ?, ?, ?, ?, 'booking', ?, ?)").run(body.spaceId, body.date, body.start, body.end, body.title.trim(), body.attendees, user.id, status, moduleCode.trim()).lastInsertRowid;
          booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        // Notification happens after commit and never turns a saved booking into an API error.
        const notification = await notifyBooking({ booking, space, user });
        if (notification === 'failed') console.warn(`Telegram notification failed for booking ${booking.id}. The booking is saved.`);
        return json(res, 201, { ...bookingView(booking, user, true, now()), notification });
      }
      const deletion = pathname.match(/^\/api\/bookings\/(\d+)$/);
      if (deletion && req.method === 'DELETE') {
        auth.require(req, { mutation: true });
        await readBody(req);
        const { user } = auth.require(req, { mutation: true });
        const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(deletion[1]));
        if (!booking) throw fail(404, 'Booking not found.');
        if (!roomAdmin(user) && (booking.userId !== user.id || booking.source !== 'booking')) throw fail(403, 'Only the owner or an administrator can cancel this reservation.');
        if (new Date(`${booking.date}T${booking.start}:00`) <= now()) throw fail(400, 'Only future bookings can be cancelled. Past bookings remain in history.');
        if (booking.status === 'cancelled') throw fail(409, 'This booking is already cancelled.');
        db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking.id);
        return json(res, 200, { cancelled: true });
      }
      if (pathname === '/api/admin/bookings' && req.method === 'GET') {
        const { user } = auth.require(req, { roomAdmin: true });
        const date = url.searchParams.get('date') || localDate(now());
        const spaceId = url.searchParams.get('spaceId');
        if (!validDate(date) || (spaceId && !/^\d+$/.test(spaceId))) throw fail(400, 'Choose a valid day and room.');
        const rows = db.prepare(`SELECT bookings.*, users.name AS requesterName FROM bookings LEFT JOIN users ON users.id=bookings.userId
          WHERE date=? ${spaceId ? 'AND spaceId=?' : ''} ORDER BY start,end,bookings.id`).all(...(spaceId ? [date,Number(spaceId)] : [date]));
        return json(res, 200, rows.map(row => ({ ...bookingView(row, user, true, now()), requesterName: row.requesterName || 'Historical booking' })));
      }
      const review = pathname.match(/^\/api\/admin\/bookings\/(\d+)$/);
      if (review && req.method === 'PATCH') {
        auth.require(req, { roomAdmin: true, mutation: true });
        const body = await readBody(req);
        const { user } = auth.require(req, { roomAdmin: true, mutation: true });
        if (!['approved','declined'].includes(body.status)) throw fail(400, 'Choose approved or declined.');
        const note = body.approvalNote ?? '';
        if (typeof note !== 'string' || note.trim().length > 500) throw fail(400, 'Approval note must be at most 500 characters.');
        db.exec('BEGIN IMMEDIATE');
        try {
          const booking = db.prepare('SELECT * FROM bookings WHERE id=?').get(Number(review[1]));
          if (!booking) throw fail(404, 'Booking not found.');
          if (booking.status !== 'requested') throw fail(409, 'Only requested bookings can be approved or declined.');
          if (new Date(`${booking.date}T${booking.start}:00`) <= now()) throw fail(400, 'Past requests cannot be changed.');
          if (body.status === 'approved') {
            const space = db.prepare('SELECT * FROM spaces WHERE id=?').get(booking.spaceId);
            const hours = db.prepare('SELECT * FROM campuses WHERE name=?').get(space.campus);
            const errors = bookingErrors(booking,space,now(),hours);
            if (errors.length) throw fail(400, errors[0]);
            const owner = db.prepare('SELECT * FROM users WHERE id=?').get(booking.userId);
            if (!owner || owner.status !== 'approved' || !permittedRoom(owner,space)) throw fail(400, 'The requester is no longer authorised for this room.');
            const conflict = existingConflict(db,booking,booking.id);
            if (conflict) throw fail(409, conflictMessage(conflict));
          }
          db.prepare('UPDATE bookings SET status=?,approvalNote=? WHERE id=?').run(body.status,note.trim(),booking.id);
          db.exec('COMMIT');
          return json(res, 200, bookingView({ ...booking,status:body.status,approvalNote:note.trim() },user,true,now()));
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      const roomRoute = pathname.match(/^\/api\/admin\/rooms(?:\/(\d+))?$/);
      if (roomRoute && !roomRoute[1] && req.method === 'GET') {
        auth.require(req, { roomAdmin: true });
        return json(res, 200, db.prepare("SELECT * FROM spaces WHERE bookingScope='whole-room'").all().sort(compareRooms).map(roomView));
      }
      if (roomRoute && ((req.method === 'POST' && !roomRoute[1]) || (req.method === 'PATCH' && roomRoute[1]))) {
        auth.require(req, { roomAdmin: true, mutation: true });
        const body = await readBody(req);
        auth.require(req, { roomAdmin: true, mutation: true });
        return json(res, roomRoute[1] ? 200 : 201, saveRoom(db,body,roomRoute[1] ? Number(roomRoute[1]) : null));
      }
      const campusRoute = pathname.match(/^\/api\/admin\/campuses(?:\/(\d+))?$/);
      if (campusRoute && ((req.method === 'POST' && !campusRoute[1]) || (req.method === 'PATCH' && campusRoute[1]))) {
        auth.require(req, { admin: true, mutation: true });
        const body = await readBody(req);
        auth.require(req, { admin: true, mutation: true });
        return json(res, campusRoute[1] ? 200 : 201, saveCampus(db,body,campusRoute[1] ? Number(campusRoute[1]) : null));
      }
      const typeRoute = pathname.match(/^\/api\/admin\/room-types(?:\/([a-z][a-z0-9-]*))?$/);
      if (typeRoute && ((req.method === 'POST' && !typeRoute[1]) || (req.method === 'PATCH' && typeRoute[1]))) {
        auth.require(req, { admin: true, mutation: true });
        const body = await readBody(req);
        auth.require(req, { admin: true, mutation: true });
        return json(res, typeRoute[1] ? 200 : 201, saveRoomType(db,body,typeRoute[1]));
      }
      if (pathname === '/api/admin/users' && req.method === 'GET') {
        auth.require(req, { admin: true });
        const status = url.searchParams.get('status') || 'all';
        if (!['all', 'pending', 'approved', 'rejected'].includes(status)) throw fail(400, 'Choose a valid user status.');
        const users = status === 'all' ? db.prepare('SELECT * FROM users ORDER BY id').all() : db.prepare('SELECT * FROM users WHERE status = ? ORDER BY id').all(status);
        return json(res, 200, users.map(publicUser));
      }
      const updateUser = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
      if (updateUser && req.method === 'PATCH') {
        auth.require(req, { admin: true, mutation: true });
        const body = await readBody(req);
        const { user: actor } = auth.require(req, { admin: true, mutation: true });
        if (body.status === undefined && body.role === undefined) throw fail(400, 'Choose a status or role to change.');
        if (body.status !== undefined && !['approved', 'rejected'].includes(body.status)) throw fail(400, 'Choose approved or rejected.');
        if (body.role !== undefined && !['student','teacher','staff','room_admin','admin'].includes(body.role)) throw fail(400, 'Choose a valid role.');
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(updateUser[1]));
        if (!user) throw fail(404, 'User not found.');
        const role = body.role ?? user.role, status = body.status ?? user.status;
        if (user.id === actor.id && (role !== 'admin' || status !== 'approved')) throw fail(403, 'You cannot remove your own Estates administrator access.');
        if (['admin','room_admin'].includes(role) && status !== 'approved') throw fail(400, 'Administrators must be approved. Change their role before rejecting an account.');
        if (user.role === 'admin' && role !== 'admin' && db.prepare("SELECT count(*) AS n FROM users WHERE role='admin' AND status='approved'").get().n <= 1) throw fail(403, 'Keep at least one Estates administrator.');
        db.prepare('UPDATE users SET status = ?, role = ? WHERE id = ?').run(status, role, user.id);
        return json(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
      }
      if (pathname === '/api/admin/events/preview' && req.method === 'POST') {
        auth.require(req, { admin: true, mutation: true });
        const body = await readBody(req, 2 * 1024 * 1024);
        auth.require(req, { admin: true, mutation: true });
        return json(res, 200, previewResult(validateEvents(db, body.csv, now())));
      }
      if (pathname === '/api/admin/events/import' && req.method === 'POST') {
        auth.require(req, { admin: true, mutation: true });
        const body = await readBody(req, 2 * 1024 * 1024);
        const { user } = auth.require(req, { admin: true, mutation: true });
        db.exec('BEGIN IMMEDIATE');
        let entries;
        try {
          const result = validateEvents(db, body.csv, now());
          if (!result.valid) {
            db.exec('ROLLBACK');
            return json(res, result.status, { error: 'Event import failed validation. No events were imported.', ...previewResult(result) });
          }
          const insert = db.prepare("INSERT INTO bookings (spaceId, date, start, end, title, attendees, userId, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'event')");
          entries = result.rows.map(row => {
            const id = insert.run(row.spaceId, row.date, row.start, row.end, row.title, row.attendees, user.id).lastInsertRowid;
            return bookingView(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id), user, true);
          });
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 201, { imported: entries.length, entries });
      }
      if (pathname === '/api/admin/events/template' && req.method === 'GET') {
        auth.require(req, { admin: true });
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="events-template.csv"' });
        return res.end('classroom,date,start,end,title,attendees\nClassroom 102,2030-04-12,09:00,10:00,Campus workshop,20\n');
      }
      if (pathname.startsWith('/api/')) throw fail(404, 'API route not found.');
      if (req.method !== 'GET' && req.method !== 'HEAD') throw fail(405, 'Method not allowed.');
      let decoded;
      try { decoded = decodeURIComponent(pathname); } catch { throw fail(400, 'Invalid URL.'); }
      const file = path.resolve(dist, `.${decoded}`);
      if (!file.startsWith(dist + path.sep) && file !== dist) throw fail(403, 'Access denied.');
      let target = file;
      if (!existsSync(target) || !statSync(target).isFile()) {
        if (path.extname(decoded)) throw fail(404, 'File not found.');
        target = path.join(dist, 'index.html');
      }
      if (!existsSync(target)) throw fail(503, 'Frontend is not built. Run npm run build, or use the Vite development server.');
      res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') res.end();
      else createReadStream(target).on('error', () => res.destroy()).pipe(res);
    } catch (error) {
      if (!error.status) console.error('Campus API internal error:', error.code || error.name);
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' });
      else res.destroy();
    }
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  const port = Number(process.env.PORT || 3001);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Campus booking server running at http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
