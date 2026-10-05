export const localDate = now => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export const fail = (status, message) => Object.assign(new Error(message), { status });

export function bookingErrors(body, space, now) {
  const errors = [];
  if (!space || space.active !== 1 || space.type !== 'classroom' || space.bookingScope !== 'whole-room') errors.push('Choose an active classroom.');
  if (!Number.isSafeInteger(body.attendees) || body.attendees < 1) errors.push('Choose a positive whole number of attendees.');
  else if (space?.capacity != null && body.attendees > space.capacity) errors.push(`Choose an attendee count between 1 and ${space.capacity}.`);
  if (!validDate(body.date) || body.date < localDate(now)) errors.push('Choose a valid date today or later.');
  if (!validTime(body.start) || !validTime(body.end)) errors.push('Use HH:mm for start and end times.');
  else {
    if (body.date === localDate(now) && new Date(`${body.date}T${body.start}:00`) <= now) errors.push('Choose a start time in the future.');
    const duration = minutes(body.end) - minutes(body.start);
    if (minutes(body.start) < 480 || minutes(body.end) > 1320 || duration <= 0 || duration > 480) errors.push('Book between 08:00 and 22:00, for up to 8 hours.');
  }
  if (typeof body.title !== 'string' || [...body.title.trim()].length < 3 || [...body.title.trim()].length > 120) errors.push('Purpose must be text between 3 and 120 characters.');
  return errors;
}

export const overlaps = (a, b) => a.spaceId === b.spaceId && a.date === b.date && a.start < b.end && a.end > b.start;
export const existingConflict = (db, row) => db.prepare('SELECT id FROM bookings WHERE spaceId = ? AND date = ? AND start < ? AND end > ?').get(row.spaceId, row.date, row.end, row.start);
