import request from 'supertest';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from '../backend/config.js';
import { createApp } from '../backend/app.js';
import { createProvider } from '../backend/provider.js';
import { createMockProvider } from '../backend/mock-provider.js';
import { validateAnswer } from '../backend/citations.js';
import { makePDF } from './fixtures.js';
import { createBudget, chatCost, embeddingCost, prices } from '../eval/costs.js';
import cases from '../eval/evidence-cases.json' with {type:'json'};
import materials from '../eval/materials.json' with {type:'json'};

const offline=process.argv.includes('--offline');
const budgetArg=process.argv.find(v=>v.startsWith('--budget-usd='));
const limit=budgetArg?Number(budgetArg.split('=')[1]):1;
const budget=createBudget(limit);
if(!offline && (!process.argv.includes('--allow-paid') || !config.apiKey || config.mock)){
  console.log('NOT RUN: requires --allow-paid, a local API key, and MOCK_AI=false. Use --offline to validate the harness.');process.exit(2);
}
if(!offline && (config.chatModel!=='gpt-4.1-mini' || config.embeddingModel!=='text-embedding-3-small')){
  console.log('NOT RUN: update and review the price table before evaluating different models.');process.exit(2);
}
const root=path.resolve('test-results/evidence-evaluation');await mkdir(root,{recursive:true});
const dataDir=await mkdtemp(path.join(root,'run-'));
const target=path.resolve('eval/results/evidence-'+(offline?'offline':'real')+'.json');
await mkdir(path.dirname(target),{recursive:true});
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const snapshotFiles=['eval/evidence-cases.json','eval/materials.json','backend/pdf.js','backend/pdf-worker.js','backend/memory.js',
  'backend/provider.js','backend/citations.js','backend/evidence-check.js','backend/app.js','scripts/evaluate-evidence.js','eval/costs.js'];
const hashes=Object.fromEntries(await Promise.all(snapshotFiles.map(async file=>[file,await hash(file)])));
const ledger=[],rows=[],documents={},ids={};let current='indexing',capture={},started=0,fatal=null;
const base=offline?createMockProvider():createProvider({...config,retries:0});
// Conservative reservation: UTF-8 bytes overestimate text tokens; include message/schema overhead and maximum output.
const upper=(kind,input)=>kind==='embedding'?(Buffer.byteLength(JSON.stringify(input))+256)*prices.embedding/1e6:
  ((Buffer.byteLength(JSON.stringify(input))+16000)*prices.input+(kind==='generation'?900:1600)*prices.output)/1e6;
async function call(kind,input,fn,costOf){
  const reservation=offline?0:upper(kind,input),settle=budget.reserve(reservation),start=performance.now();
  try{
    const value=await fn(),cost=offline?0:costOf(value);settle(cost);
    ledger.push({caseId:current,kind,durationMs:Math.round(performance.now()-start),usage:value.usage??(Number.isFinite(value.tokens)?{embeddingTokens:value.tokens}:null),estimatedUsd:cost,reservationUsd:reservation,status:'completed'});
    return value;
  }catch(error){settle(null);ledger.push({caseId:current,kind,status:'failed',durationMs:Math.round(performance.now()-start),estimatedUsd:null,reservationUsd:reservation});throw error;}
}
const provider={
  mode:base.mode,
  embed:(texts,signal)=>call('embedding',texts,()=>base.embed(texts,signal),r=>embeddingCost(r.tokens)),
  async generate(question,retrieved,signal,onDelta,history){
    capture.retrieved=retrieved;
    const response=await call('generation',{question,retrieved,history},()=>base.generate(question,retrieved,signal,onDelta,history),r=>chatCost(r.usage));
    capture.raw=response.result;capture.baseline=validateAnswer(response.result,retrieved,question);
    capture.beforeMs=Math.round(performance.now()-started);return response;
  },
  async verifyEvidence(question,answer,signal){
    const response=await call('verification',{question,answer},()=>offline?Promise.resolve({result:{verdict:'supported',coversAllClaims:true,
      claims:answer.citations.map(c=>({claim:'HARNESS FIXTURE, NOT A SEMANTIC JUDGMENT',sourceIds:[c.id],verdict:'supported',reason:'Mock fixture.'}))},usage:null}):base.verifyEvidence(question,answer,signal),r=>chatCost(r.usage));
    capture.audit=response.result;return response;
  },
};
const app=createApp({...config,dataDir,mock:offline,evidenceCheck:true,timeout:120000,retries:0},provider,()=>{});
const normalize=s=>s.replace(/\s+/g,' ').toLowerCase();
const anchors=(evidence,chunks)=>evidence.map(e=>({...e,present:chunks.some(c=>c.documentId===ids[e.document]&&c.page===e.page&&normalize(c.text).includes(normalize(e.text)))}));
async function save(){
  await writeFile(target,JSON.stringify({date:new Date().toISOString(),mode:offline?'mock-harness-only':'real-openai',
    design:'Paired replay: parse/retrieve/generate once per question. Before = existing ID/quote validation. After = same candidate plus one evidence check. No second generation or changed retrieval.',
    baselineCommit:'349414f57867bfb646e805d1ceb8c3b62673ce30',hashes,models:{chat:config.chatModel,embedding:config.embeddingModel},
    settings:{temperature:0,generationMaxOutputTokens:900,verificationMaxOutputTokens:1600,retries:0,perRequestTimeoutMs:120000,budgetUsd:limit},
    prices,committedBudgetUsd:budget.committedUsd,fatal,documents,ledger,rows,
    reviewNotice:'Gold expectations frozen before calls. Anchor matches measure coverage only. Semantic correctness and citation support require separate review. Mock results are not model-quality evidence.'},null,2));
}
try{
  for(const name of [...new Set(cases.flatMap(c=>c.documents))]){
    current='index:'+name;const start=performance.now();
    const pdf=await makePDF(name==='blank'?'':materials[name]);
    const r=await request(app).post('/api/upload').attach('file',pdf,name+'.pdf');
    documents[name]={httpStatus:r.status,error:r.body.error?.code??null,durationMs:Math.round(performance.now()-start),
      pages:r.body.pages??null,chunks:r.body.chunks??null};
    if(r.status===201)ids[name]=r.body.documentId;
    else if(name!=='blank'||r.body.error?.code!=='PDF_NO_TEXT')throw new Error('FIXTURE_UPLOAD_FAILED');
  }
  for(const c of cases){
    current=c.id;capture={};
    if(c.expectedError){
      rows.push({...c,before:{error:documents[c.documents[0]].error},after:{error:documents[c.documents[0]].error},
        stage:'parsing',additionalModelCalls:0,review:{status:'pending'}});await save();continue;
    }
    const documentIds=c.documents.map(name=>ids[name]);
    const parsed=documentIds.flatMap(id=>app.locals.store.index(id).chunks);
    const session=await request(app).post('/api/sessions').send({documentIds});
    if(session.status!==201)throw new Error('SESSION_CREATE_FAILED');
    started=performance.now();
    const response=await request(app).post('/api/chat').send({question:c.question,sessionId:session.body.sessionId,documentIds});
    const elapsed=Math.round(performance.now()-started),own=ledger.filter(l=>l.caseId===c.id);
    const sum=kind=>own.filter(l=>kind.includes(l.kind)).reduce((total,l)=>l.estimatedUsd===null||total===null?null:total+l.estimatedUsd,0);
    rows.push({...c,httpStatus:response.status,parsedEvidence:anchors(c.evidence,parsed),retrievedEvidence:anchors(c.evidence,capture.retrieved||[]),
      retrieved:capture.retrieved||[],candidate:capture.raw??null,before:capture.baseline??null,after:response.body,audit:capture.audit??null,
      time:{beforeMs:capture.beforeMs??null,afterMs:elapsed,checkMs:response.body.metrics?.evidenceCheckMs??null},
      cost:{beforeUsd:sum(['embedding','generation']),afterUsd:sum(['embedding','generation','verification']),checkUsd:sum(['verification'])},
      review:{status:'pending',answerCorrectBefore:null,answerCorrectAfter:null,citationsSupportBefore:null,citationsSupportAfter:null,failureStages:[],notes:''}});
    console.log(c.id+': HTTP '+response.status+'; evidence check '+(response.body.evidenceCheck?.status??'error')+'; '+elapsed+' ms');
    await save();
    if(response.status!==200 || response.body.evidenceCheck?.status==='unavailable' || own.some(l=>l.status==='failed'))throw new Error('MODEL_RUN_INCOMPLETE');
  }
}catch(error){fatal=['EVALUATION_BUDGET_EXCEEDED','FIXTURE_UPLOAD_FAILED','SESSION_CREATE_FAILED','MODEL_RUN_INCOMPLETE'].includes(error.message)?error.message:'EVALUATION_FAILED';
  console.log('Evaluation stopped: '+fatal);process.exitCode=1;
}finally{
  await save();app.locals.close();
  if(path.dirname(path.resolve(dataDir))!==root)throw new Error('Unexpected evaluation path');
  await rm(dataDir,{recursive:true,force:true});
  console.log('Saved '+path.relative(process.cwd(),target)+'; '+rows.length+' cases; committed budget USD '+budget.committedUsd.toFixed(6));
}
