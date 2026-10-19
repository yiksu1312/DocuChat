import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {assertFrozenInput} from '../eval/frozen-inputs.js';
import baseline from '../eval/retrieval-baseline.json' with {type:'json'};

test('frozen inputs accept LF, CRLF and mixed endings but reject content changes',()=>{
  const expected=createHash('sha256').update('first\nsecond\nthird\n').digest('hex');
  for(const text of ['first\nsecond\nthird\n','first\r\nsecond\r\nthird\r\n','first\nsecond\r\nthird\n']){
    assert.doesNotThrow(()=>assertFrozenInput('fixture',text,expected));
  }
  assert.throws(()=>assertFrozenInput('fixture','first\nchanged\nthird\n',expected),/FROZEN_INPUT_CHANGED/);
  assert.throws(()=>assertFrozenInput('fixture','first \nsecond\nthird\n',expected),/FROZEN_INPUT_CHANGED/);
});

test('all six frozen experiment inputs match the canonical baseline on either checkout platform',async()=>{
  assert.equal(Object.keys(baseline.hashes).length,6);
  for(const [file,hash] of Object.entries(baseline.hashes)){
    const text=await readFile(new URL('../'+file,import.meta.url),'utf8');
    assertFrozenInput(file,text.replace(/\r\n/g,'\n'),hash);
    assertFrozenInput(file,text.replace(/\r?\n/g,'\r\n'),hash);
  }
});
