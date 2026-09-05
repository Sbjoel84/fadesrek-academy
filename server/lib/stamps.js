'use strict';

// The audit-block columns (createdById/updatedById/deletedById/status)
// every primary business table carries — see the schema header. These
// centralise how each mutation stamps them so every route does it the
// same way.

const forCreate = session => ({ createdById: session.userId, status: 'ACTIVE' });
const forUpdate = session => ({ updatedById: session.userId });
const forDelete = session => ({ deletedAt: new Date(), deletedById: session.userId, status: 'ARCHIVED' });
const forRestore = session => ({ deletedAt: null, deletedById: null, status: 'ACTIVE', updatedById: session.userId });

module.exports = { forCreate, forUpdate, forDelete, forRestore };
