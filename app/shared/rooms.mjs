const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
export const compareLabels = (a, b) => natural.compare(a, b);
export const compareRooms = (a, b) => compareLabels(a.building, b.building)
  || compareLabels(a.floor, b.floor) || compareLabels(a.room || a.name, b.room || b.name) || a.id - b.id;
export const coventryRoomNames = {
  '204': 'Large lecture room 204',
  '301': 'Library 301',
  '302': 'Club room 302',
  '303': 'Large lecture room 303',
};
export const roomTypeLabel = space => space.name.startsWith('Large lecture room ') ? 'Large lecture room'
  : space.name.startsWith('Club room ') ? 'Club room'
  : space.name.startsWith('Library ') ? 'Library' : 'Classroom';
export const resourceScope = space => {
  const scope = `Entire ${roomTypeLabel(space).toLowerCase()}`;
  return space.capacity == null ? scope : `${scope} · ${space.capacity} people`;
};

// Accept both historical classroom names and the confirmed room-use labels.
export const roomNumber = value => String(value || '').trim().match(/^(?:(?:classroom|room|library|club room|large lecture room)\s+)?(\d+)$/i)?.[1];
