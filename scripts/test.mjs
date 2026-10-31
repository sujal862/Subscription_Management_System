import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = readdirSync('tests').filter(file => /\.test\.tsx?$/.test(file)).sort().map(file => `tests/${file}`);
if (!files.length) { console.error('No test files found in tests/.'); process.exit(1); }
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {
  stdio: 'inherit', env: { ...process.env, TSX_TSCONFIG_PATH: 'tsconfig.tests.json' },
});
process.exit(result.status ?? 1);
