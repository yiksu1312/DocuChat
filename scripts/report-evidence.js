import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=new URL('../docs/evaluation/',import.meta.url);
const raw=await readFile(new URL('evidence-run.json',base));
const run=JSON.parse(raw),review=JSON.parse(await readFile(new URL('review.json',base),'utf8'));
if(createHash('sha256').update(raw).digest('hex')!==review.rawSha256)throw new Error('Review does not match this run; review new results explicitly.');
const decisions=new Map(review.decisions.map(d=>[d.id,d]));
if(decisions.size!==run.rows.length)throw new Error('Incomplete review');
const rows=run.rows.map(r=>({...r,review:decisions.get(r.id)})),qa=rows.filter(r=>!r.expectedError);
if(rows.some(r=>!r.review))throw new Error('Missing case review');
const rate=(list,predicate)=>({passed:list.filter(predicate).length,total:list.length});
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {meanMs:values.reduce((s,n)=>s+n,0)/values.length,
 medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1]};};
const sum=(list,fn)=>list.reduce((s,r)=>s+fn(r),0);
const side=name=>{
 const suffix=name==='before'?'Before':'After',delivered=qa.filter(r=>r[name].supported);
 return {contentCorrect:rate(qa,r=>r.review['answerCorrect'+suffix]),taskPass:rate(qa,r=>r.review['answerCorrect'+suffix]&&r.review.languageCompliant),
  allCasesTaskPass:rate(rows,r=>r.review['answerCorrect'+suffix]&&r.review.languageCompliant),
  citationSupport:rate(delivered,r=>r.review['citationsSupport'+suffix]===true),answered:delivered.length,
  noAnswerRefusal:rate(qa.filter(r=>r.refuse),r=>!r[name].supported),answerableRefusals:rate(qa.filter(r=>!r.refuse),r=>!r[name].supported),
  latency:stats(qa.map(r=>r.time[name+'Ms'])),questionCostUsd:sum(qa,r=>r.cost[name+'Usd'])};
};
const summary={date:run.date,reviewer:review.reviewer,before:side('before'),after:side('after'),
 additionalCheckCalls:run.ledger.filter(l=>l.kind==='verification').length,additionalCheckUsd:sum(qa,r=>r.cost.checkUsd),
 sharedIndexingUsd:sum(run.ledger.filter(l=>l.caseId.startsWith('index:')),l=>l.estimatedUsd),actualEstimatedTotalUsd:sum(run.ledger,l=>l.estimatedUsd),
 parsedEvidenceAnchors:rate(qa.flatMap(r=>r.parsedEvidence),e=>e.present),retrievedEvidenceAnchors:rate(qa.flatMap(r=>r.retrievedEvidence),e=>e.present),
 failureStages:Object.fromEntries(['parsing','retrieval','generation','citation','verification'].map(stage=>[stage,rows.filter(r=>r.review.failureStages.includes(stage)).map(r=>r.id)]))};
await writeFile(new URL('summary.json',base),JSON.stringify(summary,null,2));
const fields=['id','question','tags','gold','before_answer','after_answer','content_correct_before','content_correct_after','language_compliant','citations_support_before','citations_support_after','check_status','failure_stages','before_ms','after_ms','check_ms','before_usd','after_usd','notes'];
const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
await writeFile(new URL('cases.csv',base),'\uFEFF'+[fields,...rows.map(r=>[r.id,r.question,r.tags.join(';'),r.gold,r.before?.answer??r.before?.error,r.after?.answer??r.after?.error,
 r.review.answerCorrectBefore,r.review.answerCorrectAfter,r.review.languageCompliant,r.review.citationsSupportBefore,r.review.citationsSupportAfter,r.after?.evidenceCheck?.status??'parsing-block',
 r.review.failureStages.join(';'),r.time?.beforeMs,r.time?.afterMs,r.time?.checkMs,r.cost?.beforeUsd,r.cost?.afterUsd,r.review.notes])].map(row=>row.map(cell).join(',')).join('\n'));
const escape=s=>String(s??'').replaceAll('|','\\|').replaceAll('\n',' ');
const pass=(r,key)=>r.review[key]&&r.review.languageCompliant?'通过':'未通过';
const table=['# 28题逐题记录','',`评审：${review.reviewer}。完整候选答案、引句、检索片段与审计输出保存在 [原始记录](evidence-run.json)，可编辑判定在 [review.json](review.json)。`,
 '', '“通过”同时要求内容正确完整、拒答适当和语言符合要求；检查器的 passed 不作为正确率。', '',
 '| ID | 问题 | 参考标准 | 改动前 | 改动后 | 原因/观察 |','| --- | --- | --- | --- | --- | --- |',
 ...rows.map(r=>`| ${r.id} | ${escape(r.question)} | ${escape(r.gold)} | ${pass(r,'answerCorrectBefore')} | ${pass(r,'answerCorrectAfter')} | ${escape(r.review.notes)} |`)];
await writeFile(new URL('cases.md',base),table.join('\n')+'\n');
console.log(JSON.stringify(summary,null,2));
