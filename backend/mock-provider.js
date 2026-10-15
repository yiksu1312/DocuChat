import { setTimeout as delay } from 'node:timers/promises';
// Explicit offline testing only. No automatic fallback from a real provider.
export function mockVector(text) {
 const v=Array(256).fill(0);
 for(const word of text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]/g)||[]){
  let hash=0;for(const c of word)hash=(hash*31+c.charCodeAt(0))>>>0;v[hash%v.length]++;
 }
 return v;
}
export function createMockProvider(){
 return {mode:'mock',
  async embed(texts,signal){signal.throwIfAborted();return {vectors:texts.map(mockVector),tokens:null};},
  async generate(question,retrieved,signal,onDelta){
   const source=retrieved[0],answer='[MOCK — not a real model] '+source.text+' ['+source.id+']';
   for(const word of answer.split(/(?<=\s)/)){await delay(15,null,{signal});onDelta(word);}
   return {result:{answer,supported:true,citations:[{id:source.id,quote:source.text}]},usage:null};
  }
 };
}
