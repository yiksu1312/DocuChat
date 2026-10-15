import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+entry.name;if(entry.isDirectory()&&entry.name!=='node_modules')await walk(p);else if(entry.isFile()&&p.endsWith('.js')){const r=spawnSync(process.execPath,['--check',p],{encoding:'utf8'});if(r.status){console.error(r.stderr);process.exitCode=1;}}}}
for(const dir of ['backend','scripts','tests'])await walk(dir);
if(!process.exitCode)console.log('JavaScript syntax checks passed; JSX is checked by npm run build.');
