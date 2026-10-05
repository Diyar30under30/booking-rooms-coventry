import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fail } from './rules.mjs';

const derive = promisify(scrypt);
const hashToken = token => createHash('sha256').update(token).digest('hex');
const scryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const publicUser = user => user ? { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status } : null;
export const adminExists = db => Boolean(db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get());

export function credentials(body, registration = false) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Enter a valid email address.');
  if (typeof body.password !== 'string' || [...body.password].length < 12 || [...body.password].length > 128 || Buffer.byteLength(body.password) > 512) throw fail(400, 'Password must contain 12 to 128 characters.');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (registration && ([...name].length < 2 || [...name].length > 100)) throw fail(400, 'Name must contain 2 to 100 characters.');
  return { email, name, password: body.password };
}

export async function passwordRecord(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, scryptOptions);
  return { salt, hash: key.toString('hex') };
}

export async function verifyPassword(password, user) {
  // Missing accounts still perform the same expensive work.
  const key = await derive(password, user?.passwordSalt || '00000000000000000000000000000000', 64, scryptOptions);
  const expected = user ? Buffer.from(user.passwordHash, 'hex') : Buffer.alloc(64);
  return timingSafeEqual(key, expected) && Boolean(user);
}

export function setupSecret(db, dbPath, options) {
  if (adminExists(db)) return null;
  if (dbPath === ':memory:' && !options.setupCode) throw new Error('An in-memory server requires options.setupCode until an administrator exists.');
  if (options.setupCode || process.env.ADMIN_SETUP_CODE) return options.setupCode || process.env.ADMIN_SETUP_CODE;
  const file = path.join(path.dirname(dbPath), 'admin-setup-code.txt');
  if (!existsSync(file)) {
    try { writeFileSync(file, `${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const code = readFileSync(file, 'utf8').trim();
  if (!code) throw new Error('Administrator setup code file is empty.');
  return code;
}

export function sameSecret(value, expected) {
  if (typeof value !== 'string' || typeof expected !== 'string') return false;
  return timingSafeEqual(Buffer.from(hashToken(value), 'hex'), Buffer.from(hashToken(expected), 'hex'));
}

export function createAuth(db, options, secret) {
  const now = () => (options.now ? options.now() : new Date()).getTime();
  const origin = options.appOrigin || process.env.APP_ORIGIN;
  const secure = Boolean(origin?.startsWith('https://') || options.sessionSecure || process.env.SESSION_SECURE === '1');
  if (secure && !origin) throw new Error('Secure sessions require APP_ORIGIN.');
  if (origin && (new URL(origin).origin !== origin || (secure && !origin.startsWith('https://')))) throw new Error('APP_ORIGIN must be an exact origin, using HTTPS for secure sessions.');
  const cookie = (token, maxAge) => `campus_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  const attempts = new Map();
  const userById = id => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return {
    secret,
    checkOrigin(req) {
      if (req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'Cross-site changes are not allowed.');
      const incoming = req.headers.origin;
      const configuredOrigin = options.appOrigin || process.env.APP_ORIGIN;
      const allowed = configuredOrigin ? incoming === configuredOrigin : /^http:\/\/(?:localhost|127\.0\.0\.1):(?:3001|5173)$/.test(incoming || '');
      if (!allowed) throw fail(403, 'Request origin is not allowed.');
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'Send application/json.');
    },
    rateLimit(req, action) {
      const stamp = now();
      // Trust the direct peer only; forwarded headers cannot reset the limiter.
      const key = `${action}:${req.socket.remoteAddress}`;
      const limit = options.authRateLimit || (action === 'register' ? 5 : 10);
      const window = 15 * 60 * 1000;
      if (attempts.size > 10000) for (const [entry, value] of attempts) if (stamp - value.since >= window) attempts.delete(entry);
      let count = attempts.get(key);
      if (!count || stamp - count.since >= window) { count = { since: stamp, value: 0 }; attempts.set(key, count); }
      if (++count.value > limit) throw fail(429, 'Too many attempts. Try again in 15 minutes.');
    },
    session(req) {
      const token = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('campus_session='))?.slice('campus_session='.length);
      if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
      const session = db.prepare('SELECT * FROM sessions WHERE tokenHash = ? AND expires > ?').get(hashToken(token), now());
      if (!session) return null;
      const user = userById(session.userId);
      return user ? { ...session, user } : null;
    },
    require(req, { mutation = false, approved = false, admin = false } = {}) {
      const session = this.session(req);
      if (!session) throw fail(401, 'Sign in to continue.');
      if (mutation && !sameSecret(req.headers['x-csrf-token'], session.csrfToken)) throw fail(403, 'Invalid CSRF token. Refresh and try again.');
      if (approved && session.user.status !== 'approved') throw fail(403, 'Your account must be approved before you can book.');
      if (admin && (session.user.role !== 'admin' || session.user.status !== 'approved')) throw fail(403, 'Administrator access is required.');
      return session;
    },
    issue(userId, res) {
      const token = randomBytes(32).toString('hex');
      const csrfToken = randomBytes(32).toString('hex');
      db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now());
      db.prepare('INSERT INTO sessions (tokenHash, userId, csrfToken, expires) VALUES (?, ?, ?, ?)').run(hashToken(token), userId, csrfToken, now() + 7 * 86400000);
      res.setHeader('Set-Cookie', cookie(token, 7 * 86400));
      return { user: publicUser(userById(userId)), csrfToken };
    },
    logout(session, res) {
      db.prepare('DELETE FROM sessions WHERE tokenHash = ?').run(session.tokenHash);
      res.setHeader('Set-Cookie', cookie('', 0));
    },
  };
}
