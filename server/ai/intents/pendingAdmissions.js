'use strict';

const prisma = require('../../db/prisma');

const FINAL_STAGES = ['ENROLLED', 'REJECTED'];

module.exports = {
  description: "Counts admission applications still in progress (not yet enrolled or rejected), broken down by stage. Use for 'how many admission applications are pending'.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  requiredPermission: 'admissions.view',

  async run() {
    const grouped = await prisma.application.groupBy({
      by: ['stage'],
      where: { deletedAt: null, stage: { notIn: FINAL_STAGES } },
      _count: { _all: true },
    });

    const byStage = Object.fromEntries(grouped.map(g => [g.stage, g._count._all]));
    const totalPending = grouped.reduce((sum, g) => sum + g._count._all, 0);

    return { totalPending, byStage };
  },
};
