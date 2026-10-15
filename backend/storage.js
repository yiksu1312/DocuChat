import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { AppError } from './errors.js';

export const SPLIT_CONFIG = Object.freeze({ size: 800, overlap: 100, perPage: true, parser: 'pdfjs-6.3.289', version: 1 });
export function indexSignature(config, mode) {
  return JSON.stringify({ embeddingModel: config.embeddingModel, mode, split: config.splitConfig || SPLIT_CONFIG });
}
export const contentHash = buffer => createHash('sha256').update(buffer).digest('hex');
const json = value => JSON.stringify(value);
const parse = (value, fallback = null) => value ? JSON.parse(value) : fallback;

export class Store {
  constructor(directory, config, mode) {
    if (!directory) throw new Error('An explicit data directory is required');
    this.directory = path.resolve(directory);
    this.signature = indexSignature(config, mode);
    this.config = config;
    this.mode = mode;
    mkdirSync(this.directory, { recursive: true });
    mkdirSync(path.join(this.directory, 'pdfs'), { recursive: true });
    this.lock = path.join(this.directory, 'store.lock');
    // Only one backend may recover/modify this directory at a time.
    try { this.lockFd = openSync(this.lock, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(readFileSync(this.lock, 'utf8')); } catch { throw new Error('Invalid data lock; inspect store.lock before reopening'); }
      if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error('Invalid lock owner');
      try { process.kill(owner.pid, 0); throw new Error('Data directory is already in use'); }
      catch (e) { if (e.code !== 'ESRCH') throw e; }
      unlinkSync(this.lock);
      this.lockFd = openSync(this.lock, 'wx');
    }
    writeFileSync(this.lockFd, json({ pid: process.pid }));
    try {
      this.db = new DatabaseSync(path.join(this.directory, 'docuchat.sqlite'), { timeout: 5000 });
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;');
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      if (version !== 0 && version !== 1) throw new Error('Unsupported database version; existing data was not migrated');
      if (!version) {
        const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
        if (tables.length) throw new Error('Unversioned existing database; backup and explicit migration required');
        this.db.exec(`
          BEGIN IMMEDIATE;
          CREATE TABLE documents (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT, signature TEXT, status TEXT NOT NULL,
            error TEXT, pages INTEGER DEFAULT 0, empty_pages TEXT DEFAULT '[]', dimension INTEGER,
            model TEXT, mode TEXT, split_json TEXT, revision INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            UNIQUE(hash, signature)
          );
          CREATE TABLE chunks (
            id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL, page INTEGER NOT NULL, text TEXT NOT NULL, vector TEXT NOT NULL
          );
          CREATE INDEX chunks_document ON chunks(document_id);
          CREATE TABLE sessions (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, scope_json TEXT NOT NULL,
            revision INTEGER DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
          );
          CREATE TABLE messages (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            question TEXT NOT NULL, scope_json TEXT NOT NULL, scope_snapshot TEXT NOT NULL,
            status TEXT NOT NULL, result_json TEXT, error_json TEXT,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
          );
          CREATE INDEX messages_session ON messages(session_id,created_at);
          PRAGMA user_version=1;
          COMMIT;
        `);
      }
      this.db.exec('PRAGMA journal_mode=WAL;');
      this.db.prepare("UPDATE documents SET status='failed',error=?,updated_at=? WHERE status='processing'")
        .run(json({ code: 'PROCESSING_INTERRUPTED', message: '上次处理被中断，请重试索引。' }), Date.now());
      this.db.prepare("UPDATE messages SET status='interrupted',error_json=?,updated_at=? WHERE status='streaming'")
        .run(json({ code: 'CHAT_INTERRUPTED', message: '后端重启中断了回答，请重试。' }), Date.now());
      for (const d of this.db.prepare("SELECT id FROM documents WHERE status='deleting'").all()) this.deleteDocument(d.id);
    } catch (error) { this.close(); throw error; }
  }
  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  pdfPath(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new AppError(404, 'DOCUMENT_NOT_FOUND', '文档不存在。');
    return path.join(this.directory, 'pdfs', id + '.pdf');
  }
  document(id) {
    const row = this.db.prepare('SELECT * FROM documents WHERE id=?').get(id);
    if (!row || row.status === 'deleted') return null;
    const compatible = row.signature === this.signature;
    return {
      documentId: row.id, name: row.name, hash: row.hash, status: row.status,
      compatible, needsReindex: !compatible, error: parse(row.error), pages: row.pages,
      emptyPages: parse(row.empty_pages, []), dimension: row.dimension, embeddingModel: row.model,
      mode: row.mode, splitConfig: parse(row.split_json), revision: row.revision,
      chunks: this.db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE document_id=?').get(id).n,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
  documents() {
    return this.db.prepare("SELECT id FROM documents WHERE status!='deleted' ORDER BY created_at DESC").all().map(r => this.document(r.id));
  }
  find(hash) {
    const row = this.db.prepare("SELECT id FROM documents WHERE hash=? AND signature=? AND status!='deleted'").get(hash, this.signature);
    return row ? this.document(row.id) : null;
  }
  createDocument(name, buffer) {
    const id = randomUUID(), now = Date.now(), target = this.pdfPath(id);
    writeFileSync(target + '.tmp', buffer, { flag: 'wx' });
    renameSync(target + '.tmp', target);
    this.db.prepare(`INSERT INTO documents(id,name,hash,signature,status,model,mode,split_json,created_at,updated_at)
      VALUES(?,?,?,?,'processing',?,?,?,?,?)`).run(id, name, contentHash(buffer), this.signature, this.config.embeddingModel, this.mode, json(this.config.splitConfig || SPLIT_CONFIG), now, now);
    return this.document(id);
  }
  beginReindex(id) {
    const doc = this.document(id);
    if (!doc) throw new AppError(404, 'DOCUMENT_NOT_FOUND', '文档不存在。');
    if (!existsSync(this.pdfPath(id))) throw new AppError(410, 'PDF_MISSING', '本地PDF缺失，请删除此记录后重新上传。');
    this.transaction(() => {
      this.db.prepare('DELETE FROM chunks WHERE document_id=?').run(id);
      this.db.prepare("UPDATE documents SET status='processing',error=NULL,signature=?,model=?,mode=?,split_json=?,dimension=NULL,updated_at=? WHERE id=?")
        .run(this.signature, this.config.embeddingModel, this.mode, json(this.config.splitConfig || SPLIT_CONFIG), Date.now(), id);
    });
    return this.document(id);
  }
  completeDocument(id, parsed, vectors) {
    this.transaction(() => {
      const doc = this.document(id);
      if (!doc || doc.status !== 'processing') throw new AppError(409, 'DOCUMENT_CHANGED', '文档状态已变化，请重试。');
      this.db.prepare('DELETE FROM chunks WHERE document_id=?').run(id);
      const insert = this.db.prepare('INSERT INTO chunks(id,document_id,ordinal,page,text,vector) VALUES(?,?,?,?,?,?)');
      parsed.chunks.forEach((chunk, i) => insert.run(chunk.chunkId, id, i, chunk.page, chunk.text, json(vectors[i])));
      this.db.prepare("UPDATE documents SET status='ready',error=NULL,pages=?,empty_pages=?,dimension=?,revision=revision+1,updated_at=? WHERE id=?")
        .run(parsed.pages, json(parsed.emptyPages), vectors[0].length, Date.now(), id);
    });
    return this.document(id);
  }
  failDocument(id, error) {
    this.db.prepare("UPDATE documents SET status='failed',error=?,updated_at=? WHERE id=? AND status='processing'")
      .run(json({ code: error.code, message: error.message }), Date.now(), id);
  }
  index(id) {
    const doc = this.document(id);
    if (!doc) throw new AppError(410, 'DOCUMENT_DELETED', '范围内文档已删除，请重新选择范围。');
    if (!doc.compatible) throw new AppError(409, 'INDEX_CONFIG_CHANGED', '向量或分块配置不兼容，请重新索引。');
    if (doc.status !== 'ready') throw new AppError(409, 'DOCUMENT_NOT_READY', '范围内有未处理完成或失败的文档。');
    const rows = this.db.prepare('SELECT * FROM chunks WHERE document_id=? ORDER BY ordinal').all(id);
    return { embeddingModel: doc.embeddingModel, dimension: doc.dimension,
      chunks: rows.map(r => ({ documentId: id, name: doc.name, page: r.page, chunkId: r.id, text: r.text, revision: doc.revision })),
      vectors: rows.map(r => parse(r.vector)) };
  }
  validateSources(sources, scope) {
    for (const source of sources) {
      const doc = this.document(source.documentId);
      const row = this.db.prepare('SELECT page,text FROM chunks WHERE id=? AND document_id=?').get(source.chunkId, source.documentId);
      if (!scope.includes(source.documentId) || !doc || doc.status !== 'ready' || !doc.compatible ||
          doc.revision !== source.revision || !row || row.page !== source.page || row.text !== source.text) {
        throw new AppError(409, 'SOURCE_CHANGED', '来源已删除或索引发生变化，请重新提问。');
      }
    }
  }
  deleteDocument(id) {
    const doc = this.document(id);
    if (!doc) return;
    this.db.prepare("UPDATE documents SET status='deleting',updated_at=? WHERE id=?").run(Date.now(), id);
    try { unlinkSync(this.pdfPath(id)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    this.transaction(() => {
      this.db.prepare('DELETE FROM chunks WHERE document_id=?').run(id);
      this.db.prepare("UPDATE documents SET status='deleted',hash=NULL,signature=NULL,error=NULL,dimension=NULL,split_json=NULL,updated_at=? WHERE id=?").run(Date.now(), id);
      // Keep historical answers, but purge removed-document quote/text snapshots.
      for (const row of this.db.prepare('SELECT id,result_json FROM messages WHERE result_json IS NOT NULL').all()) {
        const result = parse(row.result_json);
        let changed = false;
        for (const field of ['citations', 'retrieved']) {
          result[field] = (result[field] || []).map(source => {
            if (source.documentId !== id) return source;
            changed = true;
            const { text, quote, ...metadata } = source;
            return { ...metadata, sourceDeleted: true };
          });
        }
        if (changed) this.db.prepare('UPDATE messages SET result_json=? WHERE id=?').run(json(result), row.id);
      }
    });
  }
  createSession(scope, title = '新对话') {
    const id = randomUUID(), now = Date.now();
    this.db.prepare('INSERT INTO sessions(id,title,scope_json,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, title.slice(0, 80), json(scope), now, now);
    return this.session(id);
  }
  session(id) {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
    return row ? { sessionId: row.id, title: row.title, isUntitled: row.title === '新对话' && !this.db.prepare('SELECT 1 FROM messages WHERE session_id=? LIMIT 1').get(id), documentIds: parse(row.scope_json, []), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at } : null;
  }
  sessions() { return this.db.prepare('SELECT id FROM sessions ORDER BY updated_at DESC,rowid DESC').all().map(r => this.session(r.id)); }
  setScope(id, scope) {
    this.db.prepare('UPDATE sessions SET scope_json=?,updated_at=? WHERE id=?').run(json(scope), Date.now(), id);
    return this.session(id);
  }
  clearSession(id) {
    this.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE session_id=?').run(id);
      this.db.prepare("UPDATE sessions SET revision=revision+1,title='新对话',updated_at=? WHERE id=?").run(Date.now(), id);
    });
  }
  messages(id) {
    return this.db.prepare('SELECT * FROM messages WHERE session_id=? ORDER BY created_at,rowid').all(id).map(row => ({
      id: row.id, sessionId: row.session_id, question: row.question, documentIds: parse(row.scope_json, []),
      scope: parse(row.scope_snapshot, []), status: row.status, error: parse(row.error_json),
      createdAt: row.created_at, ...(parse(row.result_json, {})),
    }));
  }
  beginMessage(sessionId, question, scope) {
    const id = randomUUID(), now = Date.now();
    const snapshot = scope.map(documentId => ({ documentId, name: this.document(documentId).name }));
    this.db.prepare(`INSERT INTO messages(id,session_id,question,scope_json,scope_snapshot,status,created_at,updated_at)
      VALUES(?,?,?,?,?,'streaming',?,?)`).run(id, sessionId, question, json(scope), json(snapshot), now, now);
    this.db.prepare("UPDATE sessions SET title=CASE WHEN title='新对话' THEN ? ELSE title END,updated_at=? WHERE id=?")
      .run(question.slice(0, 60), now, sessionId);
    return id;
  }
  finishMessage(id, status, result, error = null) {
    this.db.prepare("UPDATE messages SET status=?,result_json=?,error_json=?,updated_at=? WHERE id=? AND status='streaming'")
      .run(status, result ? json(result) : null, error ? json({ code: error.code, message: error.message }) : null, Date.now(), id);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.db?.close(); } finally {
      if (this.lockFd !== undefined) { closeSync(this.lockFd); unlinkSync(this.lock); }
    }
  }
}
