import { copyFileSync, existsSync, closeSync, openSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log('Created local .env. It is ignored by Git.');
}
await import('dotenv/config');
// Some Windows Prisma engines report an unhelpful error if SQLite is absent.
// Open in append mode to create it without ever truncating existing data.
if (process.env.DATABASE_URL?.startsWith('file:')) {
  const databasePath = path.resolve('prisma', process.env.DATABASE_URL.slice(5));
  mkdirSync(path.dirname(databasePath), { recursive: true });
  closeSync(openSync(databasePath, 'a'));
}
for (const args of [['generate'], ['migrate', 'deploy']]) {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const result = spawnSync(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Ready. Run npm run dev, then open http://localhost:5173');
