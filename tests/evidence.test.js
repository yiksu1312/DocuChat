import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../backend/app.js';
import { createMockProvider } from '../backend/mock-provider.js';
import { validateAnswer } from '../backend/citations.js';
import { auditPasses, checkEvidence } from '../backend/evidence-check.js';
import { makePDF } from '../scripts/fixtures.js';

const source = {id:'S1',text:'Orchid capacity is 37 liters.',page:1,chunkId:'a:1:1',documentId:'a',name:'a.pdf'};
const candidate = validateAnswer({supported:true,answer:'Orchid capacity is 37 liters [S1].',citations:[{id:'S1',quote:source.text}]},[source]);
const audit = {verdict:'supported',coversAllClaims:true,claims:[{claim:'Orchid capacity is 37 liters.',sourceIds:['S1'],verdict:'supported',reason:'Exact quantity in quote.'}]};

test('ID and quote checks alone accept an unsupported quantity; the evidence gate can reject it',async()=>{
  const wrong=validateAnswer({...candidate,answer:'Orchid capacity is 99 liters [S1].'},[source]);
  assert.equal(wrong.supported,true);
  const checked=await checkEvidence(wrong,'Capacity?',{verifyEvidence:async()=>({result:{...audit,verdict:'unsupported'}})},new AbortController().signal,true);
  assert.equal(checked.answer.supported,false);assert.deepEqual(checked.answer.citations,[]);
  assert.ok(!checked.answer.answer.includes('99'));assert.equal(checked.answer.evidenceCheck.status,'rejected');
});

test('incomplete, unknown-source and contradictory audit structures fail closed',()=>{
  assert.equal(auditPasses(audit,candidate),true);
  for(const bad of [null,{}, {...audit,claims:[]}, {...audit,coversAllClaims:false}, {...audit,verdict:'uncertain'},
    {...audit,claims:[{...audit.claims[0],sourceIds:['S99']}]}, {...audit,claims:[{...audit.claims[0],verdict:'unsupported'}]}]) {
    assert.equal(auditPasses(bad,candidate),false);
  }
});

test('existing refusals and disabled checks make no verification calls',async()=>{
  const provider={verifyEvidence:()=>assert.fail('unexpected check')},signal=new AbortController().signal;
  assert.equal((await checkEvidence(candidate,'q',provider,signal,false)).answer.evidenceCheck.status,'disabled');
  assert.equal((await checkEvidence({...candidate,supported:false},'q',provider,signal,true)).answer.evidenceCheck.status,'skipped');
});

const root=path.resolve('test-results/evidence');mkdirSync(root,{recursive:true});const apps=[],dirs=[];
after(()=>{apps.forEach(a=>a.locals.close());dirs.forEach(d=>rmSync(d,{recursive:true,force:true}));});
async function setup(verifyEvidence){
  const provider=createMockProvider();
  provider.generate=async(_q,sources,_s,delta)=>{delta('UNVERIFIED_DRAFT');return {result:{supported:true,answer:'Orchid capacity is 37 liters [S1].',citations:[{id:'S1',quote:sources[0].text}]}};};
  provider.verifyEvidence=verifyEvidence;
  const dataDir=mkdtempSync(path.join(root,'db-'));dirs.push(dataDir);
  const app=createApp({dataDir,mock:true,timeout:5000,embeddingModel:'mock',chatModel:'mock',evidenceCheck:true},provider,()=>{});apps.push(app);
  const doc=await request(app).post('/api/upload').attach('file',await makePDF(source.text),'orchid.pdf');assert.equal(doc.status,201);
  const session=(await request(app).post('/api/sessions').send({documentIds:[doc.body.documentId]})).body;
  const ask=()=>request(app).post('/api/chat').send({question:'What capacity?',documentIds:[doc.body.documentId],sessionId:session.sessionId});
  return {app,ask,session,doc:doc.body};
}

test('checked streaming publishes only the final answer, records separate check cost, and persists its status',async()=>{
  const {app,ask,session}=await setup(async()=>({result:audit,usage:{inputTokens:42,outputTokens:10}}));
  const result=await ask().set('Accept','text/event-stream');
  assert.match(result.text,/checkingEvidence/);assert.match(result.text,/"status":"passed"/);
  assert.ok(!result.text.includes('UNVERIFIED_DRAFT'));assert.ok(!result.text.includes('event: delta'));
  const saved=(await request(app).get('/api/sessions/'+session.sessionId)).body.messages[0];
  assert.equal(saved.evidenceCheck.status,'passed');assert.equal(saved.metrics.evidenceCheckUsage.inputTokens,42);
  assert.ok(saved.metrics.firstTokenMs>=saved.metrics.retrievalMs);
});

test('verification outages do not release drafts or pretend the document lacks evidence',async()=>{
  const {app,ask,session}=await setup(async()=>{throw new Error('PRIVATE_RAW_ERROR');});
  const r=await ask();assert.equal(r.status,200);assert.equal(r.body.evidenceCheck.status,'unavailable');
  assert.equal(r.body.supported,false);assert.match(r.body.answer,/unavailable/);assert.deepEqual(r.body.citations,[]);
  const history=(await request(app).get('/api/sessions/'+session.sessionId)).text;
  assert.ok(!history.includes('UNVERIFIED_DRAFT'));assert.ok(!history.includes('PRIVATE_RAW_ERROR'));
});

for(const action of ['clear','delete'])test('a '+action+' during verification cannot resurrect a checked answer',async()=>{
  let started;const ready=new Promise(r=>{started=r;});
  const {app,ask,session,doc}=await setup(async(_q,_a,signal)=>{started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));});
  const pending=ask().then(r=>r);await ready;
  await request(app).delete(action==='clear'?'/api/sessions/'+session.sessionId+'/messages':'/api/documents/'+doc.documentId);
  const r=await pending;assert.ok(r.status>=400);
  const saved=(await request(app).get('/api/sessions/'+session.sessionId)).body.messages;
  assert.equal(saved.filter(m=>m.status==='done').length,0);assert.ok(!JSON.stringify(saved).includes('UNVERIFIED_DRAFT'));
});
