import express from 'express';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { createApp } from './app.js';
const app = createApp(config);
const dist = fileURLToPath(new URL('../frontend/dist/', import.meta.url));
if (existsSync(dist)) { app.use(express.static(dist)); app.get('*', (_req, res) => res.sendFile(`${dist}/index.html`)); }
const server = app.listen(config.port, '127.0.0.1', () => console.log(`DocuChat: http://127.0.0.1:${config.port} (${config.mock ? 'MOCK' : 'OpenAI'})`));
server.on('listening', () => process.send?.({type:'ready',instanceId:app.locals.instanceId,port:server.address().port}));
server.requestTimeout = 180000;
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '端口已占用，请停止旧进程或修改 PORT。' : '后端启动失败。'); process.exit(1); });
process.once('exit', () => app.locals.close());
function shutdown() {
  server.close(() => { app.locals.close(); process.exit(0); });
  server.closeAllConnections();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
