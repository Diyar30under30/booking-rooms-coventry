import { fail } from './rules.mjs';

export const roomAdmin = user => user?.status === 'approved' && ['admin','room_admin'].includes(user.role);
export const roomView = room => ({ ...room, amenities: JSON.parse(room.amenities), bookableBy: JSON.parse(room.bookableBy), accessible: Boolean(room.accessible) });
export const configuration = db => ({ campuses: db.prepare('SELECT * FROM campuses ORDER BY name').all(), roomTypes: db.prepare('SELECT * FROM room_types ORDER BY name').all() });
export function permittedRoom(user, room) {
  if (roomAdmin(user)) return true;
  return (user.role !== 'student' || room.type === 'study-room') && JSON.parse(room.bookableBy).includes(user.role);
}
const text = (value, label, max = 100, optional = false) => {
  if (typeof value !== 'string' || (!optional && !value.trim()) || [...value.trim()].length > max) throw fail(400, `${label} must be ${optional ? 'up to' : '1–'}${max} characters.`);
  return value.trim();
};
export function saveRoom(db, body, id) {
  const existing = id ? db.prepare('SELECT * FROM spaces WHERE id = ?').get(id) : null;
  if (id && !existing) throw fail(404, 'Room not found.');
  const value = { ...(existing ? roomView(existing) : { room: '', floor: 'Ground floor', amenities: [], accessible: false, photo: '', active: 1, bookableBy: ['staff','teacher'] }), ...body };
  const name = text(value.name, 'Room name'), building = text(value.building, 'Building'), floor = text(value.floor, 'Floor'), room = text(value.room, 'Room number', 50, true);
  if (typeof value.campus !== 'string' || !db.prepare('SELECT id FROM campuses WHERE name = ?').get(value.campus)) throw fail(400, 'Choose an existing campus.');
  if (typeof value.type !== 'string' || !db.prepare('SELECT id FROM room_types WHERE id = ?').get(value.type)) throw fail(400, 'Choose an existing room type.');
  if (value.capacity !== null && (!Number.isSafeInteger(value.capacity) || value.capacity < 1 || value.capacity > 100000)) throw fail(400, 'Capacity must be a positive whole number, or null when unknown.');
  if (!Array.isArray(value.amenities) || value.amenities.length > 30 || value.amenities.some(v => typeof v !== 'string' || !v.trim() || v.length > 60)) throw fail(400, 'Equipment must be a list of up to 30 names.');
  if (!Array.isArray(value.bookableBy) || !value.bookableBy.length || value.bookableBy.some(v => !['student','staff','teacher'].includes(v))) throw fail(400, 'Choose at least one booking role.');
  if (value.type !== 'study-room' && value.bookableBy.includes('student')) throw fail(400, 'Students can only book group study rooms.');
  if (![0,1].includes(value.active) || typeof value.accessible !== 'boolean') throw fail(400, 'Use a valid room status and accessibility flag.');
  const photo = text(value.photo, 'Photo URL', 2048, true);
  if (photo && !/^https:\/\//i.test(photo)) throw fail(400, 'Use an HTTPS photo URL.');
  const fields = [name,value.type,building,floor,JSON.stringify([...new Set(value.amenities.map(v => v.trim()))]),value.capacity,room,value.active,value.campus,JSON.stringify([...new Set(value.bookableBy)]),Number(value.accessible),photo];
  if (id) db.prepare(`UPDATE spaces SET name=?,type=?,building=?,floor=?,amenities=?,capacity=?,room=?,active=?,campus=?,bookableBy=?,accessible=?,photo=? WHERE id=?`).run(...fields,id);
  else id = db.prepare(`INSERT INTO spaces (name,type,building,floor,amenities,capacity,room,active,campus,bookableBy,accessible,photo,bookingScope) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'whole-room')`).run(...fields).lastInsertRowid;
  return roomView(db.prepare('SELECT * FROM spaces WHERE id=?').get(id));
}
export function saveCampus(db, body, id) {
  const old = id ? db.prepare('SELECT * FROM campuses WHERE id=?').get(id) : null;
  if (id && !old) throw fail(404, 'Campus not found.');
  const value = { ...old, ...body }, name = text(value.name, 'Campus name');
  const valid = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!valid(value.opens) || !valid(value.closes) || value.opens >= value.closes) throw fail(400, 'Choose opening and closing times on the same day, with closing after opening.');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (id) {
      db.prepare('UPDATE campuses SET name=?,opens=?,closes=? WHERE id=?').run(name,value.opens,value.closes,id);
      db.prepare('UPDATE spaces SET campus=? WHERE campus=?').run(name,old.name);
    } else id = db.prepare('INSERT INTO campuses (name,opens,closes) VALUES (?,?,?)').run(name,value.opens,value.closes).lastInsertRowid;
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); if (error.code?.startsWith('SQLITE_CONSTRAINT') || /UNIQUE constraint/.test(error.message)) throw fail(409, 'A campus with that name already exists.'); throw error; }
  return db.prepare('SELECT * FROM campuses WHERE id=?').get(id);
}
export function saveRoomType(db, body, id) {
  const old = id ? db.prepare('SELECT * FROM room_types WHERE id=?').get(id) : null;
  if (id && !old) throw fail(404, 'Room type not found.');
  const name = text(body.name, 'Room type name');
  const key = id || body.id;
  if (typeof key !== 'string' || !/^[a-z][a-z0-9-]{1,39}$/.test(key)) throw fail(400, 'Use a type ID with 2–40 lowercase letters, digits or hyphens.');
  try {
    if (id) db.prepare('UPDATE room_types SET name=? WHERE id=?').run(name,id);
    else db.prepare('INSERT INTO room_types (id,name) VALUES (?,?)').run(key,name);
  } catch (error) { if (/UNIQUE constraint/.test(error.message)) throw fail(409, 'That room type ID or name already exists.'); throw error; }
  return db.prepare('SELECT * FROM room_types WHERE id=?').get(key);
}
