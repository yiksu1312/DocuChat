# Contributing to DocuChat

Use Node.js 24.x and install with `npm ci`. For everyday development, start in mock mode using the README instructions and fictional fixtures. Do not commit credentials, real documents, databases, logs, or generated build outputs.

Before submitting a change, run `npm test`, `npm run check`, and `npm run build`. Run `npm run test:browser` for interface changes and `npm run eval:offline` for retrieval changes. Explain what changed, why, and how it was verified. Add focused regression coverage for behavioral fixes.

Keep English and Chinese resources synchronized. Backend errors use stable codes; do not display raw provider errors. Preserve cancellation, document-scope isolation, and source-deletion behavior. Use parameterized database queries and keep model credentials on the backend.

Paid provider calls require a deliberate `--allow-paid` invocation and your own credential. Never make them a prerequisite for routine tests.

Report defects through GitHub Issues with reproduction steps and redacted diagnostics. Report sensitive findings using the process in SECURITY.md. Contributions must be material you have permission to distribute under the project license; retain required third-party notices.
