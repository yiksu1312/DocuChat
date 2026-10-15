# Release preparation

The release manifest at `docs/release-files.json` lists the source files and fictional demo assets needed for a clean installation. It excludes real environment files, user PDFs, databases, logs, dependencies, build outputs, and local diagnostic reports.

Run the following checks before release:

```bash
npm test
npm run check
npm run build
npm run test:browser
npm run eval:offline
npm audit
node scripts/clean-install.js
node scripts/publication-audit.js
```

The publication audit checks tracked files and reachable Git history. It reports locations only, never matched credentials. Pattern scanning cannot prove that all sensitive information is absent. Inspect the final staged diff, screenshots, PDF metadata, Git identities, and release manifest before pushing.

Do not add local archives or old diagnostic reports to the source tree. Use synthetic fixtures for screenshots and regression tests. Keep real-model quality claims separate from offline engineering checks. See VALIDATION.md for the current verification record.
