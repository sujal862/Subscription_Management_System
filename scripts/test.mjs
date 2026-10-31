import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = readdirSync('tests').filter(file => file.endsWith('.test.ts')).sort().map(file => `tests/${file}`);
if (!files.length) { console.error('No test files found in tests/.'); process.exit(1); }
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
