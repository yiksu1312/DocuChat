import {createHash} from 'node:crypto';

// A Git checkout may normalize mixed Windows/Unix newlines. Preserve every
// other character so source and prompt changes still invalidate the baseline.
export function assertFrozenInput(file,text,expectedHash) {
  const hash=createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');
  if(hash!==expectedHash)throw new Error('FROZEN_INPUT_CHANGED: '+file);
}
