import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// Local UI tests must never inherit the real Supabase configuration.
export async function localUiBuild() {
  const prefix = path.join(tmpdir(), 'coventry-ui-build-');
  const directory = mkdtempSync(prefix);
  const cleanup = () => {
    if (!path.resolve(directory).startsWith(prefix)) throw new Error('Unexpected test-build directory');
    rmSync(directory, { recursive: true, force: true });
  };
  const distDir = path.join(directory, 'dist');
  try {
    await build({
      configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
      envFile: false,
      define: {
        'import.meta.env.VITE_SUPABASE_URL': 'undefined',
        'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': 'undefined',
      },
      build: { outDir: distDir, emptyOutDir: true },
      logLevel: 'error',
    });
    return { distDir, cleanup };
  } catch (error) { cleanup(); throw error; }
}
