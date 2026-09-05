'use strict';

const express = require('express');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('../lib/requirePermission');
const { forUpdate } = require('../lib/stamps');
const { badRequest, notFound } = require('../lib/httpErrors');
const { mountSimpleCrud } = require('../lib/simpleCrud');

const router = express.Router();

// ------------------------------------------------------------- public reads --
// The school website's content has to be readable with no session, and its
// contact form has to be writable by a visitor who was never logged in.

router.get('/public/pages/:slug', async (req, res, next) => {
  try {
    const row = await prisma.page.findUnique({ where: { slug: req.params.slug } });
    if (!row || row.deletedAt) throw notFound();
    res.json(row);
  } catch (err) { next(err); }
});

router.get('/public/posts', async (req, res, next) => {
  try {
    const rows = await prisma.post.findMany({ where: { deletedAt: null, postStatus: 'PUBLISHED' }, orderBy: { publishedAt: 'desc' } });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.get('/public/events', async (req, res, next) => {
  try {
    const rows = await prisma.event.findMany({ where: { deletedAt: null, published: true }, orderBy: { eventDate: 'asc' } });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.get('/public/gallery', async (req, res, next) => {
  try {
    const rows = await prisma.galleryAlbum.findMany({ where: { deletedAt: null }, include: { images: { include: { fileAsset: true }, orderBy: { sequence: 'asc' } } } });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/public/enquiries', async (req, res, next) => {
  try {
    const { name, email, phone, message } = req.body || {};
    if (!name || !message) throw badRequest('name_and_message_required');
    const row = await prisma.enquiry.create({ data: { name, email, phone, message, status: 'ACTIVE' } });
    res.status(201).json({ id: row.id });
  } catch (err) { next(err); }
});

// -------------------------------------------------------------- admin CRUD --

mountSimpleCrud(router, '/pages', { model: 'page', module: 'website', fields: ['slug', 'title', 'content'], searchFields: ['title', 'slug'] });
mountSimpleCrud(router, '/posts', { model: 'post', module: 'website', fields: ['title', 'body', 'postStatus', 'publishedAt'], dateFields: ['publishedAt'], searchFields: ['title'] });
mountSimpleCrud(router, '/events', { model: 'event', module: 'website', fields: ['title', 'eventDate', 'published'], dateFields: ['eventDate'], searchFields: ['title'] });
mountSimpleCrud(router, '/gallery-albums', { model: 'galleryAlbum', module: 'website', fields: ['title'], searchFields: ['title'] });

router.post('/gallery-albums/:albumId/images', requireSession, requirePermission('website.edit'), async (req, res, next) => {
  try {
    const { fileAssetId, caption, sequence } = req.body || {};
    if (!fileAssetId) throw badRequest('fileAssetId_required');
    const row = await prisma.galleryImage.create({ data: { albumId: req.params.albumId, fileAssetId, caption, sequence: sequence ?? 0 } });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.delete('/gallery-images/:id', requireSession, requirePermission('website.edit'), async (req, res, next) => {
  try {
    await prisma.galleryImage.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2025') return next(notFound());
    next(err);
  }
});

router.get('/enquiries', requireSession, requirePermission('website.view'), async (req, res, next) => {
  try {
    const where = { deletedAt: null, ...(req.query.handled !== undefined ? { handled: req.query.handled === 'true' } : {}) };
    const rows = await prisma.enquiry.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.patch('/enquiries/:id/handle', requireSession, requirePermission('website.edit'), async (req, res, next) => {
  try {
    const existing = await prisma.enquiry.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const row = await prisma.enquiry.update({
      where: { id: req.params.id },
      data: { handled: true, ...forUpdate(req.session), version: { increment: 1 } },
    });
    res.json(row);
  } catch (err) { next(err); }
});

module.exports = router;
