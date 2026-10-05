import { roomNumber, coventryRoomNames } from '../shared/rooms.mjs';

export function initialize(db) {
  // SQLite's table-rebuild migration requires foreign keys disabled outside the transaction.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000;');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
    CREATE TABLE IF NOT EXISTS spaces (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, building TEXT NOT NULL, floor TEXT NOT NULL, amenities TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, spaceId INTEGER NOT NULL REFERENCES spaces(id), date TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, title TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS bookings_space_date ON bookings(spaceId, date);`);
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > 5) throw new Error('This database needs a newer version of the server.');
    if (version === 0) {
      db.exec(`
        CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student', 'teacher')));
        ALTER TABLE spaces ADD COLUMN capacity INTEGER NOT NULL DEFAULT 1 CHECK(capacity > 0);
        ALTER TABLE spaces ADD COLUMN room TEXT NOT NULL DEFAULT '';
        ALTER TABLE spaces ADD COLUMN bookingScope TEXT NOT NULL DEFAULT 'whole-room' CHECK(bookingScope IN ('whole-room', 'seat'));
        ALTER TABLE spaces ADD COLUMN active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0, 1));
        ALTER TABLE spaces ADD COLUMN resourceKey TEXT;
        CREATE UNIQUE INDEX spaces_resource_key ON spaces(resourceKey);
        ALTER TABLE bookings ADD COLUMN profileId TEXT REFERENCES profiles(id);
        ALTER TABLE bookings ADD COLUMN attendees INTEGER NOT NULL DEFAULT 1 CHECK(attendees > 0);
      `);
      const profile = db.prepare('INSERT INTO profiles (id, name, role) VALUES (?, ?, ?)');
      profile.run('student-alex', 'Alex Morgan', 'student');
      profile.run('teacher-jordan', 'Dr. Jordan Lee', 'teacher');
      const insert = db.prepare(`INSERT INTO spaces (name, type, building, floor, amenities, capacity, room, bookingScope, active, resourceKey)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`);
      for (let seat = 1; seat <= 16; seat++) {
        const number = String(seat).padStart(2, '0');
        insert.run(`Lab seat ${number}`, 'lab-seat', 'Science Center', 'First floor', JSON.stringify(['Workstation', 'Power outlet', 'Wi-Fi']), 1,
          'Computer Lab 101', 'seat', `science-center:computer-lab-101:seat-${number}`);
      }
      for (const [name, type, building, floor, capacity, resourceKey] of [
        ['Classroom 102', 'classroom', 'Science Center', 'First floor', 30, 'science-center:classroom-102'],
        ['Study room 103', 'study-room', 'Science Center', 'First floor', 6, 'science-center:study-room-103'],
        ['Study room L01', 'study-room', 'Main Library', 'Ground floor', 4, 'main-library:study-room-l01'],
        ['Study room L02', 'study-room', 'Main Library', 'Ground floor', 8, 'main-library:study-room-l02'],
        ['Classroom L03', 'classroom', 'Main Library', 'Ground floor', 24, 'main-library:classroom-l03'],
      ]) {
        insert.run(name, type, building, floor, JSON.stringify(['Whiteboard', 'Power outlet', 'Wi-Fi']), capacity, name, 'whole-room', resourceKey);
      }
      db.exec('PRAGMA user_version = 1');
    }
    if (version < 2) {
      db.exec("UPDATE spaces SET active = 0 WHERE type <> 'classroom'");
      const amenities = JSON.stringify(['Whiteboard', 'Projector', 'Power outlet', 'Wi-Fi']);
      db.prepare("UPDATE spaces SET amenities = ? WHERE type = 'classroom' AND active = 1").run(amenities);
      const insert = db.prepare(`INSERT OR IGNORE INTO spaces (name, type, building, floor, amenities, capacity, room, bookingScope, active, resourceKey)
        VALUES (?, 'classroom', ?, ?, ?, ?, ?, 'whole-room', 1, ?)`);
      for (const [name, building, floor, capacity, resourceKey] of [
        ['Classroom 104', 'Science Center', 'First floor', 40, 'science-center:classroom-104'],
        ['Classroom 106', 'Science Center', 'First floor', 20, 'science-center:classroom-106'],
        ['Classroom L04', 'Main Library', 'Ground floor', 36, 'main-library:classroom-l04'],
        ['Classroom L05', 'Main Library', 'Ground floor', 18, 'main-library:classroom-l05'],
      ]) insert.run(name, building, floor, amenities, capacity, name, resourceKey);
      db.exec('PRAGMA user_version = 2');
    }
    if (version < 3) {
      db.exec(`
        CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
          passwordSalt TEXT NOT NULL, passwordHash TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('student', 'teacher', 'staff', 'admin')),
          status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
          CHECK(role <> 'admin' OR status = 'approved'));
        CREATE TABLE sessions (tokenHash TEXT PRIMARY KEY, userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          csrfToken TEXT NOT NULL, expires INTEGER NOT NULL);
        CREATE INDEX sessions_expiry ON sessions(expires);
        ALTER TABLE bookings ADD COLUMN userId INTEGER REFERENCES users(id);
        ALTER TABLE bookings ADD COLUMN source TEXT NOT NULL DEFAULT 'booking' CHECK(source IN ('booking', 'event'));
        CREATE INDEX bookings_user_date ON bookings(userId, date);
      `);
      const floor = db.prepare('UPDATE spaces SET floor = ? WHERE resourceKey = ?');
      for (const [key, label] of [
        ['science-center:classroom-102', 'Floor 2'], ['science-center:classroom-104', 'Floor 3'], ['science-center:classroom-106', 'Floor 4'],
        ['main-library:classroom-l03', 'Floor 2'], ['main-library:classroom-l04', 'Floor 3'], ['main-library:classroom-l05', 'Floor 4'],
      ]) floor.run(label, key);
      db.exec('PRAGMA user_version = 3');
    }
    if (version < 4) {
      const schemaObjects = db.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name = 'spaces' AND type IN ('index', 'trigger') AND sql IS NOT NULL").all();
      db.exec(`
        CREATE TABLE spaces_v4 (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, building TEXT NOT NULL,
          floor TEXT NOT NULL, amenities TEXT NOT NULL,
          capacity INTEGER CHECK(capacity IS NULL OR capacity > 0), room TEXT NOT NULL DEFAULT '',
          bookingScope TEXT NOT NULL DEFAULT 'whole-room' CHECK(bookingScope IN ('whole-room', 'seat')),
          active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0, 1)), resourceKey TEXT);
        INSERT INTO spaces_v4 (id, name, type, building, floor, amenities, capacity, room, bookingScope, active, resourceKey)
          SELECT id, name, type, building, floor, amenities, capacity, room, bookingScope, active, resourceKey FROM spaces;
        DROP TABLE spaces;
        ALTER TABLE spaces_v4 RENAME TO spaces;
      `);
      for (const { sql } of schemaObjects) db.exec(sql);
      const existing = db.prepare('SELECT * FROM spaces').all();
      const insert = db.prepare(`INSERT INTO spaces (name, type, building, floor, amenities, capacity, room, bookingScope, active, resourceKey)
        VALUES (?, 'classroom', 'Coventry', ?, '[]', NULL, ?, 'whole-room', 1, ?)`);
      // The confirmed inventory ends at floor 4. Do not infer additional floors.
      for (let floor = 2; floor <= 4; floor++) for (let index = 1; index <= 8; index++) {
        const number = String(floor * 100 + index);
        const key = `coventry:classroom-${number}`;
        const present = existing.some(space => space.resourceKey === key || (
          space.building.trim().toLowerCase() === 'coventry'
          && [roomNumber(space.room), roomNumber(space.name)].includes(number)
        ));
        if (!present) insert.run(`Classroom ${number}`, `Floor ${floor}`, number, key);
      }
      db.exec('PRAGMA user_version = 4');
    }
    if (version < 5) {
      // Correct the confirmed room uses without replacing IDs or booking records.
      const update = db.prepare('UPDATE spaces SET name = ? WHERE id = ?');
      for (const space of db.prepare("SELECT * FROM spaces WHERE lower(trim(building)) = 'coventry'").all()) {
        const number = roomNumber(space.room) || roomNumber(space.name)
          || space.resourceKey?.match(/^coventry:classroom-(\d+)$/)?.[1];
        if (coventryRoomNames[number]) update.run(coventryRoomNames[number], space.id);
      }
      db.exec('PRAGMA user_version = 5');
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database migration failed foreign key validation.');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
