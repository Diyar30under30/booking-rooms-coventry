export * from '../shared/booking-rules.mjs';
export const existingConflict = (db, row, excludeId = -1) => db.prepare("SELECT id, start, end FROM bookings WHERE spaceId = ? AND date = ? AND start < ? AND end > ? AND status IN ('requested','approved') AND id <> ?").get(row.spaceId, row.date, row.end, row.start, excludeId);
export const conflictMessage = conflict => `Conflicts with booking #${conflict.id} (${conflict.start}–${conflict.end}). Choose another time.`;
