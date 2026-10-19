import request from 'supertest';
import {mkdir,mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {config} from '../backend/config.js';
import {createApp} from '../backend/app.js';
import {createProvider} from '../backend/provider.js';
import {createMockProvider} from '../backend/mock-provider.js';
import {makePDF} from './fixtures.js';
import {createBudget,chatCost,embeddingCost,prices} from '../eval/costs.js';
import cases from '../eval/evidence-cases.json' with {type:'json'};
import materials from '../eval/materials.json' with {type:'json'};

const offline=process.argv.includes('--offline');
const limit=Number(process.argv.find(v=>v.startsWith('--budget-usd='))?.split('=')[1]??1);
const budget=createBudget(limit);
if(!offline&&(!process.argv.includes('--allow-paid')||!config.apiKey||config.mock)){
  console.log('NOT RUN: requires --allow-paid, a local API key, and MOCK_AI=false.');process.exit(2);
}
if(!offline&&(config.chatModel!=='gpt-4.1-mini'||config.embeddingModel!=='text-embedding-3-small')){
  console.log('NOT RUN: review the price table before evaluating different models.');process.exit(2);
}
const digest=value=>createHash('sha256').update(value).digest('hex');
const snapshotFiles=['eval/evidence-cases.json','eval/materials.json','backend/pdf.js','backend/pdf-worker.js',
  'backend/memory.js','backend/provider.js','backend/citations.js','backend/evidence-check.js','backend/app.js',
  'scripts/evaluate-retrieval.js','eval/costs.js'];
const hashes=Object.fromEntries(await Promise.all(snapshotFiles.map(async file=>[file,digest(await readFile(file))])));
const previous=JSON.parse(await readFile('docs/evaluation/evidence-run.json','utf8'));
for(const file of ['eval/evidence-cases.json','eval/materials.json','backend/pdf.js','backend/pdf-worker.js','backend/provider.js','backend/citations.js']){
  // Git may convert working-tree line endings; compare canonical bytes against the historical file hash below.
  const bytes=await readFile(file,'utf8');
  const variants=[digest(bytes),digest(bytes.replace(/\r\n/g,'\n')),digest(bytes.replace(/\r?\n/g,'\r\n'))];
  if(!variants.includes(previous.hashes[file]))throw new Error('FROZEN_INPUT_CHANGED: '+file);
}
const root=path.resolve('test-results/retrieval-evaluation');await mkdir(root,{recursive:true});
const dataDir=await mkdtemp(path.join(root,'run-'));
const target=path.resolve('eval/results/retrieval-'+(offline?'offline':'real')+'.json');
await mkdir(path.dirname(target),{recursive:true});
const ledger=[],rows=[],documents={},ids={};let current='indexing',arm='shared',capture={},fatal=null;
const base=offline?createMockProvider():createProvider({...config,retries:0});
const upper=(kind,input)=>kind==='embedding'?(Buffer.byteLength(JSON.stringify(input))+256)*prices.embedding/1e6:
  ((Buffer.byteLength(JSON.stringify(input))+16000)*prices.input+900*prices.output)/1e6;
async function call(kind,input,fn,costOf){
  const reservation=offline?0:upper(kind,input),settle=budget.reserve(reservation),start=performance.now();
  try{
    const value=await fn(),cost=offline?0:costOf(value);settle(cost);
    ledger.push({caseId:current,arm,kind,durationMs:Math.round(performance.now()-start),
      usage:value.usage??(Number.isFinite(value.tokens)?{embeddingTokens:value.tokens}:null),
      estimatedUsd:cost,reservationUsd:reservation,status:'completed'});return value;
  }catch(error){settle(null);ledger.push({caseId:current,arm,kind,status:'failed',durationMs:Math.round(performance.now()-start),estimatedUsd:null,reservationUsd:reservation});throw error;}
}
const provider={mode:base.mode,
  async embed(texts,signal){
    const response=await call('embedding',texts,()=>base.embed(texts,signal),r=>embeddingCost(r.tokens));
    if(arm!=='shared')capture.queryVectorHash=digest(JSON.stringify(response.vectors));return response;
  },
  async generate(question,retrieved,signal,onDelta,history){
    capture.retrieved=retrieved;
    const response=await call('generation',{question,retrieved,history},()=>base.generate(question,retrieved,signal,onDelta,history),r=>chatCost(r.usage));
    capture.candidate=response.result;return response;
  },
  verifyEvidence(){throw new Error('Evidence checks must remain disabled in this experiment.');},
};
// The two arms run sequentially against identical indexes; only this mode changes.
const evalConfig={...config,dataDir,mock:offline,evidenceCheck:false,retrievalMode:'vector',timeout:120000,retries:0};
const app=createApp(evalConfig,provider,()=>{});
const normalize=s=>s.replace(/\s+/g,' ').toLowerCase();
const anchors=(evidence,chunks)=>evidence.map(e=>({...e,present:chunks.some(c=>c.documentId===ids[e.document]&&c.page===e.page&&normalize(c.text).includes(normalize(e.text)))}));
const sum=items=>items.reduce((total,l)=>l.estimatedUsd===null||total===null?null:total+l.estimatedUsd,0);
async function save(){
  await writeFile(target,JSON.stringify({date:new Date().toISOString(),mode:offline?'mock-harness-only':'real-openai',
    design:'Fresh paired HTTP requests, vector versus adjacent retrieval. Same parsed PDFs/indexes, separate empty sessions, alternating arm order. Both evidence checks OFF. No generation replay.',
    baselineCommit:'fca628afef63856f53ecac60e0c8a94f33ea9abd',hashes,
    models:{chat:config.chatModel,embedding:config.embeddingModel},
    settings:{temperature:0,generationMaxOutputTokens:900,evidenceCheck:false,retries:0,perRequestTimeoutMs:120000,budgetUsd:limit},
    prices,committedBudgetUsd:budget.committedUsd,fatal,documents,ledger,rows,
    reviewNotice:'Same frozen 28 cases and source material as the previous evidence study. Mock runs validate plumbing only. Anchor matches measure coverage, not correctness. Separate review must assess complete delivered answers and their citations. One paired run, not a statistical benchmark.'},null,2));
}
try{
  for(const name of [...new Set(cases.flatMap(c=>c.documents))]){
    current='index:'+name;const start=performance.now();
    const pdf=await makePDF(name==='blank'?'':materials[name]);
    const r=await request(app).post('/api/upload').attach('file',pdf,name+'.pdf');
    documents[name]={httpStatus:r.status,error:r.body.error?.code??null,durationMs:Math.round(performance.now()-start),pages:r.body.pages??null,chunks:r.body.chunks??null};
    if(r.status===201)ids[name]=r.body.documentId;
    else if(name!=='blank'||r.body.error?.code!=='PDF_NO_TEXT')throw new Error('FIXTURE_UPLOAD_FAILED');
  }
  for(const [i,c] of cases.entries()){
    current=c.id;
    if(c.expectedError){rows.push({...c,before:{error:documents[c.documents[0]].error},after:{error:documents[c.documents[0]].error},stage:'parsing',review:{status:'pending'}});await save();continue;}
    const documentIds=c.documents.map(name=>ids[name]);
    const parsed=documentIds.flatMap(id=>app.locals.store.index(id).chunks);
    const row={...c,parsedEvidence:anchors(c.evidence,parsed),order:i%2?['adjacent','vector']:['vector','adjacent'],review:{status:'pending'}};
    rows.push(row);
    for(arm of row.order){
      evalConfig.retrievalMode=arm;capture={};
      const session=await request(app).post('/api/sessions').send({documentIds});
      if(session.status!==201)throw new Error('SESSION_CREATE_FAILED');
      const start=performance.now();
      const response=await request(app).post('/api/chat').send({question:c.question,sessionId:session.body.sessionId,documentIds});
      const elapsed=Math.round(performance.now()-start),own=ledger.filter(l=>l.caseId===c.id&&l.arm===arm);
      row[arm==='vector'?'before':'after']={mode:arm,httpStatus:response.status,result:response.body,
        retrieved:capture.retrieved??[],retrievedEvidence:anchors(c.evidence,capture.retrieved??[]),candidate:capture.candidate??null,
        queryVectorHash:capture.queryVectorHash??null,timeMs:elapsed,costUsd:sum(own)};
      console.log(c.id+' '+arm+': HTTP '+response.status+'; '+elapsed+' ms');await save();
      if(response.status!==200||own.some(l=>l.status==='failed'))throw new Error('MODEL_RUN_INCOMPLETE');
    }
    row.contextsChanged=JSON.stringify(row.before.retrieved)!==JSON.stringify(row.after.retrieved);
    row.queryVectorsMatch=row.before.queryVectorHash===row.after.queryVectorHash;
    await save();
  }
}catch(error){fatal=['EVALUATION_BUDGET_EXCEEDED','FIXTURE_UPLOAD_FAILED','SESSION_CREATE_FAILED','MODEL_RUN_INCOMPLETE'].includes(error.message)?error.message:'EVALUATION_FAILED';
  console.log('Evaluation stopped: '+fatal);process.exitCode=1;
}finally{
  await save();app.locals.close();
  if(path.dirname(path.resolve(dataDir))!==root)throw new Error('Unexpected evaluation path');
  await rm(dataDir,{recursive:true,force:true});
  console.log('Saved '+path.relative(process.cwd(),target)+'; '+rows.length+' cases; committed budget USD '+budget.committedUsd.toFixed(6));
}
