import {useLanguage} from '../i18n.jsx';
import React from 'react';
import { Empty, Typography } from 'antd';
function Source({ source, quoted = false }) {
  const {t}=useLanguage();
  return <section className="source-card">
    <strong>[{source.id}] {source.name}</strong><p>{t('physicalPage',{page:source.page})}</p>
    {source.sourceDeleted ? <p className="error-text">{t('sourceDeleted')}</p> : <>
      {quoted ? <blockquote>{source.quote}</blockquote> : <p>{source.text}</p>}
      <a href={'/api/documents/' + encodeURIComponent(source.documentId) + '/file#page=' + source.page} target="_blank" rel="noopener noreferrer">{t('openPage',{page:source.page})}</a>
      {quoted && <details><summary>{t('fullChunk')}</summary><p>{source.text}</p></details>}
    </>}
    <small>{source.chunkId}</small>
  </section>;
}
export default function Sources({ message }) {
  const {t}=useLanguage();
  const citations = message?.citations || [], retrieved = message?.retrieved || [];
  return <aside className="sources-panel"><Typography.Title level={4}>{t('sources')}</Typography.Title>
    <p className="muted">{t('sourcesHint')}</p>
    {!message ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('sourcesEmpty')} /> : <>
      <h4>{t('citedCount',{count:citations.length})}</h4>
      {!citations.length && <p>{t('noCitations')}</p>}
      {citations.map(c => <Source key={c.id} source={c} quoted />)}
      <details><summary>{t('retrievedCount',{count:retrieved.length})}</summary>
        {retrieved.map(c => <Source key={c.chunkId} source={c} />)}</details>
    </>}
  </aside>;
}
