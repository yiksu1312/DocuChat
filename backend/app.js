import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { createProvider } from './provider.js';
import { createMockProvider } from './mock-provider.js';
import { parsePDF } from './pdf.js';
import { makeIndex, retrieveMany } from './memory.js';
import { validateAnswer } from './citations.js';
import { AppError, publicError, bounded } from './errors.js';
import { logEvent } from './telemetry.js';
import { Store, contentHash, SPLIT_CONFIG } from './storage.js';
import { localAccess } from './local-access.js';

export function createApp(config, provider = config.mock ? createMockProvider() : createProvider(config), logger = logEvent) {
  const app = express(), store = new Store(config.dataDir, config, provider.mode);
  const uploads = new Map(), active = new Map(), instanceId = randomUUID();
  app.locals.store = store;
  app.locals.instanceId = instanceId;
  app.locals.close = () => {
    for (const controller of uploads.values()) controller.abort();
    for (const task of active.values()) task.controller.abort();
    store.close();
  };
  app.disable('x-powered-by');
  app.use(localAccess);
  app.use(express.json({ limit: '32kb' }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 } });
  const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  function channel(req, res) {
    const streaming = req.headers.accept?.includes('text/event-stream');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), config.timeout);
    timer.unref();
    const abort = () => { if (!res.writableEnded) controller.abort(new DOMException('Cancelled', 'AbortError')); };
    req.on('aborted', abort); res.on('close', abort);
    if (streaming) {
      res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
    }
    return {
      controller, signal: controller.signal, streaming,
      emit(event, data) { if (streaming && !res.destroyed && !res.writableEnded) res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); },
      done(data, status = 200) { if (streaming) { this.emit('done', data); res.end(); } else res.status(status).json(data); },
      error(error) { if (streaming) { this.emit('error', { error: { code: error.code, message: error.message } }); res.end(); } else throw error; },
      close() { clearTimeout(timer); req.off('aborted', abort); res.off('close', abort); },
    };
  }
  function scopeOf(value, allowEmpty = false) {
    if (!Array.isArray(value) || value.length > 20 || value.some(id => typeof id !== 'string') ||
        new Set(value).size !== value.length || (!allowEmpty && !value.length)) {
      throw new AppError(400, 'DOCUMENT_REQUIRED', '请选择1–20份文档，且不要重复选择。');
    }
    for (const id of value) {
      const doc = store.document(id);
      if (!doc) throw new AppError(410, 'DOCUMENT_DELETED', '范围内文档已删除，请重新选择。');
      if (!doc.compatible) throw new AppError(409, 'INDEX_CONFIG_CHANGED', '向量或分块配置变化，请重新索引后再选择。');
      if (doc.status !== 'ready') throw new AppError(409, 'DOCUMENT_NOT_READY', '只能选择处理完成的可用文档。');
    }
    return [...value];
  }
  function sessionOf(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(id)) throw new AppError(400, 'SESSION_REQUIRED', '请先创建或恢复会话。');
    const session = store.session(id);
    if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', '会话不存在，请新建会话。');
    return session;
  }
  app.get('/api/health', (_req, res) => res.json({
    status: 'ok', product: 'DocuChat', instanceId, mode: provider.mode, configured: config.mock || Boolean(config.apiKey),
    documents: store.documents().filter(d => d.status === 'ready').length, storageVersion: 1,
    models: { chat: config.chatModel, embedding: config.embeddingModel },
  }));
  app.get('/api/documents', (_req, res) => res.json({ documents: store.documents() }));
  app.get('/api/documents/:id/file', route(async (req, res) => {
    const doc = store.document(req.params.id);
    if (!doc || doc.status === 'deleting') throw new AppError(410, 'DOCUMENT_DELETED', '来源已删除。');
    const file = store.pdfPath(doc.documentId);
    if (!existsSync(file)) throw new AppError(410, 'PDF_MISSING', '本地原始PDF不存在。');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': "inline; filename*=UTF-8''" + encodeURIComponent(doc.name),
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(file);
  }));
  async function processDocument(req, res, doc, buffer) {
    const ctx = channel(req, res), requestId = randomUUID(), start = performance.now(), stages = {};
    uploads.set(doc.documentId, ctx.controller);
    try {
      ctx.emit('document', doc);
      ctx.emit('stage', { stage: 'parsing', message: '正在解析PDF并按页分块' });
      const parsed = await bounded(() => parsePDF(buffer, doc.documentId, doc.name, ctx.signal, config.splitConfig || SPLIT_CONFIG), ctx.signal);
      stages.parseMs = Math.round(performance.now() - start);
      ctx.emit('stage', { stage: 'embedding', message: '正在生成文档向量' });
      const embeddingStart = performance.now();
      const embedding = await bounded(() => provider.embed(parsed.chunks.map(c => c.text), ctx.signal), ctx.signal);
      stages.embeddingMs = Math.round(performance.now() - embeddingStart);
      ctx.emit('stage', { stage: 'indexing', message: '正在保存索引与文档状态' });
      makeIndex(parsed.chunks, embedding.vectors, config.embeddingModel);
      ctx.signal.throwIfAborted();
      const info = store.completeDocument(doc.documentId, parsed, embedding.vectors);
      logger({ event: 'upload_complete', requestId, documentId: doc.documentId, mode: provider.mode,
        embeddingModel: config.embeddingModel, embeddingTokens: embedding.tokens, durationMs: Math.round(performance.now() - start), ...stages });
      ctx.done({ ...info, reused: false }, 201);
    } catch (error) {
      const safe = publicError(error);
      if (!store.closed) store.failDocument(doc.documentId, safe);
      logger({ event: 'upload_error', requestId, documentId: doc.documentId, code: safe.code, ...stages });
      ctx.error(safe);
    } finally { uploads.delete(doc.documentId); ctx.close(); }
  }
  app.post('/api/upload', upload.single('file'), route(async (req, res) => {
    const file = req.file;
    if (!file) throw new AppError(400, 'FILE_REQUIRED', '请选择一个PDF，上传字段为file。');
    if (!/\.pdf$/i.test(file.originalname) || file.buffer.subarray(0, 5).toString() !== '%PDF-') throw new AppError(415, 'PDF_REQUIRED', '仅支持有效的PDF文件。');
    const existing = store.find(contentHash(file.buffer));
    if (existing) {
      if (existing.status === 'ready') {
        const ctx = channel(req, res);
        try { ctx.done({ ...existing, reused: true }); } finally { ctx.close(); }
        return;
      }
      throw new AppError(409, 'DOCUMENT_EXISTS', existing.status === 'processing' ? '同一文件正在处理，请等待。' : '同一文件已有失败记录，请在文档列表重试索引。');
    }
    if (store.documents().length >= 20) throw new AppError(503, 'INDEX_FULL', '最多保存20份文档，请先删除不需要的文档。');
    if (uploads.size >= 2) throw new AppError(429, 'BUSY', '正在处理其他文档，请稍后重试。');
    const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const name = decoded.includes('\uFFFD') ? file.originalname : decoded;
    await processDocument(req, res, store.createDocument(name, file.buffer), file.buffer);
  }));
  app.post('/api/documents/:id/reindex', route(async (req, res) => {
    const id = req.params.id, doc = store.document(id);
    if (!doc) throw new AppError(404, 'DOCUMENT_NOT_FOUND', '文档不存在。');
    if (uploads.has(id) || [...active.values()].some(t => t.scope.includes(id))) throw new AppError(409, 'DOCUMENT_BUSY', '请先停止此文档的处理或回答。');
    if (uploads.size >= 2) throw new AppError(429, 'BUSY', '处理请求过多，请稍后重试。');
    // If another copy now has a compatible completed index, do not silently overwrite either.
    const existing = store.find(doc.hash);
    if (existing && existing.documentId !== id) throw new AppError(409, 'COMPATIBLE_COPY_EXISTS', '已有相同内容的兼容记录，请使用该记录。');
    if (!existsSync(store.pdfPath(id))) throw new AppError(410, 'PDF_MISSING', '本地PDF缺失，请删除此记录后重新上传。');
    const buffer = readFileSync(store.pdfPath(id));
    if (contentHash(buffer) !== doc.hash) throw new AppError(409, 'PDF_CHANGED', '磁盘PDF内容已变化，请作为新文档上传。');
    await processDocument(req, res, store.beginReindex(id), buffer);
  }));
  app.post('/api/documents/:id/cancel', (req, res) => { uploads.get(req.params.id)?.abort(new DOMException('Cancelled', 'AbortError')); res.status(204).end(); });
  app.delete('/api/documents/:id', route(async (req, res) => {
    const id = req.params.id;
    if (uploads.has(id)) throw new AppError(409, 'DOCUMENT_BUSY', '请先取消文档处理，再删除。');
    for (const task of active.values()) if (task.scope.includes(id)) task.controller.abort(new AppError(409, 'SOURCE_CHANGED', '引用来源已删除，回答已停止。'));
    store.deleteDocument(id);
    res.status(204).end();
  }));
  app.get('/api/sessions', (_req, res) => res.json({ sessions: store.sessions() }));
  app.post('/api/sessions', route(async (req, res) => {
    const scope = scopeOf(req.body?.documentIds || [], true);
    res.status(201).json(store.createSession(scope));
  }));
  app.get('/api/sessions/:id', route(async (req, res) => {
    const session = sessionOf(req.params.id);
    res.json({ ...session, messages: store.messages(session.sessionId) });
  }));
  app.patch('/api/sessions/:id', route(async (req, res) => {
    sessionOf(req.params.id);
    const scope = scopeOf(req.body?.documentIds, true);
    res.json(store.setScope(req.params.id, scope));
  }));
  app.delete('/api/sessions/:id/messages', route(async (req, res) => {
    sessionOf(req.params.id);
    active.get(req.params.id)?.controller.abort(new DOMException('Cancelled', 'AbortError'));
    store.clearSession(req.params.id);
    res.status(204).end();
  }));
  app.post('/api/sessions/:id/cancel', route(async (req, res) => {
    sessionOf(req.params.id);
    const task = active.get(req.params.id);
    if (!req.body?.messageId || task?.id === req.body.messageId) task?.controller.abort(new DOMException('Cancelled', 'AbortError'));
    res.status(204).end();
  }));
  app.post('/api/chat', route(async (req, res) => {
    const { question, sessionId } = req.body || {};
    const scope = scopeOf(req.body?.documentIds ?? (req.body?.documentId ? [req.body.documentId] : undefined));
    if (typeof question !== 'string' || !question.trim() || question.length > 2000) throw new AppError(400, 'QUESTION_INVALID', '请输入1–2000字符的问题。');
    const session = sessionOf(sessionId);
    if (active.has(sessionId)) throw new AppError(409, 'CHAT_BUSY', '当前会话仍在生成，请先停止或稍后重试。');
    if (active.size >= 4) throw new AppError(429, 'BUSY', '回答请求过多，请稍后重试。');
    const history = store.messages(sessionId).filter(m => m.status === 'done' && m.supported && m.documentIds.every(id => scope.includes(id)))
      .slice(-3).map(m => ({ question: m.question.slice(0, 1000), answer: m.answer.slice(0, 1500) }));
    store.setScope(sessionId, scope);
    const id = store.beginMessage(sessionId, question.trim(), scope);
    const ctx = channel(req, res), requestId = randomUUID(), start = performance.now();
    active.set(sessionId, { controller: ctx.controller, scope, id });
    let firstTokenMs = null, text = '', retrieved = [], embeddingTokens = null, retrievalMs = null;
    try {
      ctx.emit('message', { id, requestId, sessionId, documentIds: scope });
      ctx.emit('stage', { stage: 'retrieving', message: '正在检索已固定的文档范围', requestId, sessionId, documentIds: scope });
      // History helps resolve references, but remains explicitly non-evidential.
      const query = history.length ? history.slice(-2).map(m => 'Previous question: ' + m.question + '\nPrevious answer (context only): ' + m.answer).join('\n') + '\nCurrent question: ' + question : question;
      const embedding = await bounded(() => provider.embed([query], ctx.signal), ctx.signal);
      embeddingTokens = embedding.tokens;
      const queryVector = embedding.vectors?.[0];
      if (!Array.isArray(queryVector) || !queryVector.length || queryVector.some(n => !Number.isFinite(n))) throw new AppError(502, 'EMBEDDING_INVALID', '查询向量无效，请稍后重试。');
      const indexes = scope.map(docId => store.index(docId));
      const incompatible = indexes.flatMap((index, i) => index.dimension !== queryVector.length ? [scope[i]] : []);
      if (incompatible.length) {
        const error = new AppError(409, 'INDEX_CONFIG_CHANGED', '查询与已保存向量维度不兼容，请在文档列表重新索引。');
        for (const docId of incompatible) store.db.prepare("UPDATE documents SET status='failed',error=?,updated_at=? WHERE id=?")
          .run(JSON.stringify({code:error.code,message:error.message}),Date.now(),docId);
        throw error;
      }
      retrieved = retrieveMany(indexes, queryVector, config.embeddingModel);
      store.validateSources(retrieved, scope);
      retrievalMs = Math.round(performance.now() - start);
      ctx.emit('retrieval', { retrieved, documentIds: scope, sessionId });
      ctx.emit('stage', { stage: 'generating', message: '正在生成回答；历史内容不作为证据' });
      const response = await bounded(() => provider.generate(question, retrieved, ctx.signal, delta => {
        if (ctx.signal.aborted) return;
        if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - start);
        text += delta;
        ctx.emit('delta', { text: delta, sessionId, documentIds: scope });
      }, history), ctx.signal);
      ctx.signal.throwIfAborted();
      if (store.session(sessionId)?.revision !== session.revision) throw new DOMException('Cancelled', 'AbortError');
      store.validateSources(retrieved, scope);
      const answer = validateAnswer(response.result, retrieved, question);
      const metrics = { durationMs: Math.round(performance.now() - start), firstTokenMs, retrievalMs, embeddingTokens, ...(response.usage || {}) };
      const result = { requestId, sessionId, documentIds: scope, ...answer, retrieved, metrics, mode: provider.mode };
      store.finishMessage(id, 'done', result);
      logger({ event: 'chat_complete', requestId, sessionId, documentIds: scope, mode: provider.mode, model: config.chatModel,
        embeddingModel: config.embeddingModel, ...metrics, retrievedIds: retrieved.map(s => s.chunkId), citationCount: answer.citations.length });
      ctx.done({ ...result, id });
    } catch (error) {
      const safe = publicError(error), cancelled = safe.code === 'CANCELLED';
      if (!store.closed) store.finishMessage(id, cancelled ? 'stopped' : 'error',
        { answer: text, citations: [], retrieved: [], supported: false, requestId, mode: provider.mode }, safe);
      logger({ event: 'chat_error', requestId, sessionId, code: safe.code, cancelled, durationMs: Math.round(performance.now() - start) });
      ctx.error(safe);
    } finally { active.delete(sessionId); ctx.close(); }
  }));
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', '接口不存在。')));
  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) error = new AppError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code, error.code === 'LIMIT_FILE_SIZE' ? 'PDF不能超过10 MB。' : '请使用file字段上传一个PDF。');
    if (error.type === 'entity.parse.failed') error = new AppError(400, 'INVALID_JSON', '请求JSON格式错误。');
    if (error.type === 'entity.too.large') error = new AppError(413, 'REQUEST_TOO_LARGE', '请求内容过大。');
    const safe = error instanceof AppError ? error : new AppError(500, 'INTERNAL_ERROR', '本地处理失败，请检查目录权限或磁盘空间后重试。');
    if (!res.headersSent) res.status(safe.status).json({ error: { code: safe.code, message: safe.message } });
  });
  return app;
}
