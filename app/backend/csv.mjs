import { bookingErrors, existingConflict, overlaps, fail } from './rules.mjs';

import { parseCsv } from '../shared/csv.mjs';
export { parseCsv } from '../shared/csv.mjs';

export function validateEvents(db, csv, now) {
  let parsed;
  try { parsed = parseCsv(csv); }
  catch (error) {
    if (!error.status) throw error;
    return { valid: false, rows: [{ row: 1, spaceId: null, classroom: '', date: '', start: '', end: '', title: '', attendees: 1, errors: [error.message] }], status: error.status };
  }
  const spaces = db.prepare("SELECT * FROM spaces WHERE active = 1 AND type = 'classroom' AND bookingScope = 'whole-room'").all();
  const rows = parsed.map(entry => {
    const matches = /^\d+$/.test(entry.classroom) ? spaces.filter(space => space.id === Number(entry.classroom)) : spaces.filter(space => space.name === entry.classroom);
    const space = matches.length === 1 ? matches[0] : null;
    const row = { ...entry, spaceId: space?.id ?? null, attendees: entry.attendees === undefined || entry.attendees === '' ? 1 : /^\d+$/.test(entry.attendees) ? Number(entry.attendees) : NaN };
    row.errors = bookingErrors(row, space, now);
    if (matches.length > 1) row.errors.unshift('Classroom name is ambiguous; use its numeric ID.');
    if (space && !row.errors.length && existingConflict(db, row)) row.errors.push('This classroom already has a reservation or event during that time.');
    return row;
  });
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    if (rows[i].spaceId !== null && overlaps(rows[i], rows[j])) {
      rows[i].errors.push(`Overlaps CSV row ${rows[j].row}.`);
      rows[j].errors.push(`Overlaps CSV row ${rows[i].row}.`);
    }
  }
  return { valid: rows.every(row => row.errors.length === 0), rows, status: rows.some(row => row.errors.some(error => /Overlaps|already has/.test(error))) ? 409 : 400 };
}

export const previewResult = result => ({ valid: result.valid, rows: result.rows });
