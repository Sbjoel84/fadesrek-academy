'use strict';

const express = require('express');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { parsePagination, meta } = require('../lib/pagination');
const { notFound } = require('../lib/httpErrors');

const router = express.Router();

// Not one of the 22 RBAC modules — addressed to whichever role the signed-in
// session holds (or broadcast, roleId: null), same model the AI gateway
// already writes to (server/notifications/notify.js). Session-gated only.

router.get('/', requireSession, async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const role = await prisma.role.findUnique({ where: { key: req.session.roleKey } });
    const where = {
      deletedAt: null,
      OR: [{ roleId: role?.id ?? null }, { roleId: null }],
      ...(req.query.unread === 'true' ? { read: false } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.notification.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      prisma.notification.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

router.patch('/:id/read', requireSession, async (req, res, next) => {
  try {
    const existing = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const row = await prisma.notification.update({
      where: { id: req.params.id },
      data: { read: true, updatedById: req.session.userId, version: { increment: 1 } },
    });
    res.json(row);
  } catch (err) { next(err); }
});

module.exports = router;
