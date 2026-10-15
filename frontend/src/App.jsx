import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Layout, Popconfirm, Select, Tag, Typography } from 'antd';
import PdfUploader from './components/PdfUploader.jsx';
import ChatComponent from './components/ChatComponent.jsx';
import RenderQA from './components/RenderQA.jsx';
import Sources from './components/Sources.jsx';
import { request, streamRequest } from './api.js';
import {useLanguage} from './i18n.jsx';

export default function App() {
  const {locale,setLocale,t,errorText,number,date,list,count}=useLanguage();
  const [documents, setDocuments] = useState([]), [sessions, setSessions] = useState([]);
  const [active, setActive] = useState(null), [scope, setScope] = useState([]);
  const [messages, setMessages] = useState([]), [selected, setSelected] = useState(null);
  const [phase, setPhase] = useState(''), [uploadPhase, setUploadPhase] = useState('');
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [health, setHealth] = useState(null);
  const generation = useRef(0), pending = useRef(null), uploadTask = useRef(null);
  const activeRef = useRef(active); activeRef.current = active;
  const usable = documents.filter(d => d.status === 'ready' && d.compatible);
  const available = new Set(usable.map(d => d.documentId));
  const validScope = scope.length > 0 && scope.every(id => available.has(id));

  async function refreshDocuments() {
    const data = await request('/documents'); setDocuments(data.documents); return data.documents;
  }
  async function refreshSessions() {
    const data = await request('/sessions'); setSessions(data.sessions); return data.sessions;
  }
  function patch(id, change) { setMessages(previous => previous.map(m => m.id === id ? { ...m, ...change } : m)); }
  function stop() {
    generation.current++;
    const task = pending.current;
    if (task) {
      task.controller.abort();
      if (task.serverId && task.sessionId) request('/sessions/' + task.sessionId + '/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: task.serverId }),
      }).catch(() => {});
      patch(task.id, { status: 'stopped', citations: [], retrieved: [] });
      pending.current = null;
    }
    setBusy(false); setPhase('');
  }
  function showSession(data, docs) {
    setActive(data.sessionId);
    localStorage.setItem('docuchat-session', data.sessionId);
    const ready = new Set(docs.filter(d => d.status === 'ready' && d.compatible).map(d => d.documentId));
    setScope(data.documentIds.filter(id => ready.has(id)));
    if (data.documentIds.some(id => !ready.has(id))) setNotice('notice.scopeUnavailable');
    setMessages(data.messages || []); setSelected(data.messages?.at(-1)?.id || null);
  }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [h, d, s] = await Promise.all([request('/health'), request('/documents'), request('/sessions')]);
        if (cancelled) return;
        setHealth(h); setDocuments(d.documents); setSessions(s.sessions);
        const saved = localStorage.getItem('docuchat-session');
        const sid = s.sessions.find(s => s.sessionId === saved)?.sessionId || s.sessions[0]?.sessionId;
        if (sid) {
          const data = await request('/sessions/' + sid);
          if (!cancelled) showSession(data, d.documents);
        }
      } catch (e) { if (!cancelled) setError(e.code || 'UNKNOWN'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; pending.current?.controller.abort(); uploadTask.current?.controller.abort(); };
  }, []);
  useEffect(() => {
    if (!documents.some(d => d.status === 'processing' || d.status === 'deleting')) return;
    const timer = setInterval(() => { refreshDocuments().catch(() => {}); }, 1500);
    return () => clearInterval(timer);
  }, [documents]);

  async function chooseSession(id) {
    stop(); const version = generation.current; setLoading(true); setError(''); setNotice('');
    try {
      const [data, docs] = await Promise.all([request('/sessions/' + id), request('/documents')]);
      if (version !== generation.current) return;
      setDocuments(docs.documents); showSession(data, docs.documents);
    } catch (e) { if (version === generation.current) setError(e.code || 'UNKNOWN'); }
    finally { if (version === generation.current) setLoading(false); }
  }
  async function newSession() {
    stop(); const version = generation.current; setLoading(true); setError(''); setNotice('');
    try {
      const data = await request('/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentIds: scope.filter(id => available.has(id)) }) });
      if (version !== generation.current) return;
      showSession({ ...data, messages: [] }, documents); await refreshSessions();
    } catch (e) { if (version === generation.current) setError(e.code || 'UNKNOWN'); }
    finally { if (version === generation.current) setLoading(false); }
  }
  function changeScope(ids) {
    stop(); setScope(ids); setError(''); setNotice('');
    // Request scope is always explicit; do not let a slow settings write alter a future question.
    if (active) request('/sessions/' + active, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentIds: ids }) }).catch(e => setError(e.code || 'UNKNOWN'));
  }
  async function processFile(file, document) {
    if (uploadTask.current) return;
    if (file && (!/\.pdf$/i.test(file.name) || file.size > 10 * 1024 * 1024)) { setError('FILE_INVALID'); return; }
    stop(); const version = generation.current;
    const controller = new AbortController(); uploadTask.current = { controller, id: document?.documentId };
    setError(''); setNotice(''); setUploading(true); setUploadPhase(file ? 'uploading' : 'reindexing');
    try {
      const form = new FormData(); if (file) form.append('file', file);
      await streamRequest(file ? '/upload' : '/documents/' + document.documentId + '/reindex',
        { method: 'POST', ...(file ? { body: form } : {}), signal: controller.signal }, (event, data) => {
          if (event === 'document') { uploadTask.current.id = data.documentId; refreshDocuments().catch(() => {}); }
          if (event === 'stage') setUploadPhase(data.stage);
          if (event === 'done') {
            if (version === generation.current) {
              setScope([data.documentId]);
              setNotice(data.reused ? 'notice.reused' : 'notice.saved');
              if (activeRef.current) request('/sessions/' + activeRef.current, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentIds: [data.documentId] }) }).catch(() => {});
            }
          }
        });
    } catch (e) { setError(controller.signal.aborted ? 'UPLOAD_CANCELLED' : (e.code || 'UNKNOWN')); }
    finally {
      uploadTask.current = null; setUploading(false); setUploadPhase('');
      await refreshDocuments().catch(e => setError(e.code || 'UNKNOWN'));
    }
  }
  function cancelUpload() {
    const task = uploadTask.current;
    task?.controller.abort();
    if (task?.id) request('/documents/' + task.id + '/cancel', { method: 'POST' }).catch(() => {});
  }
  async function removeDocument(doc) {
    if (pending.current?.scope.includes(doc.documentId)) stop();
    setError('');
    try {
      await request('/documents/' + doc.documentId, { method: 'DELETE' });
      const docs = await refreshDocuments();
      const next = scope.filter(id => id !== doc.documentId); setScope(next);
      if (active) {
        await request('/sessions/' + active, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentIds: next.filter(id => docs.some(d => d.documentId === id && d.compatible && d.status === 'ready')) }) });
        const data = await request('/sessions/' + active);
        if (activeRef.current === active) { setMessages(data.messages); }
      }
      setNotice('notice.deleted');
    } catch (e) { setError(e.code || 'UNKNOWN'); }
  }
  async function ask(question) {
    if (!validScope || pending.current || loading || uploading) return;
    const fixedScope = [...scope], localId = crypto.randomUUID(), controller = new AbortController();
    const version = ++generation.current;
    const task = { id: localId, controller, scope: fixedScope, sessionId: active };
    pending.current = task; setBusy(true); setError(''); setSelected(localId);
    setMessages(previous => [...previous, { id: localId, question, answer: '', status: 'streaming', citations: [], retrieved: [], documentIds: fixedScope,
      scope: fixedScope.map(documentId => ({ documentId, name: documents.find(d => d.documentId === documentId)?.name })) }]);
    let text = '';
    try {
      if (!task.sessionId) {
        const data = await request('/sessions', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentIds: fixedScope }) });
        if (version !== generation.current) return;
        task.sessionId = data.sessionId; setActive(data.sessionId); localStorage.setItem('docuchat-session', data.sessionId);
      }
      await streamRequest('/chat', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds: fixedScope, sessionId: task.sessionId, question }) }, (event, data) => {
        if (version !== generation.current) return;
        if (event === 'message') task.serverId = data.id;
        if (event === 'stage') setPhase(data.stage);
        if (event === 'retrieval') patch(localId, { retrieved: data.retrieved });
        if (event === 'delta') { text += data.text; patch(localId, { answer: text }); }
        if (event === 'done') patch(localId, { ...data, id: localId, serverId: data.id, status: 'done' });
      });
    } catch (e) {
      if (version !== generation.current) return;
      patch(localId, { status: controller.signal.aborted ? 'stopped' : 'error', error: { code: e.code || 'UNKNOWN' }, citations: [], retrieved: [] });
      if (['DOCUMENT_DELETED', 'INDEX_CONFIG_CHANGED', 'SOURCE_CHANGED', 'DOCUMENT_NOT_READY'].includes(e.code)) {
        setError(e.code || 'UNKNOWN'); refreshDocuments().catch(() => {});
      }
    } finally {
      if (version === generation.current) { pending.current = null; setBusy(false); setPhase(''); }
      refreshSessions().catch(() => {});
    }
  }
  async function clear() {
    stop(); const sid = active, version = generation.current;
    try {
      if (sid) await request('/sessions/' + sid + '/messages', { method: 'DELETE' });
      if (version === generation.current) { setMessages([]); setSelected(null); }
      await refreshSessions();
    } catch (e) { setError(e.code || 'UNKNOWN'); }
  }
  const message = messages.find(m => m.id === selected);
  return <Layout className="layout">
    <Layout.Header><Typography.Title level={2}>DocuChat</Typography.Title><span className="tagline">{t('tagline')}</span><div className="language-switch" role="group" aria-label={t('language')}><Button aria-pressed={locale==='en'} onClick={()=>setLocale('en')}>English</Button><Button aria-pressed={locale==='zh-CN'} onClick={()=>setLocale('zh-CN')}>简体中文</Button></div></Layout.Header>
    <Layout.Content className="workspace">
      <aside className="document-panel"><Typography.Title level={4}>{t('documents')}</Typography.Title>
        <PdfUploader busy={uploading || loading} onUpload={file => processFile(file)} />
        {uploadPhase && <div role="status" className="phase">{t('stage.'+uploadPhase)}<Button size="small" onClick={cancelUpload}>{t('cancelProcessing')}</Button></div>}
        <div className="document-tools"><Button size="small" disabled={!usable.length || loading} onClick={() => changeScope(usable.map(d => d.documentId))}>{t('selectAll')}</Button>
          <Button size="small" disabled={!scope.length || loading} onClick={() => changeScope([])}>{t('deselect')}</Button></div>
        {!documents.length && <p className="muted">{t('noDocuments')}</p>}
        <div className="document-list">{documents.map(doc => <section className="document-item" key={doc.documentId} data-document-id={doc.documentId}>
          <Checkbox checked={scope.includes(doc.documentId)} disabled={loading || doc.status !== 'ready' || !doc.compatible}
            onChange={e => changeScope(e.target.checked ? [...scope, doc.documentId] : scope.filter(id => id !== doc.documentId))}>{doc.name}</Checkbox>
          <p><Tag color={doc.status === 'ready' && doc.compatible ? 'green' : 'orange'}>{t('status.'+(!doc.compatible?'reindex':doc.status))}</Tag>
            {doc.pages > 0 && <span>{t('docCounts',{pages:count('pageCount',doc.pages),chunks:count('chunkCount',doc.chunks)})}</span>}</p>
          <small className="muted">{t('contentId',{hash:doc.hash?.slice(0,10),id:doc.documentId.slice(0,8)})}</small>
          <small className="muted">{t('updated',{date:date(doc.updatedAt)})}</small>
          {doc.error && <p className="error-text">{errorText(doc.error)}</p>}
          {!!doc.emptyPages?.length && <p className="muted">{t('emptyPages',{pages:list(doc.emptyPages.map(number))})}</p>}
          <div className="document-actions">
            {(doc.status === 'failed' || !doc.compatible) && <Button size="small" disabled={uploading || loading} onClick={() => processFile(null, doc)}>{t('retryIndex')}</Button>}
            {doc.status === 'processing' && <Button size="small" onClick={() => request('/documents/' + doc.documentId + '/cancel', { method: 'POST' }).then(refreshDocuments).catch(e => setError(e.code || 'UNKNOWN'))}>{t('cancelProcessing')}</Button>}
            <Popconfirm title={t('deleteTitle')} onConfirm={() => removeDocument(doc)} okText={t('confirmDelete')} cancelText={t('keep')}>
              <Button size="small" danger disabled={doc.status === 'processing' || loading}>{t('delete')}</Button>
            </Popconfirm>
          </div>
        </section>)}</div>
        <p className="footnote">{t('storageNote')}</p>
      </aside>
      <main className="chat-panel">
        <div className="session-toolbar"><Select aria-label={t('sessions')} placeholder={t('newChat')} value={active} disabled={loading} onChange={chooseSession}
          options={sessions.map(s => ({ value: s.sessionId, label: (s.isUntitled?t('newChat'):s.title) + ' · ' + s.sessionId.slice(0, 6) }))} />
          <Button onClick={newSession} disabled={loading}>{t('newSession')}</Button></div>
        <div className="chat-heading"><Typography.Title level={4}>{t('chatTitle')}</Typography.Title>
          <Popconfirm title={t('clearTitle')} onConfirm={clear} okText={t('confirmClear')} cancelText={t('keep')}>
            <Button disabled={loading || !messages.length}>{t('clearChat')}</Button>
          </Popconfirm></div>
        <div className="scope-banner" aria-label={t('scopeLabel')}><strong>{t('scopeCount',{count:scope.length})}</strong>
          {scope.length ? scope.map(id => <Tag key={id}>{documents.find(d => d.documentId === id)?.name || t('unavailable')}</Tag>) : <span>{t('chooseScope')}</span>}
          <small>{t('scopeHint')}</small></div>
        {health?.mode === 'mock' && <Alert type="warning" message={t('mockWarning')} />}
        {health && !health.configured && <Alert type="warning" message={t('missingKey')} />}
        {loading && <p role="status">{t('restoring')}</p>}
        {error && <Alert role="alert" type="error" message={errorText(error)} />}
        {notice && <Alert type="info" message={t(notice)} />}
        {phase && <div role="status" className="phase">{t('stage.'+phase)}</div>}
        <section className="conversation"><RenderQA conversation={messages} busy={busy || loading || uploading || !validScope} onRetry={ask} onSources={m => setSelected(m.id)} /></section>
        <ChatComponent key={active || 'new'} busy={busy} ready={validScope && !uploading && !loading} onAsk={ask} onStop={stop} />
      </main>
      <Sources message={message} />
    </Layout.Content>
  </Layout>;
}
