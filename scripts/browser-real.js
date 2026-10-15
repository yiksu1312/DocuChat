// Live browser checks must never touch the normal local user's database.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { config } from '../backend/config.js';
if (!process.argv.includes('--allow-paid')) { console.log('NOT RUN: requires --allow-paid; uses isolated ports 5003/5175 and a temporary database.'); process.exit(2); }
if (!config.apiKey || config.mock) { console.log('BLOCKED: real API key and MOCK_AI=false required.'); process.exit(2); }
const root = path.resolve('test-results/real-browser-data'); await mkdir(root, { recursive: true });
const dataDir = await mkdtemp(path.join(root, 'run-'));
const children = [
  spawn(process.execPath, ['backend/server.js'], { stdio: ['ignore','inherit','inherit','ipc'], env: { ...process.env, DATA_DIR: dataDir, PORT: '5003', MOCK_AI: 'false' } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'frontend', '--config', 'frontend/vite.config.js', '--port', '5175'], { stdio: 'inherit', env: { ...process.env, BACKEND_PORT: '5003' } }),
];
let browser;
try {
  const instanceId = await new Promise((resolve,reject) => {
    children[0].on('message',m=>{if(m.type==='ready')resolve(m.instanceId);});
    children[0].once('exit',()=>reject(new Error('Isolated backend failed to start; refusing other servers')));
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if(children.some(c=>c.exitCode!==null))throw new Error('Isolated service failed to start');
    try { const h=await (await fetch('http://127.0.0.1:5175/api/health')).json();ready=h.instanceId===instanceId; } catch {}
    if (ready) break;
    await new Promise(r => setTimeout(r, 200));
  }
  if (!ready) throw new Error('Isolated services did not start');
  browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5175/');
  await page.locator('input[type=file]').setInputFiles('fixtures/orchid.pdf');
  await expect(page.getByText('可用', { exact: true })).toBeVisible({ timeout: 60000 });
  await page.getByRole('textbox', { name: '文档问题' }).fill('What is the project launch code?');
  await page.getByRole('button', { name: '提问', exact: true }).click();
  await expect(page.getByText('含来源引用 · 请核对原文', { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.sources-panel blockquote')).toContainText('ORCHID-742');
  await page.reload();
  await expect(page.locator('.answer')).toContainText('ORCHID-742');
  console.log('Real browser plumbing passed. Answer faithfulness and citation support still require human review.');
} finally {
  await browser?.close();
  for (const child of children) child.kill();
  await Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(r => child.once('exit', r))));
  if (path.dirname(path.resolve(dataDir)) !== root) throw new Error('Unexpected test path');
  await rm(dataDir, { recursive: true, force: true, maxRetries: 3 });
}
