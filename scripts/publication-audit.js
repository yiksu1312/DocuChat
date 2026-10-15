import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:64*1024*1024}).trim();
const files=git('ls-files','-z').split('\0').filter(Boolean);
const objects=git('rev-list','--objects','--all').split('\n').map(line=>{const at=line.indexOf(' ');return {oid:at<0?line:line.slice(0,at),path:at<0?'':line.slice(at+1)};});
const findings=[];
const patterns=[
 ['credential',/(?:sk-(?:proj-)?[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/],
 ['personal-local-path',/(?:C:\\+Users\\+|C:\/Users\/)[^\\\/\s"'<>]+/i]
];
const key=process.env.OPENAI_API_KEY;
function scan(text,location){
 for(const [kind,regex] of patterns) if(regex.test(text))findings.push({kind,...location});
 if(key&&key.length>15&&text.includes(key))findings.push({kind:'configured-credential',...location});
}
for(const path of files) if(fs.existsSync(path))scan(fs.readFileSync(path,'utf8'),{scope:'tracked-working-tree',path});
let blobs=0;
for(const {oid,path} of objects){
 if(!path||git('cat-file','-t',oid)!=='blob')continue;
 blobs++;scan(git('cat-file','blob',oid),{scope:'history',path,object:oid});
 if(/(^|\/)(?:\.env(?:\.(?!example$)[^/]+)?|node_modules|data|uploads|logs)(\/|$)|\.(?:db|sqlite)(?:-|$)/i.test(path))
 findings.push({kind:'runtime-or-credential-path',scope:'history',path,object:oid});
}
const authors=git('log','--all','--format=%ae%n%ce').split('\n').filter(Boolean);
const report={generatedAt:new Date().toISOString(),trackedFiles:files.length,historyBlobs:blobs,findings,
 authorIdentityReview:{distinctEmails:new Set(authors).size,hasNonNoreplyEmail:authors.some(e=>!/(?:noreply|example\.(?:com|invalid)|localhost)/i.test(e)),note:'Names/emails are Git metadata. Inspect locally before publishing history; values intentionally omitted.'},
 limits:['Pattern scan is not proof of absence of secrets or personal data.','PDF/image contents and source redistribution rights require human review.','Ignored local data is excluded, not read or copied.','No history was rewritten.']};
fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/publication-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(findings.some(f=>f.kind.includes('credential')))process.exitCode=1;
