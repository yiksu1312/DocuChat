import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { makePDF } from '../scripts/fixtures.js';
const root = path.resolve('test-results/process'); mkdirSync(root, { recursive: true });
async function launch(dataDir, interrupt = false) {
  const child = fork('tests/support/process-server.js', [], {
    env: { ...process.env, TEST_DATA_DIR: dataDir, TEST_INTERRUPT: String(interrupt), OPENAI_API_KEY: '' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const ready = new Promise((resolve, reject) => {
    child.on('message', message => { if (message.port) resolve(message.port); });
    child.once('exit', () => reject(new Error('Test server exited before ready')));
  });
  const port = await ready;
  return { child, base: 'http://127.0.0.1:' + port };
}
async function post(base, route, data) {
  return fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}
function upload(base, pdf, name) {
  const form = new FormData(); form.append('file', new Blob([pdf], { type: 'application/pdf' }), name);
  return fetch(base + '/api/upload', { method: 'POST', body: form });
}
test('actual backend process death recovers ready data and marks interrupted upload retryable', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(path.join(root, 'db-')); let running;
  try {
    running = await launch(dir, true);
    const pdf = await makePDF('The public fixture launch code is ORCHID-742.');
    const uploaded = await (await upload(running.base, pdf, 'public.pdf')).json();
    const scope = [uploaded.documentId];
    const session = await (await post(running.base, '/api/sessions', { documentIds: scope })).json();
    const answer = await (await post(running.base, '/api/chat', { documentIds: scope, sessionId: session.sessionId, question: 'launch code?' })).json();
    const phase = new Promise(resolve => running.child.on('message', m => { if (m.phase === 'embedding') resolve(); }));
    const pending = upload(running.base, await makePDF('INTERRUPT-MARKER public fixture'), 'interrupted.pdf').catch(() => null);
    await phase;
    const exited = once(running.child, 'exit');
    running.child.kill('SIGKILL'); // Only this disposable test child, never a user server.
    await exited; await pending;
    running = await launch(dir);
    const docs = (await (await fetch(running.base + '/api/documents')).json()).documents;
    assert.equal(docs.find(d => d.documentId === uploaded.documentId).status, 'ready');
    const interrupted = docs.find(d => d.name === 'interrupted.pdf');
    assert.equal(interrupted.error.code, 'PROCESSING_INTERRUPTED');
    const history = await (await fetch(running.base + '/api/sessions/' + session.sessionId)).json();
    assert.equal(history.messages[0].answer, answer.answer);
    assert.equal((await (await upload(running.base, pdf, 'public.pdf')).json()).reused, true);
    assert.equal((await (await fetch(running.base + '/_test/calls')).json()).calls, 0);
    assert.equal((await post(running.base, '/api/documents/' + interrupted.documentId + '/reindex', {})).status, 201);
  } finally {
    if (running?.child.exitCode === null) { const exited = once(running.child, 'exit'); running.child.kill(); await exited; }
    rmSync(dir, { recursive: true, force: true });
  }
});
