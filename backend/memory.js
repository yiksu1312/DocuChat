import { AppError } from './errors.js';
function cosine(a, b) {
  if (!Array.isArray(b) || a.length !== b.length || b.some(n => !Number.isFinite(n))) {
    throw new AppError(409, 'INDEX_CONFIG_CHANGED', '向量维度不兼容，请重新索引。');
  }
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
export function makeIndex(chunks, vectors, embeddingModel) {
  if (!chunks.length || chunks.length !== vectors.length || vectors.some(v => !Array.isArray(v) || !v.length ||
      v.some(n => !Number.isFinite(n)) || v.length !== vectors[0].length)) {
    throw new AppError(502, 'EMBEDDING_INVALID', '向量服务返回了无效数据。');
  }
  return { chunks, vectors, embeddingModel };
}
function ranked(index, query, model) {
  if (index.embeddingModel !== model) throw new AppError(409, 'INDEX_CONFIG_CHANGED', '向量模型已变化，请重新索引。');
  return index.chunks.map((chunk, i) => ({ chunk, score: cosine(index.vectors[i], query) })).sort((a, b) => b.score - a.score);
}
export function retrieve(index, query, model, k = 5) {
  return ranked(index, query, model).slice(0, k).map(({ chunk }, i) => ({ ...chunk, id: 'S' + (i + 1) }));
}
export function retrieveMany(indexes, query, model, mode = 'adjacent') {
  const groups = indexes.map(index => ranked(index, query, model));
  // Reserve one vector-ranked candidate per selected document to expose potential conflicts.
  const selected = groups.flatMap(group => group.slice(0, 1));
  const seen = new Set(selected.map(({ chunk }) => chunk.chunkId));
  for (const candidate of groups.flat().sort((a, b) => b.score - a.score)) {
    if (selected.length >= Math.max(8, indexes.length * 2)) break;
    if (!seen.has(candidate.chunk.chunkId)) { selected.push(candidate); seen.add(candidate.chunk.chunkId); }
  }
  if (mode === 'adjacent') {
    // Keep every original hit. Only the two strongest ORIGINAL hits may expand;
    // neighbors never seed another hop. Page metadata comes from the local index.
    const seeds = [...selected].sort((a, b) => b.score - a.score).slice(0, 2);
    const limit = Math.min(40, selected.length + 4);
    for (const { chunk } of seeds) {
      const group = groups.find(g => g.some(c => c.chunk.chunkId === chunk.chunkId));
      for (const page of [chunk.page - 1, chunk.page + 1]) {
        if (selected.length >= limit) break;
        // On a long adjacent page, select its best query-ranked chunk, not the whole page.
        const neighbor = group.find(c => c.chunk.documentId === chunk.documentId && c.chunk.page === page);
        if (neighbor && !seen.has(neighbor.chunk.chunkId)) {
          selected.push(neighbor); seen.add(neighbor.chunk.chunkId);
        }
      }
    }
  }
  return selected.map(({ chunk }, i) => ({ ...chunk, id: 'S' + (i + 1) }));
}
