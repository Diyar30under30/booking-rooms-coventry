import { bookingErrors, existingConflict, overlaps, fail } from './rules.mjs';

/** Strict RFC-style CSV: quoted commas, escaped quotes, CRLF and quoted newlines. */
export function parseCsv(csv) {
  if (typeof csv !== 'string') throw fail(400, 'CSV must be text.');
  if (Buffer.byteLength(csv) > 256 * 1024) throw fail(413, 'CSV must be at most 256 KB.');
  const text = csv.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], value = '', quoted = false, closed = false, atStart = true;
  const field = () => { row.push(value); value = ''; closed = false; atStart = true; };
  const record = () => { field(); rows.push(row); row = []; if (rows.length > 501) throw fail(400, 'CSV may contain at most 500 event rows.'); };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else value += char;
    } else if (char === '"') {
      if (!atStart || closed) throw fail(400, 'Malformed CSV quoting.');
      quoted = true; atStart = false;
    } else if (char === ',') field();
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; record(); }
    else {
      if (closed) throw fail(400, 'Unexpected text after a quoted CSV field.');
      value += char; atStart = false;
    }
  }
  if (quoted) throw fail(400, 'Unclosed CSV quote.');
  if (value || row.length || closed || !atStart) record();
  if (!rows.length) throw fail(400, 'CSV needs a header and at least one event.');
  const headers = rows.shift().map(header => header.trim());
  const required = ['classroom', 'date', 'start', 'end', 'title'];
  const allowed = [...required, 'attendees'];
  if (new Set(headers).size !== headers.length || headers.some(header => !allowed.includes(header)) || required.some(header => !headers.includes(header))) throw fail(400, 'Use CSV headers classroom,date,start,end,title and optional attendees.');
  if (!rows.length) throw fail(400, 'CSV needs at least one event.');
  return rows.map((cells, index) => {
    if (cells.length !== headers.length) throw fail(400, `CSV row ${index + 2} has the wrong number of fields.`);
    return { row: index + 2, ...Object.fromEntries(headers.map((header, column) => [header, cells[column].trim()])) };
  });
}

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
