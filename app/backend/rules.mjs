export * from '../shared/booking-rules.mjs';
export const existingConflict = (db, row) => db.prepare('SELECT id FROM bookings WHERE spaceId = ? AND date = ? AND start < ? AND end > ?').get(row.spaceId, row.date, row.end, row.start);
