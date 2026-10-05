import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { initialize } from '../backend/db.mjs';
import { compareRooms } from '../shared/rooms.mjs';

// Publish only the bundled room inventory, never the operator's database.
const db = new DatabaseSync(':memory:');
let spaces;
try {
  initialize(db);
  spaces = db.prepare('SELECT * FROM spaces').all().sort(compareRooms)
    .map(space => ({ ...space, amenities: JSON.parse(space.amenities) }));
} finally { db.close(); }
const outDir = fileURLToPath(new URL('../preview-dist/', import.meta.url));
await build({ mode: 'preview', build: { outDir, emptyOutDir: true } });
writeFileSync(new URL('../preview-dist/preview-spaces.json', import.meta.url), JSON.stringify(spaces));
