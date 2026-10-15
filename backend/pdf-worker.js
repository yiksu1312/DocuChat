import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
let task;
try {
 task=getDocument({data:new Uint8Array(workerData),isEvalSupported:false,useSystemFonts:true,verbosity:0});
 const pdf=await task.promise;
 if(pdf.numPages>200)throw {status:413,code:'DOCUMENT_TOO_LARGE',message:'PDF超过200页，请拆分上传。'};
 const pages=[];let count=0;
 for(let i=1;i<=pdf.numPages;i++){
  const page=await pdf.getPage(i), content=await page.getTextContent();
  const text=content.items.map(item=>('str' in item?item.str+(item.hasEOL?'\n':' '):'')).join('').trim();
  count+=text.length;
  if(count>300000)throw {status:413,code:'DOCUMENT_TOO_LARGE',message:'文档超过300,000字符，请拆分上传。'};
  pages.push(text);page.cleanup();
 }
 parentPort.postMessage({pages});
} catch(e) { parentPort.postMessage({status:e.status,code:e.code,error:e.code==='DOCUMENT_TOO_LARGE'?e.message:'PDF解析失败，文件可能损坏或加密。'}); }
finally { if(task)await task.destroy(); }
