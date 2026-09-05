'use strict';

const prisma = require('../../db/prisma');
const { lowInventoryRecommendations } = require('../recommendations');

module.exports = {
  description: "Lists inventory items at or below their reorder level. Use for 'which inventory items are low' / 'what needs restocking'.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  requiredPermission: 'inventory.view',

  async run() {
    // Prisma can't compare two columns of the same row in a `where` clause
    // without raw SQL, and this dataset is small (a school's inventory
    // catalogue, not a warehouse) — fetch active items and filter in JS.
    const items = await prisma.inventoryItem.findMany({ where: { deletedAt: null, status: 'ACTIVE' } });
    const low = items
      .filter(i => i.quantity <= i.reorderLevel)
      .sort((a, b) => (a.reorderLevel - a.quantity) < (b.reorderLevel - b.quantity) ? 1 : -1)
      .map(i => ({
        name: i.name,
        category: i.category,
        quantity: i.quantity,
        reorderLevel: i.reorderLevel,
        unit: i.unit,
      }));

    return {
      lowItemCount: low.length,
      items: low,
      recommendations: lowInventoryRecommendations(low),
    };
  },
};
