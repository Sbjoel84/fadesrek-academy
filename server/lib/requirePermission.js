'use strict';

const { assertPermission } = require('../rbac/permissionEngine');

/** Express middleware wrapping the existing assertPermission — must run
 * after requireSession, since it reads req.session. Thrown PermissionErrors
 * flow to the centralised handler in index.js exactly like the AI gateway's
 * already do. */
function requirePermission(key) {
  return (req, res, next) => {
    try {
      assertPermission(req.session, key);
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requirePermission };
