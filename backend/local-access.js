const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);

// Binding to loopback alone does not prevent browser requests or DNS rebinding.
// CLI clients may omit Origin; browser origins must belong to our local UI.
export function localAccess(req, res, next) {
  const reject = () => res.status(403).json({ error: {
    code: 'LOCAL_ACCESS_ONLY', message: 'Use DocuChat from its local browser address.',
  } });
  const host = req.headers.host;
  if (!host || !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i.test(host)) return reject();
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try {
      const url = new URL(origin);
      const sameOrigin = url.origin === `http://${host.toLowerCase()}`;
      const devOrigin = loopback.has(url.hostname) && ['5173', '5174'].includes(url.port);
      if (url.protocol !== 'http:' || origin !== url.origin || (!sameOrigin && !devOrigin)) return reject();
    } catch { return reject(); }
  } else if (req.headers['sec-fetch-site'] === 'cross-site') {
    return reject();
  }
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
  next();
}
