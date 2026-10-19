import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=new URL('../docs/retrieval-evaluation/',import.meta.url);
const raw=await readFile(new URL('retrieval-run.json',base));
const run=JSON.parse(raw),review=JSON.parse(await readFile(new URL('review.json',base),'utf8'));
if(createHash('sha256').update(raw).digest('hex')!==review.rawSha256)throw new Error('Review does not match this run; review new results explicitly.');
if(run.fatal||run.mode!=='real-openai'||run.rows.length!==28)throw new Error('Incomplete real evaluation');
const decisions=new Map(review.decisions.map(d=>[d.id,d]));
if(decisions.size!==run.rows.length)throw new Error('Incomplete review');
const rows=run.rows.map(r=>({...r,review:decisions.get(r.id)})),qa=rows.filter(r=>!r.expectedError);
if(rows.some(r=>!r.review)||run.ledger.some(l=>l.status!=='completed'||!Number.isFinite(l.estimatedUsd)))throw new Error('Missing review or usage');
if(run.settings.evidenceCheck!==false||run.ledger.some(l=>l.kind==='verification')||qa.some(r=>
  r.before.result.evidenceCheck.status!=='disabled'||r.after.result.evidenceCheck.status!=='disabled'))throw new Error('Evidence-check control changed');
const rate=(list,predicate)=>({passed:list.filter(predicate).length,total:list.length});
const sum=(list,fn)=>list.reduce((s,r)=>s+fn(r),0);
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {meanMs:sum(values,n=>n)/values.length,
  medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1]};};
const side=name=>{
  const delivered=qa.filter(r=>r[name].result.supported),dec=r=>r.review[name];
  const own=run.ledger.filter(l=>l.arm===(name==='before'?'vector':'adjacent'));
  return {contentCorrect:rate(qa,r=>dec(r).contentCorrect),taskPass:rate(qa,r=>dec(r).contentCorrect&&dec(r).languageCompliant),
    allCasesTaskPass:rate(rows,r=>dec(r).contentCorrect&&dec(r).languageCompliant),
    citationSupport:rate(delivered,r=>dec(r).citationsSupport===true),answered:delivered.length,
    noAnswerCorrect:rate(qa.filter(r=>r.refuse),r=>dec(r).contentCorrect),
    answerableRefusals:rate(qa.filter(r=>!r.refuse),r=>!r[name].result.supported),
    latency:stats(qa.map(r=>r[name].timeMs)),questionCostUsd:sum(qa,r=>r[name].costUsd),
    retrievedEvidenceAnchors:rate(qa.flatMap(r=>r[name].retrievedEvidence),e=>e.present),
    calls:{embedding:own.filter(l=>l.kind==='embedding').length,generation:own.filter(l=>l.kind==='generation').length},
    tokens:Object.fromEntries(['embeddingTokens','inputTokens','cachedInputTokens','outputTokens'].map(key=>[key,sum(own,l=>l.usage?.[key]??0)])),
    failures:Object.fromEntries(['parsing','retrieval','generation','citation'].map(stage=>[stage,rows.filter(r=>dec(r).failureStages.includes(stage)).map(r=>r.id)]))};
};
const summary={date:run.date,reviewer:review.reviewer,before:side('before'),after:side('after'),
  sharedIndexingUsd:sum(run.ledger.filter(l=>l.arm==='shared'),l=>l.estimatedUsd),actualEstimatedTotalUsd:sum(run.ledger,l=>l.estimatedUsd),
  parsedEvidenceAnchors:rate(qa.flatMap(r=>r.parsedEvidence),e=>e.present),
  changedContexts:qa.filter(r=>r.contextsChanged).map(r=>r.id),matchingQueryVectors:rate(qa,r=>r.queryVectorsMatch),
  originalHitsPreserved:rate(qa,r=>JSON.stringify(r.before.retrieved)===JSON.stringify(r.after.retrieved.slice(0,r.before.retrieved.length))),
  gains:qa.filter(r=>!r.review.before.contentCorrect&&r.review.after.contentCorrect).map(r=>r.id),
  regressions:qa.filter(r=>r.review.before.contentCorrect&&!r.review.after.contentCorrect).map(r=>r.id)};
await writeFile(new URL('summary.json',base),JSON.stringify(summary,null,2));
const fields=['id','question','tags','gold','before_answer','after_answer','correct_before','correct_after','language_before','language_after',
  'citations_support_before','citations_support_after','failures_before','failures_after','contexts_changed','before_ms','after_ms','before_usd','after_usd','notes'];
const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
await writeFile(new URL('cases.csv',base),'\uFEFF'+[fields,...rows.map(r=>[r.id,r.question,r.tags.join(';'),r.gold,
  r.before.result?.answer??r.before.error,r.after.result?.answer??r.after.error,
  r.review.before.contentCorrect,r.review.after.contentCorrect,r.review.before.languageCompliant,r.review.after.languageCompliant,
  r.review.before.citationsSupport,r.review.after.citationsSupport,r.review.before.failureStages.join(';'),r.review.after.failureStages.join(';'),
  r.contextsChanged,r.before.timeMs,r.after.timeMs,r.before.costUsd,r.after.costUsd,r.review.notes])].map(row=>row.map(cell).join(',')).join('\n'));
const escape=s=>String(s??'').replaceAll('|','\\|').replaceAll('\n',' ');
const pass=(r,side)=>r.review[side].contentCorrect&&r.review[side].languageCompliant?'通过':'未通过';
await writeFile(new URL('cases.md',base),['# 同一批28题：跨页检索对照','',
  '“通过”要求内容正确完整、拒答适当、语言符合要求。引用充分性单独评分；检索锚点命中不等同回答正确。',
  '评分为非盲评的助手复核，未经独立人工确认。参见[原始输出](retrieval-run.json)、[可复核判定](review.json)、[逐题CSV](cases.csv)。','',
  '| ID | 问题 | 参考标准 | 原检索 | 相邻页扩展 | 原因/观察 |','| --- | --- | --- | --- | --- | --- |',
  ...rows.map(r=>`| ${r.id} | ${escape(r.question)} | ${escape(r.gold)} | ${pass(r,'before')} | ${pass(r,'after')} | ${escape(r.review.notes)} |`),''].join('\n'));
console.log(JSON.stringify(summary,null,2));
