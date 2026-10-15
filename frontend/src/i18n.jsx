import React,{createContext,useContext,useEffect,useMemo,useState} from 'react';
import {ConfigProvider} from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import {translate,localizedError} from './locales.js';
const Context=createContext(null);
export function LanguageProvider({children}) {
 const [locale,setLocale]=useState(()=>{try{return localStorage.getItem('docuchat-language')==='zh-CN'?'zh-CN':'en';}catch{return 'en';}});
 useEffect(()=>{document.documentElement.lang=locale;document.title=translate(locale,'pageTitle');try{localStorage.setItem('docuchat-language',locale);}catch{}},[locale]);
 const value=useMemo(()=>({locale,setLocale,t:(key,values)=>translate(locale,key,values),errorText:error=>localizedError(locale,error),
  count:(key,value)=>translate(locale,key+'.'+new Intl.PluralRules(locale).select(value),{count:value}),
  number:value=>new Intl.NumberFormat(locale).format(value),
  date:value=>new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)),
  list:values=>new Intl.ListFormat(locale,{style:'short',type:'conjunction'}).format(values.map(String))
 }),[locale]);
 return <Context.Provider value={value}><ConfigProvider locale={locale==='zh-CN'?zhCN:enUS}>{children}</ConfigProvider></Context.Provider>;
}
export const useLanguage=()=>useContext(Context);
