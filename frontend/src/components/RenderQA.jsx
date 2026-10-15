import {useLanguage} from '../i18n.jsx';
import React from 'react';
import { Button, Empty, Tag } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
function Answer({ text }) {
  return <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}>{text || ''}</ReactMarkdown>;
}
export default function RenderQA({ conversation, busy, onRetry, onSources }) {
  const {t,errorText,list,date}=useLanguage();
  if (!conversation.length) return <Empty description={t('conversationEmpty')} />;
  return <div>{conversation.map(item => <article className="exchange" key={item.id}>
    <div className="message-scope">{t('messageScope',{names:list(item.scope?.map(d=>d.name)||item.documentIds||[])})}</div>
    {item.createdAt && <time className="message-date" dateTime={new Date(item.createdAt).toISOString()}>{date(item.createdAt)}</time>}
    <div className="question">{item.question}</div>
    <div className="answer"><Answer text={item.answer} />
      {item.status === 'streaming' && <Tag color="blue">{t('streaming')}</Tag>}
      {item.status === 'stopped' && <Tag>{t('stopped')}</Tag>}
      {item.status === 'interrupted' && <Tag color="orange">{t('interrupted')}</Tag>}
      {item.status === 'error' && <p role="alert" className="error-text">{errorText(item.error)}</p>}
      {item.status === 'done' && <div className="answer-actions"><Tag color={item.supported ? 'blue' : 'orange'}>{item.supported ? t('cited') : t('insufficient')}</Tag>
        <Button size="small" onClick={() => onSources(item)}>{t('viewSources')}</Button></div>}
      {['error', 'stopped', 'done', 'interrupted'].includes(item.status) && <Button size="small" disabled={busy} onClick={() => onRetry(item.question)}>{t('retryQuestion')}</Button>}
    </div>
  </article>)}</div>;
}
