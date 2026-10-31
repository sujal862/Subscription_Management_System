import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';

test('SMTP transport sends to a local test server and rejects header injection', async () => {
  process.env.NODE_ENV = 'test';
  const sockets = new Set<Socket>(); let received = '';
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.write('220 localhost test SMTP\r\n'); let buffer = ''; let dataMode = false;
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (dataMode) {
          if (line === '.') { dataMode = false; socket.write('250 queued\r\n'); }
          else received += `${line}\n`;
        } else if (/^EHLO|^HELO/.test(line)) socket.write('250 localhost\r\n');
        else if (/^MAIL FROM:|^RCPT TO:/.test(line)) socket.write('250 OK\r\n');
        else if (line === 'DATA') { dataMode = true; socket.write('354 Send message\r\n'); }
        else if (line === 'QUIT') socket.end('221 Bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  process.env.MAIL_MODE = 'smtp'; process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = String(address.port);
  process.env.SMTP_SECURE = 'false'; process.env.SMTP_REQUIRE_TLS = 'false'; process.env.SMTP_USER = ''; process.env.SMTP_PASS = '';
  const { sendMail } = await import('../server/src/lib/mail.js');
  try {
    await sendMail({ to: 'recipient@example.test', subject: 'Transport check', text: 'Local SMTP verification message.' });
    assert.ok(received.includes('recipient@example.test')); assert.ok(received.includes('Local SMTP verification message.'));
    await assert.rejects(sendMail({ to: 'recipient@example.test', subject: 'Injected\r\nBcc: other@example.test', text: 'Invalid' }));
    await assert.rejects(sendMail({ to: 'one@example.test,two@example.test', subject: 'Invalid recipient', text: 'Invalid' }));
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
