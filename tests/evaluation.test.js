import {test} from 'node:test';
import assert from 'node:assert/strict';
import cases from '../eval/evidence-cases.json' with {type:'json'};
import {chatCost,embeddingCost,createBudget} from '../eval/costs.js';
test('paid evaluation accounts for cached tokens, missing usage and failed-call reservations',()=>{
  assert.equal(chatCost({inputTokens:1000,cachedInputTokens:400,outputTokens:100}),0.00044);
  assert.equal(chatCost(null),null);assert.equal(embeddingCost(1000),0.00002);
  const budget=createBudget(0.01);const settle=budget.reserve(0.006);settle(null);
  assert.equal(budget.committedUsd,0.006);assert.throws(()=>budget.reserve(0.005),/BUDGET/);
  assert.throws(()=>settle(0),/already/);
});
test('the fixed suite covers bilingual, missing-answer, multi-hop and parser cases',()=>{
  assert.equal(cases.length,28);assert.equal(new Set(cases.map(c=>c.id)).size,28);
  for(const tag of ['bilingual','no-answer','cross-page','conflict','parsing'])assert.ok(cases.some(c=>c.tags.includes(tag)));
  for(const c of cases){assert.ok(c.gold&&c.question);if(!c.refuse)assert.ok(c.evidence.length);}
});
