export const NO_EVIDENCE='文档中没有足够依据回答这个问题。';
const normalize=text=>text.replace(/\s+/g,' ').trim();
export function evidenceFallback(question) {
 if (question === undefined) return NO_EVIDENCE;
 const explicit = [...question.matchAll(/(?:answer|respond|reply)\s+(?:only\s+)?in\s+(English|Chinese)|(?:请)?(?:用|使用)(英语|英文|中文|汉语)(?:回答|回复)?/gi)].at(-1);
 const chinese = explicit ? /Chinese|中文|汉语/i.test(explicit[1] || explicit[2]) : /[\u3400-\u9fff]/.test(question);
 return chinese ? NO_EVIDENCE : 'The documents do not provide enough evidence to answer this question.';
}
export function validateAnswer(raw,retrieved,question) {
 const reject=reason=>({answer:evidenceFallback(question),supported:false,citations:[],citationValidation:reason});
 if(!raw || raw.supported!==true)return reject('insufficient_evidence');
 if(typeof raw.answer!=='string'||!Array.isArray(raw.citations)||!raw.citations.length)return reject('missing_citations');
 const map=new Map(retrieved.map(chunk=>[chunk.id,chunk])), citations=[];
 for(const citation of raw.citations){
  const source=map.get(citation.id);
  if(!source||typeof citation.quote!=='string'||normalize(citation.quote).length<8||!normalize(source.text).includes(normalize(citation.quote)))return reject('invalid_citation_or_quote');
  if(!citations.some(c=>c.id===citation.id))citations.push({...source,quote:citation.quote});
 }
 const markers=[...raw.answer.matchAll(/\[S(\d+)\]/g)].map(m=>'S'+m[1]);
 if(markers.some(id=>!citations.some(c=>c.id===id)))return reject('invalid_answer_marker');
 const answer=markers.length?raw.answer:raw.answer+' '+citations.map(c=>'['+c.id+']').join(' ');
 return {answer,supported:true,citations:markers.length?citations.filter(c=>markers.includes(c.id)):citations,citationValidation:'ids_and_quotes_verified'};
}
// Decode only the JSON answer string as tokens arrive. Never expose JSON metadata as answer text.
export function partialAnswer(json) {
 const match=/"answer"\s*:\s*"/.exec(json); if(!match)return '';
 let out='',i=match.index+match[0].length;
 for(;i<json.length;i++){
  const char=json[i];if(char==='"')break;
  if(char!=='\\'){out+=char;continue;}
  if(i+1>=json.length)break;
  const escaped=json[++i];
  if(escaped==='u'){if(i+4>=json.length)break;const hex=json.slice(i+1,i+5);if(!/^[0-9a-f]{4}$/i.test(hex))break;out+=String.fromCharCode(parseInt(hex,16));i+=4;}
  else out+=({'n':'\n','r':'\r','t':'\t','b':'\b','f':'\f','"':'"','\\':'\\','/':'/'})[escaped]||'';
 }
 if(out.length && /[\uD800-\uDBFF]/.test(out.at(-1)))out=out.slice(0,-1);
 return out;
}
