# Validation

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

No paid model calls were made. Real-model language adherence, semantic retrieval quality, answer correctness, refusal behavior, load testing, and a full security audit are outside the verified results. No test run proves that software has no defects.

Public screenshots use fictional documents in clearly labeled mock mode. Release artifacts exclude credentials, user data, local logs, and old diagnostic results. Pattern-based privacy scans have limitations and must not be treated as a guarantee.
