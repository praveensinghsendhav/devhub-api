import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/** The repo root: the nearest folder above this file with a package.json (works from src and dist). */
function findRepoRoot(start: string): string | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/**
 * Loads the plain-text .env at the repo root into process.env. Values may reference other
 * variables as `${NAME}`, e.g. `DATABASE_URL=postgresql://user:pass@${HOST_IP}:5432/devhub`, so
 * HOST_IP is set once. Variables already set in the shell (or by the host, in production) win.
 */
export function loadEnvFiles(): void {
  const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const file = root && join(root, '.env');
  if (!file || !existsSync(file)) return;
  const values = parseEnv(readFileSync(file, 'utf8')) as Record<string, string>;
  values.HOST_IP ||= 'localhost';

  const lookup = (name: string): string => process.env[name] ?? values[name] ?? '';
  for (const [key, value] of Object.entries(values)) {
    process.env[key] ??= value.replace(/\$\{(\w+)\}/g, (_, name: string) => lookup(name));
  }
}
