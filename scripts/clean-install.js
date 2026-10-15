import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,fork} from 'node:child_process';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const base=path.join(root,'test-results');mkdirSync(base,{recursive:true});
const target=mkdtempSync(path.join(base,'clean-install-'));
const manifest=JSON.parse(readFileSync(path.join(root,'docs/release-files.json'),'utf8'));
for(const relative of manifest.files){
 const source=path.resolve(root,relative),destination=path.resolve(target,relative);
 if(!source.startsWith(root)||!destination.startsWith(target+path.sep)||!lstatSync(source).isFile()||lstatSync(source).isSymbolicLink())throw Error('Unsafe release entry: '+relative);
 if(/(^|\/)(node_modules|data|uploads|test-results|dist|\.git)(\/|$)/.test(relative)||(/(^|\/)\.env/.test(relative)&&!relative.endsWith('.env.example')))throw Error('Private release entry: '+relative);
 mkdirSync(path.dirname(destination),{recursive:true});copyFileSync(source,destination);
}
const env={...process.env,OPENAI_API_KEY:'',MOCK_AI:'false',DATA_DIR:path.join(target,'test-results','no-key-data'),PORT:'5004'};
const results=[];
for(const args of [['ci','--no-audit','--no-fund'],['run','check'],['test'],['run','build']]){
 const label=args.join('-'),npmCLI=process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
 const result=spawnSync(process.execPath,[npmCLI,...args],{cwd:target,env,encoding:'utf8',maxBuffer:16*1024*1024,timeout:240000,windowsHide:true});
 writeFileSync(path.join(target,label+'.log'),(result.stdout||'')+(result.stderr||''));
 assert.equal(result.status,0,'Clean install command failed: '+label+' (see isolated log)');
 results.push({command:'npm '+args.join(' '),passed:true});
}
const child=fork(path.join(target,'backend/server.js'),[],{cwd:target,env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
try {
 const ready=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('No-key server startup timed out')),20000);
  child.once('message',message=>{clearTimeout(timer);resolve(message);});
  child.once('exit',()=>{clearTimeout(timer);reject(Error('No-key server exited before readiness'));});
 });
 assert.equal(ready.type,'ready');
 const baseURL='http://127.0.0.1:'+ready.port;
 const health=await (await fetch(baseURL+'/api/health')).json();
 assert.equal(health.instanceId,ready.instanceId);assert.equal(health.configured,false);assert.equal(health.mode,'openai');
 const page=await fetch(baseURL);assert.equal(page.status,200);assert.match(await page.text(),/DocuChat/);
 const form=new FormData();form.append('file',new Blob([readFileSync(path.join(target,'fixtures/orchid.pdf'))],{type:'application/pdf'}),'orchid.pdf');
 const upload=await fetch(baseURL+'/api/upload',{method:'POST',body:form});
 assert.equal(upload.status,503);assert.equal((await upload.json()).error.code,'API_KEY_MISSING');
 results.push({command:'isolated real-mode startup, built page and PDF upload without a key',passed:true,paidCalls:0});
}finally{
 child.kill();if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));
 writeFileSync(path.join(target,'no-key-server.log'),logs);
}
const report={createdAt:new Date().toISOString(),directory:path.relative(root,target),files:manifest.files.length,results,paidCalls:0};
writeFileSync(path.join(base,'clean-install-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
