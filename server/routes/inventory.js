'use strict';

const express = require('express');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('../lib/requirePermission');
const { forCreate } = require('../lib/stamps');
const { toDate } = require('../lib/dates');
const { parsePagination, meta } = require('../lib/pagination');
const { notFound, badRequest, conflict } = require('../lib/httpErrors');
const { mountSimpleCrud } = require('../lib/simpleCrud');

const router = express.Router();

// `quantity` deliberately isn't in this whitelist — it only ever moves via
// a StockMovement, below, never a direct edit.
mountSimpleCrud(router, '/items', {
  model: 'inventoryItem',
  module: 'inventory',
  fields: ['name', 'unit', 'reorderLevel', 'unitCostKobo', 'category'],
  searchFields: ['name', 'category'],
});

router.get('/movements', requireSession, requirePermission('inventory.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const where = { deletedAt: null, ...(req.query.itemId ? { itemId: req.query.itemId } : {}) };
    const [data, total] = await Promise.all([
      prisma.stockMovement.findMany({ where, skip, take, orderBy: { movedOn: 'desc' } }),
      prisma.stockMovement.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

/** Append-only, per the schema comment — a correction is a compensating
 * movement, never an edit. Always adjusts InventoryItem.quantity in the
 * same transaction it records, so the running balance never drifts from
 * its history. */
router.post('/movements', requireSession, requirePermission('inventory.create'), async (req, res, next) => {
  try {
    const { itemId, kind, quantity, reference, movedOn } = req.body || {};
    if (!itemId || !['RECEIPT', 'ISSUE'].includes(kind) || !quantity || quantity <= 0) {
      throw badRequest('itemId_kind_positive_quantity_required');
    }

    const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item || item.deletedAt) throw notFound();
    const delta = kind === 'RECEIPT' ? quantity : -quantity;
    if (item.quantity + delta < 0) throw conflict('insufficient_stock');

    const result = await prisma.$transaction(async tx => {
      const movement = await tx.stockMovement.create({
        data: { itemId, kind, quantity, reference, movedOn: toDate(movedOn) || new Date(), ...forCreate(req.session) },
      });
      await tx.inventoryItem.update({ where: { id: itemId }, data: { quantity: { increment: delta } } });
      return movement;
    });

    res.status(201).json(result);
  } catch (err) { next(err); }
});

module.exports = router;
