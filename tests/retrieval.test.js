import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeIndex,retrieveMany} from '../backend/memory.js';

function index(doc,pages,scores) {
  return makeIndex(pages.map((page,i)=>({documentId:doc,name:doc+'.pdf',page,chunkId:doc+':'+i,text:'chunk '+i})),
    scores.map(score=>[score,Math.sqrt(1-score*score)]),'test');
}

test('adds a low-ranked adjacent page without replacing original hits or changing their IDs',()=>{
  const source=index('a',[3,4,10,11,12,13,14,15,16,17],[1,0.01,.9,.8,.7,.6,.5,.4,.3,.2]);
  const original=retrieveMany([source],[1,0],'test','vector');
  const expanded=retrieveMany([source],[1,0],'test','adjacent');
  assert.ok(!original.some(c=>c.page===4));assert.ok(expanded.some(c=>c.page===4));
  assert.deepEqual(expanded.slice(0,original.length),original);
  assert.ok(expanded.length<=original.length+4);
  assert.equal(new Set(expanded.map(c=>c.chunkId)).size,expanded.length);
});

test('expansion stays in the same document, skips missing physical pages and does not recurse',()=>{
  const a=index('a',[3,4,5,10,20,30,40,50,60,70],[1,.01,.001,.9,.8,.7,.6,.5,.4,.3]);
  const b=index('b',[2],[.95]);
  const hits=retrieveMany([a,b],[1,0],'test');
  assert.ok(hits.some(c=>c.documentId==='a'&&c.page===4));
  assert.ok(!hits.some(c=>c.documentId==='a'&&c.page===5));
  assert.ok(!hits.some(c=>c.documentId==='a'&&c.page===2));
  assert.equal(hits.filter(c=>c.documentId==='b').length,1);
  assert.ok(hits.every(c=>c.documentId==='a'||c.documentId==='b'));
});

test('long adjacent pages contribute only their best-ranked chunk; global bound remains 40',()=>{
  const a=index('a',[3,4,4,4,10,20,30,40,50,60,70],[1,.01,.02,.03,.9,.8,.7,.6,.5,.4,.3]);
  const hits=retrieveMany([a],[1,0],'test');
  assert.deepEqual(hits.filter(c=>c.page===4).map(c=>c.chunkId),['a:3']);
  const many=Array.from({length:20},(_,i)=>index('d'+i,[1,2,3],[1,.5,.1]));
  const bounded=retrieveMany(many,[1,0],'test');
  assert.equal(bounded.length,40);assert.equal(new Set(bounded.map(c=>c.documentId)).size,20);
});

test('neighbors carry original source identity and model validation remains enforced',()=>{
  const a=index('a',[1,2],[1,.01]);
  const hits=retrieveMany([a],[1,0],'test');
  assert.equal(hits[1].page,2);assert.equal(hits[1].name,'a.pdf');assert.equal(hits[1].chunkId,'a:1');
  assert.throws(()=>retrieveMany([a],[1,0],'different'),/重新索引/);
});
