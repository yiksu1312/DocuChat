import { Worker } from 'node:worker_threads';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { AppError } from './errors.js';
export async function parsePDF(buffer, documentId, name, signal, splitConfig = {size:800,overlap:100}) {
 const pages = await new Promise((resolve,reject) => {
  const worker = new Worker(new URL('./pdf-worker.js', import.meta.url), { workerData: buffer, resourceLimits:{maxOldGenerationSizeMb:256} });
  let settled=false;
  function end(error,value) { if(settled)return; settled=true; signal.removeEventListener('abort',abort); void worker.terminate(); error?reject(error):resolve(value); }
  function abort(){end(signal.reason);}
  signal.addEventListener('abort',abort,{once:true});
  worker.on('message',message=>message.error?end(new AppError(message.status||422,message.code||'PDF_PARSE_FAILED',message.error)):end(null,message.pages));
  worker.on('error',()=>end(new AppError(422,'PDF_PARSE_FAILED','PDF解析失败，文件可能损坏、加密或过于复杂。')));
  worker.on('exit',code=>{if(!settled)end(new AppError(422,'PDF_PARSE_FAILED','PDF解析进程提前结束。'));});
  if(signal.aborted)abort();
 });
 const splitter = new RecursiveCharacterTextSplitter({chunkSize:splitConfig.size,chunkOverlap:splitConfig.overlap});
 const chunks=[];
 for(let i=0;i<pages.length;i++){
  const texts=await splitter.splitText(pages[i]);
  for(let j=0;j<texts.length;j++) chunks.push({documentId,name,page:i+1,chunkId:documentId+':'+(i+1)+':'+(j+1),text:texts[j]});
 }
 if(!chunks.length)throw new AppError(422,'PDF_NO_TEXT','未提取到文字；扫描型或空白PDF不受支持，本项目没有OCR。');
 return {chunks,pages:pages.length,emptyPages:pages.flatMap((text,i)=>text.trim()?[]:[i+1])};
}
