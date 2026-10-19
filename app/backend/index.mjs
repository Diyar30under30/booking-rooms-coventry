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
      if (pathname === '/api/spaces' && req.method === 'GET') {
        return json(res, 200, db.prepare('SELECT * FROM spaces').all().sort(compareRooms).map(roomView));
      }
      if (pathname === '/api/config' && req.method === 'GET') return json(res, 200, configuration(db));
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
