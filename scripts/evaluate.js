import request from 'supertest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../backend/config.js';
import { createApp } from '../backend/app.js';
import { createMockProvider } from '../backend/mock-provider.js';
import { makePDF } from './fixtures.js';
import cases from '../eval/cases.json' with { type: 'json' };
import materials from '../eval/materials.json' with { type: 'json' };

const offline = process.argv.includes('--offline');
const smoke = process.argv.includes('--smoke');
if (!offline && !process.argv.includes('--allow-paid')) {
  console.log('NOT RUN: real API evaluation requires explicit --allow-paid. Use --offline for harness validation without model calls.');
  process.exit(2);
}
if (!offline && (!config.apiKey || config.mock)) { console.log('BLOCKED: real mode requires a backend API key and MOCK_AI=false.'); process.exit(2); }
const root = path.resolve('test-results/evaluation-data'); await mkdir(root, { recursive: true });
const dataDir = await mkdtemp(path.join(root, 'run-'));
const chosen = smoke ? cases.slice(0, 3) : cases;
const used = [...new Set(chosen.flatMap(c => c.documents))];
console.log(JSON.stringify({ mode: offline ? 'mock-harness-only' : 'real-openai', answerCalls: chosen.length + chosen.filter(c => c.contextQuestion).length,
  embeddingCalls: used.length + chosen.length + chosen.filter(c => c.contextQuestion).length, maxRetries: config.retries,
  semanticAssessment: 'pending human review; no keyword accuracy score' }));
const app = createApp({ ...config, dataDir, mock: offline }, offline ? createMockProvider() : undefined, () => {});
const rows = [], ids = {};
try {
  for (const name of used) {
    const pdf = await makePDF(materials[name]);
    const result = await request(app).post('/api/upload').attach('file', pdf, name + '.pdf');
    if (result.status !== 201) throw new Error('Fixture upload failed: ' + result.body.error?.code);
    ids[name] = result.body.documentId;
  }
  for (const c of chosen) {
    const documentIds = c.documents.map(name => ids[name]);
    const session = (await request(app).post('/api/sessions').send({ documentIds })).body;
    if (c.contextQuestion) await request(app).post('/api/chat').send({ documentIds, sessionId: session.sessionId, question: c.contextQuestion });
    const response = await request(app).post('/api/chat').send({ documentIds, sessionId: session.sessionId, question: c.question });
    const answer = response.body, normalize = s => s.replace(/\s+/g, ' ').toLowerCase();
    const evidence = c.evidence.map(e => ({
      ...e, present: (answer.retrieved || []).some(r => r.documentId === ids[e.document] && r.page === e.page && normalize(r.text).includes(normalize(e.text))),
    }));
    rows.push({ id: c.id, question: c.question, documents: c.documents, expectedAnswer: c.expectedAnswer, expectedRefusal: c.refuse,
      httpStatus: response.status, mechanicalEvidencePresence: evidence, response: answer,
      review: { retrievalSufficiency: 'pending', answerFaithfulness: 'pending', citationEntailment: 'pending', refusalAppropriate: 'pending', reviewer: null, notes: '' } });
    console.log(c.id + ': HTTP ' + response.status + '; evidence anchors=' + evidence.filter(e => e.present).length + '/' + evidence.length + '; semantic review pending');
  }
  await mkdir('eval/results', { recursive: true });
  const target = 'eval/results/stage2-' + (offline ? 'mock' : 'real') + (smoke ? '-smoke' : '') + '.json';
  await writeFile(target, JSON.stringify({ date: new Date().toISOString(), mode: offline ? 'mock-harness-only' : 'real-openai',
    models: { chat: config.chatModel, embedding: config.embeddingModel },
    warning: offline ? 'Mock vectors cannot measure real retrieval quality. Answers are deterministic plumbing fixtures.' : 'Automatic provenance/evidence checks are not semantic correctness.',
    rows }, null, 2));
  if (rows.some(r => r.httpStatus !== 200)) process.exitCode = 1;
  console.log('Review worksheet: ' + target);
} finally {
  app.locals.close();
  if (path.dirname(path.resolve(dataDir)) !== root) throw new Error('Unexpected evaluation path');
  await rm(dataDir, { recursive: true, force: true });
}
