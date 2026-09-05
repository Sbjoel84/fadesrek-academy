'use strict';

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const prisma = require('../db/prisma');
const { COOKIE_NAME, createSession, revokeSession, requireSession } = require('./session');
const { CSRF_COOKIE_NAME } = require('../lib/requireCsrf');
const { notFound } = require('../lib/httpErrors');

const router = express.Router();

const cookieOpts = expiresAt => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: false, // local http-server dev only — flip to true behind HTTPS
  expires: expiresAt,
});

// The CSRF cookie is deliberately NOT httpOnly — the double-submit pattern
// (see server/lib/requireCsrf.js) requires the frontend's own JS to be able
// to read it and echo it back as a header.
const csrfCookieOpts = expiresAt => ({ ...cookieOpts(expiresAt), httpOnly: false });

// Brute-force mitigation on the one endpoint an attacker would actually
// hammer — the global limiter in index.js covers everything else.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_login_attempts' },
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username_and_password_required' });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || user.deletedAt || user.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    const { raw, expiresAt } = await createSession(user.id, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    const csrfToken = crypto.randomBytes(24).toString('hex');
    res.cookie(COOKIE_NAME, raw, cookieOpts(expiresAt));
    res.cookie(CSRF_COOKIE_NAME, csrfToken, csrfCookieOpts(expiresAt));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    await revokeSession(req.cookies?.[COOKIE_NAME]);
    res.clearCookie(COOKIE_NAME);
    res.clearCookie(CSRF_COOKIE_NAME);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireSession, (req, res) => {
  res.json({
    username: req.session.username,
    displayName: req.session.displayName,
    roleKey: req.session.roleKey,
    permissions: Array.from(req.session.permissions),
    staffId: req.session.staffId,
    studentId: req.session.studentId,
    guardianId: req.session.guardianId,
    homeroomClassId: req.session.homeroomClassId,
  });
});

// -------------------------------------------------------- login history --
// Self-service — "my devices/login history", not an admin tool (that's
// GET /api/audit/sessions, gated by audit.view). Ownership is implicit:
// this only ever queries the signed-in user's own rows.

router.get('/sessions', requireSession, async (req, res, next) => {
  try {
    const rows = await prisma.session.findMany({
      where: { userId: req.session.userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, ipAddress: true, userAgent: true, createdAt: true, expiresAt: true, revokedAt: true },
    });
    res.json({ data: rows.map(r => ({ ...r, current: r.id === req.session.sessionId })) });
  } catch (err) { next(err); }
});

router.delete('/sessions/:id', requireSession, async (req, res, next) => {
  try {
    const existing = await prisma.session.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.session.userId) throw notFound();
    await prisma.session.update({ where: { id: req.params.id }, data: { revokedAt: new Date() } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
