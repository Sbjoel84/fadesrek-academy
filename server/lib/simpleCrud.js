'use strict';

const express = require('express');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('./requirePermission');
const { pick } = require('./pick');
const { coerceDates } = require('./dates');
const { forCreate, forUpdate, forDelete, forRestore } = require('./stamps');
const { parsePagination, searchClause, meta } = require('./pagination');
const { checkVersion } = require('./version');
const { notFound } = require('./httpErrors');
const { writeAuditEntry } = require('../audit/auditLog');

/** Mounts list/get/create/update/soft-delete/restore at `path` on
 * `parentRouter`, for models that carry the standard audit block
 * (id/createdAt/updatedAt/deletedAt/*ById/status/version) and have no
 * workflow beyond plain CRUD — reference and content tables (SchoolClass,
 * Subject, Notice, Page, ...). Anything with real business logic (Invoice,
 * AttendanceRegister, PayrollRun, ...) gets hand-written routes instead;
 * see the plan for which is which.
 *
 * options:
 *   model        Prisma client accessor, e.g. 'schoolClass'
 *   module       RBAC module key, e.g. 'settings' — permissions are
 *                `${module}.view|create|edit|delete|restore`
 *   fields       whitelist of body fields accepted on create/update
 *   searchFields optional string fields `?q=` searches (default: none)
 *   orderBy      default sort (default: createdAt desc)
 *   include      optional Prisma `include` applied to every read
 *   where        optional (req) => extra Prisma `where` fragment, merged
 *                into list queries — e.g. filtering by ?classId=
 *   dateFields   optional subset of `fields` that are DateTime/@db.Date
 *                columns — coerced from whatever string a client sends
 *                into an actual Date before Prisma ever sees them.
 *   validateCreate  optional (body) => void, throws to reject — for the
 *                   rare mount that needs a sanity check beyond "is this
 *                   field present" (e.g. FileAsset's mime-type/size check).
 */
function mountSimpleCrud(parentRouter, path, options) {
  const { model, module, fields, searchFields = [], orderBy = { createdAt: 'desc' }, include, where: extraWhere, dateFields = [], validateCreate } = options;
  const db = prisma[model];
  const body = req => coerceDates(pick(req.body, fields), dateFields);
  const router = express.Router();

  router.get('/', requireSession, requirePermission(`${module}.view`), async (req, res, next) => {
    try {
      const { page, pageSize, skip, take } = parsePagination(req.query);
      const where = {
        deletedAt: req.query.includeDeleted ? undefined : null,
        ...searchClause(req.query.q, searchFields),
        ...(extraWhere ? extraWhere(req) : {}),
      };
      const [data, total] = await Promise.all([
        db.findMany({ where, skip, take, orderBy, ...(include ? { include } : {}) }),
        db.count({ where }),
      ]);
      res.json({ data, meta: meta(page, pageSize, total) });
    } catch (err) { next(err); }
  });

  router.get('/:id', requireSession, requirePermission(`${module}.view`), async (req, res, next) => {
    try {
      const row = await db.findUnique({ where: { id: req.params.id }, ...(include ? { include } : {}) });
      if (!row || row.deletedAt) throw notFound();
      res.json(row);
    } catch (err) { next(err); }
  });

  router.post('/', requireSession, requirePermission(`${module}.create`), async (req, res, next) => {
    try {
      const data = body(req);
      if (validateCreate) validateCreate(data);
      const row = await db.create({ data: { ...data, ...forCreate(req.session) } });
      await writeAuditEntry({ session: req.session, action: `${module}.${model}.created`, detail: { id: row.id } });
      res.status(201).json(row);
    } catch (err) { next(err); }
  });

  router.patch('/:id', requireSession, requirePermission(`${module}.edit`), async (req, res, next) => {
    try {
      const existing = await db.findUnique({ where: { id: req.params.id } });
      if (!existing || existing.deletedAt) throw notFound();
      checkVersion(existing, req.body);
      const row = await db.update({
        where: { id: req.params.id },
        data: { ...body(req), ...forUpdate(req.session), version: { increment: 1 } },
      });
      await writeAuditEntry({ session: req.session, action: `${module}.${model}.updated`, detail: { id: row.id } });
      res.json(row);
    } catch (err) { next(err); }
  });

  router.delete('/:id', requireSession, requirePermission(`${module}.delete`), async (req, res, next) => {
    try {
      const existing = await db.findUnique({ where: { id: req.params.id } });
      if (!existing || existing.deletedAt) throw notFound();
      const row = await db.update({ where: { id: req.params.id }, data: forDelete(req.session) });
      await writeAuditEntry({ session: req.session, action: `${module}.${model}.deleted`, detail: { id: row.id } });
      res.json(row);
    } catch (err) { next(err); }
  });

  router.post('/:id/restore', requireSession, requirePermission(`${module}.restore`), async (req, res, next) => {
    try {
      const existing = await db.findUnique({ where: { id: req.params.id } });
      if (!existing || !existing.deletedAt) throw notFound();
      const row = await db.update({ where: { id: req.params.id }, data: forRestore(req.session) });
      await writeAuditEntry({ session: req.session, action: `${module}.${model}.restored`, detail: { id: row.id } });
      res.json(row);
    } catch (err) { next(err); }
  });

  parentRouter.use(path, router);
}

module.exports = { mountSimpleCrud };
