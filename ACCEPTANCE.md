# Five-minute walkthrough

1. Install Node.js 24.x and run `npm ci` in the project root.
2. Start the offline demo using the README command for your shell.
3. Open http://127.0.0.1:5173 and confirm the mock-mode label.
4. Upload fixtures/orchid.pdf and wait until it is available.
5. Create a session and ask “What is the launch code?” The demo excerpt contains ORCHID-742.
6. Open a source reference and inspect the physical PDF page.
7. Switch between English and Chinese. The session, selected scope, and draft should remain intact.
8. Upload fixtures/cedar.pdf, change the selection, and ask again to exercise document isolation.
9. Restart the backend with the same data directory. Documents and saved conversations should return.

The mock provider returns retrieved text; this walkthrough does not assess model reasoning. Real evaluation requires a configured key, deliberate paid-call opt-in, and human review. See VALIDATION.md.
