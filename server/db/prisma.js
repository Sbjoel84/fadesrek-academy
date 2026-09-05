const { PrismaClient } = require('@prisma/client');

// Money columns (*Kobo) are BigInt — JSON.stringify throws on those by
// default. Every route in the app returns Prisma rows straight to
// res.json(), so this has to be global, and this module is the first thing
// every one of them requires. Kobo amounts serialize as numeric strings.
BigInt.prototype.toJSON = function () { // eslint-disable-line no-extend-native
  return this.toString();
};

// One client for the process. Prisma pools connections internally, so
// creating a fresh client per request (or per hot-reload) exhausts the
// Postgres connection limit — a singleton is the documented pattern.
const prisma = new PrismaClient();

module.exports = prisma;
