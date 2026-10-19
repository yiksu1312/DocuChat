import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) });
function integer(name, fallback, min, max) {
 const value = Number(process.env[name] || fallback);
 if (!Number.isInteger(value) || value < min || value > max) throw new Error('Invalid configuration: ' + name);
 return value;
}
const retrievalMode = process.env.RETRIEVAL_MODE || 'adjacent';
if (!['vector', 'adjacent'].includes(retrievalMode)) throw new Error('Invalid configuration: RETRIEVAL_MODE');
export const config = Object.freeze({
 dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : fileURLToPath(new URL(process.env.MOCK_AI === 'true' ? '../data/mock/' : '../data/openai/', import.meta.url)),
 apiKey: process.env.OPENAI_API_KEY || '',
 chatModel: process.env.CHAT_MODEL || 'gpt-4.1-mini',
 embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
 timeout: integer('MODEL_TIMEOUT_MS', 60000, 100, 120000),
 retries: integer('MODEL_MAX_RETRIES', 1, 0, 1),
 port: integer('PORT', 5001, 1024, 65535),
 mock: process.env.MOCK_AI === 'true',
 evidenceCheck: process.env.EVIDENCE_CHECK === 'true',
 retrievalMode,
});
