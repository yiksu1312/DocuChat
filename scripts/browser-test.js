import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const child=spawn(process.execPath,['node_modules/@playwright/test/cli.js','test'],{cwd:root,stdio:'inherit'});
process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1));});
