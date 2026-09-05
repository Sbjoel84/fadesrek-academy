'use strict';

const express = require('express');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('../lib/requirePermission');
const { parsePagination, meta } = require('../lib/pagination');

const router = express.Router();

// Read-only — AuditLog is append-only by design (see the schema comment),
// so there's no edit/delete route to write here even in principle.
router.get('/', requireSession, requirePermission('audit.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const where = {
      ...(req.query.actorId ? { actorId: req.query.actorId } : {}),
      ...(req.query.action ? { action: { contains: req.query.action } } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      prisma.auditLog.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

// Security oversight, school-wide — every signed-in session across every
// user, not just your own (that's GET /api/auth/sessions). Same login-
// history data, different audience.
router.get('/sessions', requireSession, requirePermission('audit.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const where = { ...(req.query.userId ? { userId: req.query.userId } : {}) };
    const [data, total] = await Promise.all([
      prisma.session.findMany({
        where, skip, take, orderBy: { createdAt: 'desc' },
        include: { user: { select: { username: true, displayName: true } } },
      }),
      prisma.session.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

module.exports = router;
