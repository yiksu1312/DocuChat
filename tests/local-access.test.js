import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { localAccess } from '../backend/local-access.js';

function app() {
  const server = express();
  server.use(localAccess);
  server.all('/api/probe', (_req, res) => res.json({ reached: true }));
  return server;
}

test('rejects DNS rebinding hosts before reaching routes', async () => {
  for (const host of ['attacker.example:5001', 'localhost.attacker.example', '127.0.0.1.attacker.example', 'user@localhost:5001']) {
    const result = await request(app()).get('/api/probe').set('Host', host);
    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'LOCAL_ACCESS_ONLY');
  }
});

test('blocks foreign and opaque origins, including multipart form uploads', async () => {
  for (const origin of ['https://attacker.example', 'null', 'http://localhost:9000', 'http://localhost:5173/path']) {
    const result = await request(app()).post('/api/probe').set('Origin', origin).field('payload', 'test');
    assert.equal(result.status, 403);
    assert.equal(result.body.reached, undefined);
  }
});

test('allows local development, same-origin production, and CLI access', async () => {
  for (const origin of [undefined, 'http://127.0.0.1:5001', 'http://localhost:5173', 'http://127.0.0.1:5174']) {
    const probe = request(app()).post('/api/probe').set('Host', '127.0.0.1:5001');
    if (origin) probe.set('Origin', origin);
    const result = await probe;
    assert.equal(result.status, 200);
    assert.equal(result.headers['cache-control'], 'no-store');
  }
});

test('blocks browser cross-site requests without an Origin', async () => {
  assert.equal((await request(app()).get('/api/probe').set('Sec-Fetch-Site', 'cross-site')).status, 403);
});
