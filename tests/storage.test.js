import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Store, contentHash } from '../backend/storage.js';
import { mkdirSync } from 'node:fs';
const root = path.resolve('test-results/storage'); mkdirSync(root, { recursive: true });
const config = { embeddingModel: 'test' };
test('SQLite recovers documents, vectors, sessions and interrupted tasks without a provider', () => {
  const dir = mkdtempSync(path.join(root, 'db-'));
  let s = new Store(dir, config, 'mock');
  try {
    const doc = s.createDocument('same.pdf', Buffer.from('public fixture'));
    const parsed = { pages: 1, emptyPages: [], chunks: [{ chunkId: doc.documentId + ':1:1', page: 1, text: 'original text' }] };
    s.completeDocument(doc.documentId, parsed, [[1, 0]]);
    const session = s.createSession([doc.documentId]);
    const message = s.beginMessage(session.sessionId, 'question', [doc.documentId]);
    s.finishMessage(message, 'done', { answer: 'answer', citations: [{ ...s.index(doc.documentId).chunks[0], quote: 'original text' }] });
    const interrupted = s.createDocument('interrupted.pdf', Buffer.from('unfinished'));
    s.beginMessage(session.sessionId, 'unfinished question', [doc.documentId]);
    s.close(); s = new Store(dir, config, 'mock');
    assert.deepEqual(s.index(doc.documentId).vectors, [[1, 0]]);
    assert.equal(s.find(contentHash(Buffer.from('public fixture'))).documentId, doc.documentId);
    assert.equal(s.document(interrupted.documentId).status, 'failed');
    assert.equal(s.messages(session.sessionId)[1].status, 'interrupted');
    s.deleteDocument(doc.documentId);
    assert.equal(existsSync(s.pdfPath(doc.documentId)), false);
    assert.equal(s.messages(session.sessionId)[0].answer, 'answer');
    assert.equal(s.messages(session.sessionId)[0].citations[0].sourceDeleted, true);
    assert.equal(s.messages(session.sessionId)[0].citations[0].quote, undefined);
    assert.throws(() => s.index(doc.documentId), /删除/);
  } finally { s.close(); rmSync(dir, { recursive: true }); }
});
test('configuration mismatch and a second writer are rejected without clearing data', () => {
  const dir = mkdtempSync(path.join(root, 'db-'));
  let s = new Store(dir, config, 'mock');
  try {
    const d = s.createDocument('a.pdf', Buffer.from('x'));
    assert.throws(() => new Store(dir, config, 'mock'), /already in use/);
    s.close(); s = new Store(dir, { embeddingModel: 'different' }, 'mock');
    assert.equal(s.document(d.documentId).needsReindex, true);
    assert.throws(() => s.index(d.documentId), /重新索引/);
  } finally { s.close(); rmSync(dir, { recursive: true }); }
});
