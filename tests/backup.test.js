import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Store } from '../backend/storage.js';
const root = path.resolve('test-results/backup'); mkdirSync(root, { recursive: true });
test('cold backup preserves exact database/PDF hashes and can restore independently', () => {
  const dir = mkdtempSync(path.join(root, 'run-')), dataDir = path.join(dir, 'data'), backupDir = path.join(dir, 'backup');
  let store = new Store(dataDir, { embeddingModel: 'mock' }, 'mock');
  try {
    const doc = store.createDocument('fixture.pdf', Buffer.from('public backup fixture'));
    store.close();
    execFileSync(process.execPath, ['scripts/backup-data.js', '--output', backupDir], { env: { ...process.env, DATA_DIR: dataDir }, stdio: 'pipe' });
    assert.ok(existsSync(path.join(backupDir, 'manifest.json')));
    assert.deepEqual(readFileSync(path.join(dataDir, 'docuchat.sqlite')), readFileSync(path.join(backupDir, 'docuchat.sqlite')));
    store = new Store(backupDir, { embeddingModel: 'mock' }, 'mock');
    assert.equal(store.document(doc.documentId).name, 'fixture.pdf');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('unknown schema is refused without rewriting the existing database', () => {
  const dir = mkdtempSync(path.join(root, 'version-')), file = path.join(dir, 'docuchat.sqlite');
  const db = new DatabaseSync(file); db.exec('CREATE TABLE valuable(value TEXT); INSERT INTO valuable VALUES (\'keep\'); PRAGMA user_version=99;'); db.close();
  const before = readFileSync(file);
  try { assert.throws(() => new Store(dir, { embeddingModel: 'mock' }, 'mock'), /Unsupported database version/); assert.deepEqual(readFileSync(file), before); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
