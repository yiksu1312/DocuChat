# Upgrade notes

Back up the complete data directory with the backend stopped before changing versions. See STORAGE.md for the cold-backup procedure.

DocuChat uses a versioned SQLite schema. Unsupported schema versions are rejected rather than silently migrated. Do not manually change the database version to bypass this check.

Changing the embedding model, provider mode, or split configuration makes existing indexes incompatible. Reindex explicitly or restore the matching configuration. Real-mode reindexing can incur API charges. Keep real and mock data in separate directories.

This revision adds local Host / Origin validation and updates vulnerable transitive dependencies. API clients must connect through a loopback hostname. The development UI uses port 5173; browser tests use 5174. Public proxying is not supported.
