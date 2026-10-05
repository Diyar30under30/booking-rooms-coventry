import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initialize } from '../backend/db.mjs';
import { validateEvents } from '../backend/csv.mjs';
import { resourceScope, roomTypeLabel } from '../shared/rooms.mjs';

test('room-use upgrade retains existing bookings, IDs, capacity and retirement', () => {
  const db = new DatabaseSync(':memory:');
  try {
    initialize(db);
    const labels = { 204: 'Large lecture room 204', 301: 'Library 301', 302: 'Club room 302', 303: 'Large lecture room 303' };
    for (const number of Object.keys(labels)) db.prepare("UPDATE spaces SET name = ? WHERE building = 'Coventry' AND room = ?").run(`Classroom ${number}`, number);
    const club = db.prepare("SELECT * FROM spaces WHERE building = 'Coventry' AND room = '302'").get();
    db.prepare("INSERT INTO bookings (spaceId,date,start,end,title,attendees) VALUES (?, '2030-04-12', '09:00', '10:00', 'Club gathering', 2)").run(club.id);
    db.prepare('UPDATE spaces SET active = 0, capacity = 17 WHERE id = ?').run(club.id);
    db.exec('PRAGMA user_version = 4');
    const before = db.prepare('SELECT * FROM spaces ORDER BY id').all();
    const bookings = db.prepare('SELECT * FROM bookings').all();
    initialize(db);
    const expected = before.map(space => space.building === 'Coventry' && labels[space.room] ? Object.assign(Object.create(null), space, { name: labels[space.room] }) : space);
    assert.deepEqual(db.prepare('SELECT * FROM spaces ORDER BY id').all(), expected);
    assert.deepEqual(db.prepare('SELECT * FROM bookings').all(), bookings);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
    initialize(db);
    assert.deepEqual(db.prepare('SELECT * FROM spaces ORDER BY id').all(), expected);
    const library = expected.find(space => space.name === 'Library 301');
    assert.equal(roomTypeLabel(library), 'Library');
    assert.equal(resourceScope(library), 'Entire library');
    assert.equal(resourceScope(expected.find(space => space.name === 'Large lecture room 303')), 'Entire large lecture room');
    const preview = validateEvents(db, 'classroom,date,start,end,title\nLibrary 301,2030-04-12,10:00,11:00,Library event\n', new Date(2030, 3, 11));
    assert.equal(preview.valid, true);
    assert.equal(preview.rows[0].spaceId, library.id);
  } finally { db.close(); }
});

test('failed room rename rolls back labels and version together', () => {
  const db = new DatabaseSync(':memory:');
  try {
    initialize(db);
    db.exec("UPDATE spaces SET name = 'Classroom ' || room WHERE building = 'Coventry'; PRAGMA user_version = 4;");
    db.exec("CREATE TRIGGER reject_label BEFORE UPDATE OF name ON spaces WHEN NEW.name = 'Club room 302' BEGIN SELECT RAISE(ABORT, 'Rename failed'); END;");
    const before = db.prepare('SELECT * FROM spaces ORDER BY id').all();
    assert.throws(() => initialize(db), /Rename failed/);
    assert.deepEqual(db.prepare('SELECT * FROM spaces ORDER BY id').all(), before);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4);
  } finally { db.close(); }
});
