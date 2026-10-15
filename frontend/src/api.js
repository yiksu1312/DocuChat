const fail=(code='UNKNOWN')=>Object.assign(new Error(code),{code});
async function fetchAPI(path,options){
 try{return await fetch('/api'+path,options);}
 catch(e){if(options.signal?.aborted)throw fail(options.signal.reason?.name==='TimeoutError'?'MODEL_TIMEOUT':'CANCELLED');throw fail('NETWORK_ERROR');}
}
export async function request(path,options={}){
 const response=await fetchAPI(path,{...options,signal:options.signal??AbortSignal.timeout(150000)});
 if(response.status===204)return null;
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw fail(data?.error?.code);
 if(!data)throw fail('INVALID_JSON');
 return data;
}
export async function streamRequest(path,options,onEvent){
 const response=await fetchAPI(path,{...options,headers:{...options.headers,Accept:'text/event-stream'}});
 if(!response.ok){const data=await response.json().catch(()=>null);throw fail(data?.error?.code);}
 if(!response.headers.get('content-type')?.includes('text/event-stream'))throw fail('STREAM_INVALID');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',doneEvent=false;
 try{
  while(true){
   const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done}).replace(/\r\n/g,'\n');
   let end;
   while((end=buffer.indexOf('\n\n'))>=0){
    const block=buffer.slice(0,end);buffer=buffer.slice(end+2);
    const event=block.split('\n').find(line=>line.startsWith('event:'))?.slice(6).trim();
    const lines=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart());
    if(!event||!lines.length)continue;
    const data=JSON.parse(lines.join('\n'));
    if(event==='error')throw fail(data.error?.code);
    if(event==='done')doneEvent=true;
    onEvent(event,data);
   }
   if(done)break;
  }
  if(!doneEvent)throw fail('STREAM_INTERRUPTED');
 }catch(e){if(e.code)throw e;if(options.signal?.aborted)throw fail('CANCELLED');throw fail('STREAM_INTERRUPTED');}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
