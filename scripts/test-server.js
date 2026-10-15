import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('test-results/browser-data');
await mkdir(root, { recursive: true });
const dataDir = await mkdtemp(path.join(root, 'run-'));
const children = [
  spawn(process.execPath, ['backend/server.js'], { stdio: 'inherit', env: { ...process.env, PORT: '5002', MOCK_AI: 'true', DATA_DIR: dataDir, OPENAI_API_KEY: '' } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'frontend', '--config', 'frontend/vite.config.js', '--port', '5174'], { stdio: 'inherit', env: { ...process.env, BACKEND_PORT: '5002' } }),
];
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  for (const child of children) child.kill();
  await Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(r => child.once('exit', r))));
  if (path.dirname(path.resolve(dataDir)) !== root) throw new Error('Invalid test data directory');
  await rm(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
for (const child of children) child.on('exit', code => { if (!stopping) { process.exitCode = code || 0; void stop(); } });
