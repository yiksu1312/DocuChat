import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resources,translate,localizedError} from '../frontend/src/locales.js';
import {evidenceFallback,validateAnswer} from '../backend/citations.js';
test('translation resources have matching keys, placeholders and all backend error codes',()=>{
 assert.deepEqual(Object.keys(resources.en).sort(),Object.keys(resources['zh-CN']).sort());
 for(const key of Object.keys(resources.en)){
  assert.ok(resources.en[key] && resources['zh-CN'][key],key);
  const params=s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
  assert.deepEqual(params(resources.en[key]),params(resources['zh-CN'][key]),key);
 }
 for(const f of readdirSync('backend').filter(f=>f.endsWith('.js'))){
  const text=readFileSync('backend/'+f,'utf8');
  for(const m of text.matchAll(/new AppError\(\d+,\s*['"]([A-Z_]+)['"]/g)) assert.ok(resources.en['error.'+m[1]],m[1]);
 }
 assert.equal(translate('en','scopeCount',{count:1234}),'Current scope (1,234)');
});
test('error localization uses codes, never raw provider messages',()=>{
 for(const locale of ['en','zh-CN']){
  assert.equal(localizedError(locale,{code:'MODEL_FAILED',message:'PRIVATE_RAW_ERROR'}),resources[locale]['error.MODEL_FAILED']);
  assert.equal(localizedError(locale,{code:'UNRECOGNIZED',message:'PRIVATE_RAW_ERROR'}),resources[locale]['error.UNKNOWN']);
 }
 assert.notEqual(localizedError('en','MODEL_FAILED'),localizedError('zh-CN','MODEL_FAILED'));
});
test('evidence fallback follows question rather than interface language',()=>{
 assert.match(evidenceFallback('What is the budget?'),/^The documents/);
 assert.match(evidenceFallback('预算多少？'),/^文档/);
 assert.match(evidenceFallback('预算多少？ Please answer in English.'),/^The documents/);
 assert.match(evidenceFallback('What is the budget? 请用中文回答。'),/^文档/);
 assert.equal(validateAnswer({supported:false},[],'What?').answer,evidenceFallback('What?'));
});
