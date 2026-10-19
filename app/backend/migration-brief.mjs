// Called within initialize's transaction, with foreign keys temporarily disabled.
export function migrateBrief(db) {
  const schema = db.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name = 'users' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
  db.exec(`
    CREATE TABLE users_v6 (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      passwordSalt TEXT NOT NULL, passwordHash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student','teacher','staff','admin','room_admin')),
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
      department TEXT NOT NULL DEFAULT '', CHECK(role NOT IN ('admin','room_admin') OR status = 'approved'));
    INSERT INTO users_v6 (id,name,email,passwordSalt,passwordHash,role,status)
      SELECT id,name,email,passwordSalt,passwordHash,role,status FROM users;
    DROP TABLE users;
    ALTER TABLE users_v6 RENAME TO users;
    CREATE TABLE campuses (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, opens TEXT NOT NULL, closes TEXT NOT NULL);
    INSERT INTO campuses (name,opens,closes) VALUES ('Main campus','08:00','22:00');
    CREATE TABLE room_types (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
    INSERT INTO room_types VALUES ('classroom','Teaching room'),('lab','Computer lab'),('study-room','Group study room'),('meeting-room','Meeting room');
    ALTER TABLE spaces ADD COLUMN campus TEXT NOT NULL DEFAULT 'Main campus';
    ALTER TABLE spaces ADD COLUMN bookableBy TEXT NOT NULL DEFAULT '["staff","teacher"]';
    ALTER TABLE spaces ADD COLUMN accessible INTEGER NOT NULL DEFAULT 0 CHECK(accessible IN (0,1));
    ALTER TABLE spaces ADD COLUMN photo TEXT NOT NULL DEFAULT '';
    ALTER TABLE bookings ADD COLUMN status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('requested','approved','declined','cancelled'));
    ALTER TABLE bookings ADD COLUMN moduleCode TEXT NOT NULL DEFAULT '';
    ALTER TABLE bookings ADD COLUMN approvalNote TEXT NOT NULL DEFAULT '';
    CREATE INDEX bookings_status_date ON bookings(status,date,start);
  `);
  for (const { sql } of schema) db.exec(sql);
  // Explicitly illustrative rooms supplement the confirmed Coventry inventory.
  // Retired historical resources stay retired and all existing IDs are preserved.
  const insert = db.prepare(`INSERT INTO spaces
    (name,type,building,floor,amenities,capacity,room,bookingScope,active,resourceKey,campus,bookableBy,accessible)
    VALUES (?,?,?,?,?,?,?,'whole-room',1,?,'Main campus',?,?)`);
  for (const [name, type, building, floor, capacity, equipment, accessible, key] of [
    ['Group study S01','study-room','Science Center','Ground floor',6,['Whiteboard','Accessible desk','Wi-Fi'],1,'brief:study-s01'],
    ['Group study L06','study-room','Main Library','Ground floor',8,['Whiteboard','Wi-Fi'],0,'brief:study-l06'],
    ['Computer lab S201','lab','Science Center','Floor 2',24,['Workstation','Projector','Accessible desk'],1,'brief:lab-s201'],
    ['Meeting room L07','meeting-room','Main Library','Ground floor',12,['Projector','Whiteboard','Accessible desk'],1,'brief:meeting-l07'],
  ]) insert.run(name,type,building,floor,JSON.stringify(equipment),capacity,name,key,JSON.stringify(type === 'study-room' ? ['student','staff','teacher'] : ['staff','teacher']),accessible);
  db.exec('PRAGMA user_version = 6');
}
