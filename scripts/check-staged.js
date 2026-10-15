import {execFileSync} from 'node:child_process';
import {config} from '../backend/config.js';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:8*1024*1024});
const files=git('diff','--cached','--name-only','--diff-filter=ACMR','-z').split('\0').filter(Boolean);
for(const file of files){
 if(/(^|\/)(node_modules|uploads|data|dist|test-results|results)(\/|$)/.test(file)||(/(^|\/)\.env(?:\.|$)/.test(file)&&!file.endsWith('.env.example')))throw new Error('Unsafe staged path: '+file);
 const content=git('show',':'+file);
 if((config.apiKey&&content.includes(config.apiKey))||/sk-[A-Za-z0-9_-]{20,}/.test(content))throw new Error('Possible secret in staged file: '+file);
}
console.log('Staged safety scan passed: '+files.length+' files; no keys or excluded data detected.');
