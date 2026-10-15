# Evaluation results

The 27 reproducible cases in cases.json use fictional materials from materials.json. Run `npm run eval:offline` to regenerate the local report.

- All 27 offline requests completed with HTTP 200 in the current review.
- Q25 missed its expected source anchor (0/1). This is a known limitation of the deterministic mock embeddings, not a measurement of OpenAI embedding quality.
- Model reasoning, answer faithfulness, semantic citation support, and refusal quality require real-provider evaluation and human review.
- No paid calls were made during this review. No accuracy, latency, or cost benchmark is claimed.

The evaluation script records evidence-anchor presence separately from semantic review. HTTP success is not an accuracy score. See RETRIEVAL-ANALYSIS.md for retrieval diagnostics.
