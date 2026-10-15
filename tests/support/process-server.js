import { createApp } from '../../backend/app.js';
import { createMockProvider } from '../../backend/mock-provider.js';
const provider = createMockProvider(), original = provider.embed; let calls = 0;
provider.embed = async (texts, signal) => {
  calls++;
  if (process.env.TEST_INTERRUPT === 'true' && texts.some(t => t.includes('INTERRUPT-MARKER'))) {
    process.send({ phase: 'embedding' });
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }
  return original(texts, signal);
};
const app = createApp({ mock: true, apiKey: '', dataDir: process.env.TEST_DATA_DIR, embeddingModel: 'mock-v1', chatModel: 'mock', timeout: 30000 }, provider, () => {});
app.get('/_test/calls', (_req, res) => res.json({ calls }));
const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
process.once('SIGTERM', () => { server.closeAllConnections(); server.close(() => { app.locals.close(); process.exit(0); }); });
