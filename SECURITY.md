# Security

DocuChat is a local, single-user application, not a hosted multi-user service. It binds to loopback and checks Host / Origin headers, but has no authentication. Local processes and other users with filesystem access remain inside the trust boundary. Do not expose the server through a tunnel or public reverse proxy.

PDFs, extracted text, vectors, and conversations are stored unencrypted. In real mode, text needed for embeddings and answers is sent to OpenAI. Keep secrets in the backend process environment or an ignored backend/.env file; never in frontend variables.

Model output is untrusted. Citation checks verify identifiers and literal quotes, not semantic correctness. Prompt injection and unsupported claims remain possible; verify important answers against source documents.

## Reporting

Use the repository Security tab's private vulnerability reporting option if available. If it is unavailable, open an issue asking for a private contact channel without including exploit details, secrets, or personal documents. Do not paste a real API key into an issue or pull request.

Security fixes target the current main branch. No response-time guarantee is offered. Rotate any exposed credential immediately; deleting a file does not invalidate an exposed key.
