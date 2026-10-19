export function logEvent(event) {
  const keys = ['event', 'requestId', 'documentId', 'documentIds', 'sessionId', 'mode', 'model', 'embeddingModel',
    'durationMs', 'firstTokenMs', 'parseMs', 'embeddingMs', 'retrievalMs', 'inputTokens', 'outputTokens',
    'embeddingTokens', 'cachedInputTokens', 'evidenceCheckMs', 'evidenceCheckUsage', 'retrievedIds', 'citationCount', 'code', 'cancelled'];
  const safe = { timestamp: new Date().toISOString() };
  for (const key of keys) if (event[key] !== undefined) safe[key] = event[key];
  console.log(JSON.stringify(safe));
}
