# Validation

## Adjacent-page retrieval — 2026-10-18

One retrieval mechanism adds bounded neighboring-page chunks while preserving the original hits. The same frozen 28 cases were rerun with fresh paired requests and evidence checks disabled in both arms. Text-answer correctness rose from 23/27 to 25/27; all-case task pass rose from 23/28 to 25/28. Both known missing-page failures were recovered; no correctness regressions appeared in this single run. Mean time was 1.377s → 1.358s, P95 1.651s → 1.881s, question cost $0.0091461 → $0.0090129. Total actual API usage was estimated at $0.01817594 including both arms and shared indexing. These are assistant-reviewed synthetic results, not independent human validation or a general speed/cost improvement claim. See [the controlled report](RETRIEVAL_EVALUATION.md).

55 automated tests, 5 browser workflows, syntax, production build, the original offline suite and both 28-case offline evaluation harnesses passed. Four retrieval tests cover preserved source IDs, missing pages, same-document scope, one-hop expansion, per-page selection and the 40-chunk cap. Two additional tests protect frozen inputs while allowing Git newline normalization; this fixes a mixed-newline hash mismatch found on the first Linux CI run. No generation prompt, parser, citation-validation change or paid-output rewrite was made.

## Evidence evaluation — 2026-10-18

Added one optional post-generation evidence gate, off by default. 49 automated tests and 5 browser workflows pass; syntax, production build and the 28-case offline harness pass. A real paid paired run used 27 text questions plus one parser boundary case. Content correctness remained 22/27, average completion time increased from 1.34s to 2.29s, and total estimated API spend was $0.01660064. The report preserves failures, per-call usage and assistant-reviewed labels; it is not independent human validation. See [the evaluation report](EVIDENCE_EVALUATION.md).

## Publication checks — 2026-10-14

Review date: 2026-10-14 (America/Los_Angeles). Runtime: Node.js 24.12.0 / npm 11.6.2 on Windows.

| Check | Result | Scope |
| --- | --- | --- |
| Unit and integration tests | 40 passed | PDF parsing, scoped retrieval, persistence, cancellation, backup, recovery, local-origin security, missing-PDF recovery, bilingual errors |
| JavaScript syntax | Passed | Source syntax; not a TypeScript typecheck |
| Production build | Passed | Vite / JSX / module bundling |
| Browser workflows | 5 passed in Microsoft Edge | Uploads, references, cancellation, persistence, language switching, unsafe Markdown, narrow layout |
| Offline evaluation | 27 requests completed | Q25 misses its expected anchor; mock results do not measure model quality |
| Dependency audit | 0 known vulnerabilities after updates | npm registry advisory snapshot at review time |
| Clean install | Passed | Manifest-only installation, tests, build, no-key startup and upload failure |

Updated shell-quote and source-map-js within the existing dependency constraints to resolve the reported critical and high advisories. Added Host / Origin validation before parsing or API handlers, no-store API headers, and an explicit recovery error for missing PDFs during reindexing.

Known nonblocking warnings: Node's experimental SQLite API; Ant Design use-client directives ignored by Vite; the main JS bundle exceeds Vite's 500 kB advisory threshold. The installation reports deprecated transitive jpeg-exif and crypto-js packages. These remain maintenance items.

No paid model calls were made in the October 14 publication checks. Real-model quality was not measured in those checks; the separate October 18 study above provides a small synthetic evaluation. Load testing and a full security audit remain outside the verified results. No test run proves that software has no defects.

Public screenshots use fictional documents in clearly labeled mock mode. Release artifacts exclude credentials, user data, local logs, and old diagnostic results. Pattern-based privacy scans have limitations and must not be treated as a guarantee.
