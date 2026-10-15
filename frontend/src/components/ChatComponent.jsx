import {useLanguage} from '../i18n.jsx';
import React,{useState} from 'react';
import {Button,Input} from 'antd';
export default function ChatComponent({busy,ready,onAsk,onStop}){
 const {t}=useLanguage();
 const [question,setQuestion]=useState('');
 function submit(e){e.preventDefault();if(!busy&&ready&&question.trim()){onAsk(question.trim());setQuestion('');}}
 return <form className="ask-form" onSubmit={submit}><Input.TextArea aria-label={t('questionLabel')} autoSize={{minRows:2,maxRows:5}} value={question} maxLength={2000} placeholder={ready?t('questionPlaceholder'):t('choosePlaceholder')} disabled={!ready||busy} onChange={e=>setQuestion(e.target.value)}/>{busy?<Button danger onClick={onStop}>{t('stop')}</Button>:<Button type="primary" htmlType="submit" disabled={!ready||!question.trim()} aria-label={t('ask')}>{t('ask')}</Button>}</form>;
}
