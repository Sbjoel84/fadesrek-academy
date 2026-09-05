'use strict';

// Double-submit cookie CSRF protection — no library, no server-side storage.
// Login (server/auth/routes.js) sets a second, non-httpOnly `csrf` cookie
// alongside the session cookie. A same-origin page can read that cookie
// (via JS) and echo it back as the X-CSRF-Token header; a forged cross-site
// request can make the browser *send* the cookie automatically, but has no
// way to *read* it to also set the header, since cookies from another
// origin aren't readable by that origin's JS. Matching header+cookie is
// exactly what proves the request came from code running on this app's own
// origin.

const CSRF_COOKIE_NAME = 'csrf';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Pre-session and intentionally-public write endpoints — there's no session
// cookie yet (login) or no session at all by design (public intake forms),
// so there's nothing for a forged request to ride along on.
const EXEMPT_PREFIXES = ['/api/auth/login', '/api/admissions/public', '/api/website/public'];

function requireCsrf(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) return next();
  if (EXEMPT_PREFIXES.some(p => req.path.startsWith(p))) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.get('X-CSRF-Token');
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'csrf_token_invalid' });
  }
  next();
}

module.exports = { requireCsrf, CSRF_COOKIE_NAME };
