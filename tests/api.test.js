import {test,after} from 'node:test';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import request from 'supertest';
import {createApp} from '../backend/app.js';
import {createProvider} from '../backend/provider.js';
import {createMockProvider} from '../backend/mock-provider.js';
import {validateAnswer,partialAnswer} from '../backend/citations.js';
import {makeIndex,retrieve} from '../backend/memory.js';
import {makePDF} from '../scripts/fixtures.js';
const config={mock:true,timeout:5000,retries:0,embeddingModel:'mock-v1',chatModel:'mock'};
const root=path.resolve('test-results/api');mkdirSync(root,{recursive:true});const apps=[],dirs=[];
const appFor=(provider=createMockProvider(),options={})=>{
 const dataDir=options.dataDir||mkdtempSync(path.join(root,'db-'));if(!dirs.includes(dataDir))dirs.push(dataDir);
 const app=createApp({...config,...options,dataDir},provider,()=>{});apps.push(app);
 app.locals.testSession=app.locals.store.createSession([]).sessionId;return app;
};
after(()=>{for(const app of apps)app.locals.close();for(const dir of dirs)rmSync(dir,{recursive:true});});
const orchid=await makePDF('Orchid project launch code is ORCHID-742. Storage capacity is 37 liters.');
const cedar=await makePDF('Cedar project launch code is CEDAR-219. Storage capacity is 83 liters.');
const upload=(app,pdf=orchid,name='orchid.pdf')=>request(app).post('/api/upload').attach('file',pdf,name);
const ask=(app,id,question='What is the launch code?')=>request(app).post('/api/chat').send({documentId:id,sessionId:app.locals.testSession,question});
test('health labels mock explicitly',async()=>{const r=await request(appFor()).get('/api/health');assert.equal(r.body.product,'DocuChat');assert.equal(r.body.mode,'mock');});
test('reindexing a missing PDF returns a recovery error without losing its ready index',async()=>{
 const app=appFor(), doc=await upload(app), id=doc.body.documentId;
 rmSync(app.locals.store.pdfPath(id));
 const result=await request(app).post('/api/documents/'+id+'/reindex');
 assert.equal(result.status,410);assert.equal(result.body.error.code,'PDF_MISSING');
 assert.equal(app.locals.store.document(id).status,'ready');
});
test('real PDF parsing, memory retrieval, metadata and document isolation',async()=>{
 const app=appFor(),a=await upload(app),b=await upload(app,cedar,'cedar.pdf');
 assert.equal(a.status,201);assert.equal(b.status,201);
 for(const [doc,expected,foreign] of [[a,'ORCHID-742','CEDAR-219'],[b,'CEDAR-219','ORCHID-742'],[a,'ORCHID-742','CEDAR-219']]){
  const r=await ask(app,doc.body.documentId);assert.equal(r.status,200);assert.ok(r.body.answer.includes(expected));assert.ok(!r.body.answer.includes(foreign));
  assert.equal(r.body.citations[0].documentId,doc.body.documentId);assert.equal(r.body.citations[0].page,1);assert.ok(r.body.citations[0].chunkId);assert.ok(r.body.citations[0].quote);assert.ok(r.body.retrieved.length);
 }
});
test('upload emits actual ordered phases',async()=>{
 const r=await upload(appFor()).set('Accept','text/event-stream');assert.equal(r.status,200);
 const phases=[...r.text.matchAll(/"stage":"([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(phases,['parsing','embedding','indexing']);assert.match(r.text,/event: done/);
});
test('chat emits retrieval, real provider deltas and final validation',async()=>{
 const app=appFor(),doc=await upload(app);
 const r=await ask(app,doc.body.documentId).set('Accept','text/event-stream');
 assert.match(r.text,/event: retrieval/);assert.match(r.text,/event: delta/);assert.match(r.text,/event: done/);assert.match(r.text,/ids_and_quotes_verified/);
});
test('reject nonPDF, spoofedPDF, missing file and wrong field',async()=>{
 const app=appFor();
 for(const name of ['bad.txt','bad.pdf'])assert.equal((await upload(app,Buffer.from('not pdf'),name)).status,415);
 assert.equal((await request(app).post('/api/upload')).status,400);
 assert.equal((await request(app).post('/api/upload').attach('wrong',orchid,'x.pdf')).status,400);
});
test('size limit and parser failure',async()=>{
 assert.equal((await upload(appFor(),Buffer.alloc(10*1024*1024+1),'big.pdf')).status,413);
 const r=await upload(appFor(),Buffer.from('%PDF-1.4 corrupt'),'bad.pdf');assert.equal(r.status,422);
});
test('blank PDF is not a successful OCR parse',async()=>{
 const r=await upload(appFor(),await makePDF(''),'blank.pdf');assert.equal(r.status,422);assert.equal(r.body.error.code,'PDF_NO_TEXT');
});
test('missing document, bad question, bad session and invalid JSON',async()=>{
 const app=appFor();
 assert.equal((await request(app).post('/api/chat').send({question:'x'})).body.error.code,'DOCUMENT_REQUIRED');
 const d=await upload(app);assert.equal((await ask(app,d.body.documentId,' ')).body.error.code,'QUESTION_INVALID');
 assert.equal((await request(app).post('/api/chat').send({documentId:d.body.documentId,question:'x'})).body.error.code,'SESSION_REQUIRED');
 assert.equal((await request(app).post('/api/chat').set('Content-Type','application/json').send('{')).body.error.code,'INVALID_JSON');
});
test('missing key does not silently enable mock',async()=>{
 const app=appFor(createProvider({...config,apiKey:''}),{mock:false,apiKey:''});
 const r=await upload(app);assert.equal(r.status,503);assert.equal(r.body.error.code,'API_KEY_MISSING');
});
test('upstream errors are redacted and no index survives failed embeddings',async()=>{
 const provider=createMockProvider();provider.embed=async()=>{throw Object.assign(new Error('secret upstream payload'),{status:401});};
 const app=appFor(provider),r=await upload(app);assert.equal(r.status,502);assert.equal(r.body.error.code,'MODEL_AUTH_FAILED');assert.ok(!JSON.stringify(r.body).includes('secret'));
 assert.equal((await request(app).get('/api/health')).body.documents,0);
});
test('model failure is emitted after streaming headers',async()=>{
 const provider=createMockProvider();provider.generate=async()=>{throw {status:429};};
 const app=appFor(provider),doc=await upload(app),r=await ask(app,doc.body.documentId).set('Accept','text/event-stream');
 assert.match(r.text,/event: error/);assert.match(r.text,/MODEL_RATE_LIMIT/);assert.ok(!r.text.includes('event: done'));
});
test('total deadline aborts provider work',async()=>{
 const provider=createMockProvider();let observed=false;
 provider.generate=async(_q,_r,signal)=>new Promise((_,reject)=>signal.addEventListener('abort',()=>{observed=true;reject(signal.reason);},{once:true}));
 const app=appFor(provider,{timeout:1000}),doc=await upload(app);assert.equal(doc.status,201);
 const r=await ask(app,doc.body.documentId);assert.equal(r.status,504);assert.equal(r.body.error.code,'MODEL_TIMEOUT');assert.equal(observed,true);
});
test('HTTP disconnect aborts an in-flight generator',async()=>{
 const provider=createMockProvider();let cancelled=false,started;
 const ready=new Promise(resolve=>{started=resolve;});
 provider.generate=async(_q,_r,signal,delta)=>{delta('partial');started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>{cancelled=true;reject(signal.reason);},{once:true}));};
 const app=appFor(provider),doc=await upload(app),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const controller=new AbortController();
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({documentId:doc.body.documentId,sessionId:app.locals.testSession,question:'code?'}),signal:controller.signal});
  await ready;controller.abort();await response.body.cancel().catch(()=>{});
  for(let i=0;i<30&&!cancelled;i++)await new Promise(r=>setTimeout(r,10));assert.equal(cancelled,true);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
const sources=[{id:'S1',documentId:'a',name:'a.pdf',page:2,chunkId:'a:2:1',text:'The storage capacity is 37 liters.'},{id:'S2',documentId:'a',name:'a.pdf',page:3,chunkId:'a:3:1',text:'Unrelated maintenance information.'}];
test('only actually selected validated citations appear',()=>{
 const r=validateAnswer({supported:true,answer:'37 liters [S1]',citations:[{id:'S1',quote:'capacity is 37 liters'}]},sources);
 assert.equal(r.citations.length,1);assert.equal(r.citations[0].page,2);assert.equal(r.supported,true);
});
test('invented ID, invented quote or unbound answer marker fail closed',()=>{
 for(const raw of [
 {answer:'37 [S99]',supported:true,citations:[{id:'S99',quote:'capacity is 37 liters'}]},
 {answer:'37 [S1]',supported:true,citations:[{id:'S1',quote:'capacity is 99 liters'}]},
 {answer:'37 [S2]',supported:true,citations:[{id:'S1',quote:'capacity is 37 liters'}]}
 ]){const r=validateAnswer(raw,sources);assert.equal(r.supported,false);assert.deepEqual(r.citations,[]);}
});
test('insufficient evidence has no citations',()=>{assert.equal(validateAnswer({supported:false,answer:'guessed',citations:[]},sources).supported,false);});
test('JSON streaming handles escapes and split Unicode',()=>{
 const answer='中文 "quote"\n\\ slash 😀';const json=JSON.stringify({answer,supported:true,citations:[]});
 let previous='';for(let i=1;i<=json.length;i++){const p=partialAnswer(json.slice(0,i));assert.ok(p.startsWith(previous));previous=p;}assert.equal(previous,answer);
});
test('embedding model/dimension mismatch cannot mix indexes',()=>{
 const index=makeIndex([{text:'x'}],[[1,2]],'v1');
 assert.throws(()=>retrieve(index,[1,2],'v2'),/重新索引/);assert.throws(()=>retrieve(index,[1,2,3],'v1'),/重新索引/);
});
test('omitted display markers are appended only for model-selected verified sources',()=>{
 const r=validateAnswer({supported:true,answer:'37 liters',citations:[{id:'S1',quote:'capacity is 37 liters'}]},sources);
 assert.equal(r.answer,'37 liters [S1]');assert.deepEqual(r.citations.map(c=>c.id),['S1']);
});
