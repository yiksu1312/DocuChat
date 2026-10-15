import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../backend/app.js';
import { createMockProvider } from '../backend/mock-provider.js';
import { makePDF } from '../scripts/fixtures.js';
const root = path.resolve('test-results/workflows');
mkdirSync(root, { recursive: true });
const apps = [], dirs = [];
const config = { mock: true, timeout: 5000, embeddingModel: 'mock-v1', chatModel: 'mock', retries: 0 };
function setup(provider = createMockProvider(), options = {}) {
  const dataDir = options.dataDir || mkdtempSync(path.join(root, 'data-'));
  if (!dirs.includes(dataDir)) dirs.push(dataDir);
  const app = createApp({ ...config, ...options, dataDir }, provider, () => {}); apps.push(app);
  return app;
}
after(() => { for (const app of apps) app.locals.close(); for (const dir of dirs) rmSync(dir, { recursive: true }); });
const first = await makePDF(['Orchid operating temperature is 18 degrees Celsius. Code ORCHID-742.', 'Warranty lasts 24 months.']);
const second = await makePDF('Cedar operating temperature is 21 degrees Celsius. Code CEDAR-219.');
const upload = (app, pdf = first, name = 'handbook.pdf') => request(app).post('/api/upload').attach('file', pdf, name);
async function session(app, ids) { const r = await request(app).post('/api/sessions').send({ documentIds: ids }); assert.equal(r.status, 201); return r.body.sessionId; }
const ask = (app, sid, ids, question = 'What is the operating temperature?') => request(app).post('/api/chat').send({ sessionId: sid, documentIds: ids, question });

test('duplicate content reuses index; same name different content remains independent; restart never re-embeds documents', async () => {
  const provider = createMockProvider(); const embed = provider.embed; let calls = 0;
  provider.embed = (...args) => { calls++; return embed(...args); };
  let app = setup(provider);
  const a = await upload(app), duplicate = await upload(app), b = await upload(app, second);
  assert.equal(a.status, 201); assert.equal(duplicate.body.reused, true);
  assert.equal(a.body.documentId, duplicate.body.documentId); assert.notEqual(a.body.documentId, b.body.documentId); assert.equal(calls, 2);
  const sid = await session(app, [a.body.documentId]);
  const answer = await ask(app, sid, [a.body.documentId]); assert.equal(answer.status, 200);
  const dir = app.locals.store.directory; app.locals.close();
  const before = calls; app = setup(provider, { dataDir: dir });
  assert.equal(calls, before);
  const restored = await request(app).get('/api/sessions/' + sid);
  assert.equal(restored.body.messages[0].answer, answer.body.answer);
  assert.equal((await upload(app)).body.reused, true); assert.equal(calls, before);
  assert.equal((await ask(app, sid, [a.body.documentId])).status, 200); assert.equal(calls, before + 1);
  const pdf = await request(app).get('/api/documents/' + a.body.documentId + '/file');
  assert.equal(pdf.status, 200); assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.deepEqual(pdf.body, first);
});

test('multi-document scope is fixed, restricted, and provenance comes from SQLite; history is bounded context', async () => {
  const provider = createMockProvider(); let seenHistory;
  provider.generate = async (_q, sources, _signal, delta, history) => {
    seenHistory = history; const chosen = sources.filter(s => s.page === 1);
    const answer = chosen.map(s => s.text + ' [' + s.id + ']').join('\n');
    delta(answer);
    return { result: { supported: true, answer, citations: chosen.map(s => ({ id: s.id, quote: s.text })) }, usage: {} };
  };
  const app = setup(provider), a = await upload(app), b = await upload(app, second);
  const scope = [a.body.documentId, b.body.documentId], sid = await session(app, scope);
  const both = await ask(app, sid, scope);
  assert.equal(both.status, 200); assert.equal(new Set(both.body.citations.map(s => s.documentId)).size, 2);
  assert.ok(both.body.answer.includes('18')); assert.ok(both.body.answer.includes('21'));
  const single = await ask(app, sid, [a.body.documentId]);
  assert.ok(single.body.retrieved.every(s => s.documentId === a.body.documentId));
  assert.deepEqual(seenHistory, []); // Prior broader scope is not eligible context.
  await ask(app, sid, [a.body.documentId], 'And its warranty?');
  assert.equal(seenHistory.length, 1); assert.ok(seenHistory[0].answer.includes('18'));
  assert.equal((await ask(app, sid, ['missing'])).status, 410);
  assert.equal((await ask(app, sid, [a.body.documentId, a.body.documentId])).status, 400);
  const forged = { ...single.body.retrieved[0], documentId: b.body.documentId };
  assert.throws(() => app.locals.store.validateSources([forged], [a.body.documentId]), /来源/);
});

test('deleting removes PDF, chunks and embeddings, preserves history with deleted-source markers', async () => {
  const app = setup(), a = await upload(app), sid = await session(app, [a.body.documentId]);
  await ask(app, sid, [a.body.documentId]);
  assert.equal((await request(app).delete('/api/documents/' + a.body.documentId)).status, 204);
  assert.equal(existsSync(app.locals.store.pdfPath(a.body.documentId)), false);
  assert.equal(app.locals.store.db.prepare('SELECT count(*) AS n FROM chunks').get().n, 0);
  const history = (await request(app).get('/api/sessions/' + sid)).body.messages;
  assert.ok(history[0].answer); assert.ok(history[0].citations.every(c => c.sourceDeleted && !c.quote && !c.text));
  assert.equal((await ask(app, sid, [a.body.documentId])).status, 410);
  assert.equal((await request(app).get('/api/documents/' + a.body.documentId + '/file')).status, 410);
});

test('failure/interruption can be retried; mismatched config is excluded until explicit reindex', async () => {
  const provider = createMockProvider(), embed = provider.embed; let broken = true;
  provider.embed = (...args) => { if (broken) throw { status: 429 }; return embed(...args); };
  let app = setup(provider), failed = await upload(app); assert.equal(failed.status, 503);
  let d = (await request(app).get('/api/documents')).body.documents[0];
  assert.equal(d.status, 'failed');
  assert.equal((await request(app).post('/api/sessions').send({ documentIds: [d.documentId] })).status, 409);
  broken = false;
  assert.equal((await request(app).post('/api/documents/' + d.documentId + '/reindex')).status, 201);
  const dir = app.locals.store.directory; app.locals.close();
  app = setup(provider, { dataDir: dir, splitConfig: { size: 400, overlap: 50, perPage: true, version: 2 } });
  d = (await request(app).get('/api/documents')).body.documents[0];
  assert.equal(d.needsReindex, true);
  assert.equal((await request(app).post('/api/sessions').send({ documentIds: [d.documentId] })).body.error.code, 'INDEX_CONFIG_CHANGED');
  assert.equal((await request(app).post('/api/documents/' + d.documentId + '/reindex')).status, 201);
  assert.equal((await request(app).get('/api/documents')).body.documents[0].compatible, true);
});

test('clearing an active session cancels generation and never resurrects a late message', async () => {
  const provider = createMockProvider(); let started; const ready = new Promise(r => started = r);
  provider.generate = async (_q, _sources, signal, delta) => {
    delta('partial'); started();
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  const app = setup(provider), a = await upload(app), sid = await session(app, [a.body.documentId]);
  const pending = ask(app, sid, [a.body.documentId]).then(r => r);
  await ready; await request(app).delete('/api/sessions/' + sid + '/messages');
  assert.equal((await pending).status, 499);
  assert.deepEqual((await request(app).get('/api/sessions/' + sid)).body.messages, []);
});

test('deletion during generation cancels before an answer can cite removed data', async () => {
  const provider = createMockProvider(); let started; const ready = new Promise(r => started = r);
  provider.generate = async (_q, _sources, signal) => { started(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); };
  const app = setup(provider), a = await upload(app), sid = await session(app, [a.body.documentId]);
  const pending = ask(app, sid, [a.body.documentId]).then(r => r);
  await ready; await request(app).delete('/api/documents/' + a.body.documentId);
  const response = await pending;
  assert.equal(response.status, 409); assert.equal(response.body.error.code, 'SOURCE_CHANGED');
  const message = (await request(app).get('/api/sessions/' + sid)).body.messages[0];
  assert.equal(message.status, 'error'); assert.deepEqual(message.citations, []);
});
test('query dimension mismatch is visible and offers an explicit reindex recovery', async () => {
  const provider=createMockProvider(),embed=provider.embed;let mismatch=false;
  provider.embed=async(...args)=>mismatch?{vectors:[[1,2]],tokens:null}:embed(...args);
  const app=setup(provider),doc=await upload(app),sid=await session(app,[doc.body.documentId]);
  mismatch=true;
  const r=await ask(app,sid,[doc.body.documentId]);assert.equal(r.body.error.code,'INDEX_CONFIG_CHANGED');
  const d=(await request(app).get('/api/documents')).body.documents[0];assert.equal(d.status,'failed');
  mismatch=false;assert.equal((await request(app).post('/api/documents/'+d.documentId+'/reindex')).status,201);
});
test('cancelled upload is persisted as failed and retries from the saved PDF', async () => {
  const provider=createMockProvider(),embed=provider.embed;let started,blocked=true;
  const ready=new Promise(resolve=>started=resolve);
  provider.embed=async(texts,signal)=>{
    if(!blocked)return embed(texts,signal);
    started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  };
  const app=setup(provider),pending=upload(app).then(r=>r);await ready;
  const d=(await request(app).get('/api/documents')).body.documents[0];
  assert.equal(d.status,'processing');
  await request(app).post('/api/documents/'+d.documentId+'/cancel');
  assert.equal((await pending).body.error.code,'CANCELLED');
  assert.equal((await request(app).get('/api/documents')).body.documents[0].status,'failed');
  blocked=false;assert.equal((await request(app).post('/api/documents/'+d.documentId+'/reindex')).status,201);
});
