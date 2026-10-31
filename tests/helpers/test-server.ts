import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { TestContext } from 'node:test';
import type { PrismaClient } from '@prisma/client';

// Call once per test file before importing application modules. The Node test
// runner isolates files in separate processes, so fixtures never touch dev.db.
export async function testServer(t: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), 'brightloop-test-'));
  let server: Server | undefined;
  let database: PrismaClient | undefined;
  t.after(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    }
    await database?.$disconnect();
    // Nonrecursive cleanup only inside the verified temporary test directory.
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep));
    for (const filename of readdirSync(directory)) unlinkSync(path.join(directory, filename));
    rmdirSync(directory);
  });
  const filename = path.join(directory, 'test.db');
  writeFileSync(filename, '');
  process.env.DATABASE_URL = `file:${filename.replaceAll('\\', '/')}`;
  process.env.NODE_ENV = 'test';
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  const { app } = await import('../../server/src/app.js');
  const { db } = await import('../../server/src/lib/db.js');
  database = db;
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { app, db, base: `http://127.0.0.1:${address.port}/api` };
}
