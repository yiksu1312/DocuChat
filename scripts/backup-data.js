import { existsSync, mkdirSync, readdirSync, lstatSync, copyFileSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from '../backend/config.js';
const source = path.resolve(config.dataDir);
if (!existsSync(path.join(source, 'docuchat.sqlite'))) throw new Error('No local database at configured DATA_DIR');
const lock = path.join(source, 'store.lock');
if (existsSync(lock)) {
  const owner = JSON.parse(readFileSync(lock, 'utf8'));
  if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error('Invalid data lock');
  try { process.kill(owner.pid, 0); throw new Error('Stop the backend before backing up this data directory'); }
  catch (e) { if (e.code !== 'ESRCH') throw e; }
  unlinkSync(lock);
}
const fd = openSync(lock, 'wx'); writeFileSync(fd, JSON.stringify({ pid: process.pid }));
try {
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw new Error('--output requires a new directory path');
  const destination = path.resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : path.join('data-backups', new Date().toISOString().replace(/[:.]/g, '-')));
  if (destination === source || destination.startsWith(source + path.sep)) throw new Error('Backup destination must be outside DATA_DIR');
  mkdirSync(path.dirname(destination), { recursive: true }); mkdirSync(destination);
  const manifest = [];
  function copy(directory, relative = '') {
    for (const name of readdirSync(directory)) {
      if (!relative && name === 'store.lock') continue;
      const rel = path.join(relative, name), from = path.join(directory, name), to = path.join(destination, rel);
      const info = lstatSync(from);
      if (info.isSymbolicLink()) throw new Error('External links are not followed: ' + rel);
      if (info.isDirectory()) { mkdirSync(to); copy(from, rel); }
      else {
        copyFileSync(from, to);
        const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
        const sha256 = hash(from);
        if (sha256 !== hash(to)) throw new Error('Backup verification failed: ' + rel);
        manifest.push({ path: rel, bytes: info.size, sha256 });
      }
    }
  }
  copy(source);
  writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({ source, schemaVersion: 1, files: manifest }, null, 2));
  console.log('Verified local backup: ' + destination + ' (' + manifest.length + ' files). No source data removed.');
} finally { closeSync(fd); unlinkSync(lock); }
