import { app } from './app.js';
import { config } from './lib/config.js';
import { db } from './lib/db.js';
import { waitForPasswordResetDeliveries } from './modules/auth/password-reset.js';
await db.$connect();
const server = app.listen(config.port, '127.0.0.1', () => console.log(`Brightloop API: http://localhost:${config.port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  server.close(() => { void waitForPasswordResetDeliveries().finally(() => db.$disconnect().finally(() => process.exit(0))); });
});
