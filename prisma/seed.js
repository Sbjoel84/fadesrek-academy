'use strict';

// Seeds enough real, checkable data for the AI layer's 9 intents to answer
// against — roles/permissions/users first (everything else depends on
// those), then a modest operational dataset (dozens of rows, not hundreds).
// Dates for "the current term" are computed relative to whenever this
// script actually runs, so `npm run db:seed` produces a working "today" no
// matter when it's executed.

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { PERMISSIONS, ROLES, GRANTS } = require('../server/rbac/catalogue');

const prisma = new PrismaClient();

const nairaToKobo = naira => BigInt(Math.round(naira * 100));

const now = new Date();
const dayOffset = n => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + n));

// ---------------------------------------------------------------- demo users --
// Same usernames/roles as the front-end mock login (script.js AUTH_USERS) so
// the assistant panel's lazy silent-login can reuse them unchanged. Display
// names match script.js's ROLES table for continuity with the existing demo.
const DEMO_USERS = [
  ['superadmin@fadesrek.edu.ng', 'SUPER_ADMIN', 'Ikenna Obi'],
  ['proprietor@fadesrek.edu.ng', 'PROPRIETOR', 'Folake Adeyemi'],
  ['principal@fadesrek.edu.ng', 'PRINCIPAL', 'Grace Adeyemi'],
  ['viceprincipal@fadesrek.edu.ng', 'VICE_PRINCIPAL', 'Ahmed Suleiman'],
  ['coordinator@fadesrek.edu.ng', 'ACADEMIC_COORDINATOR', 'Chiamaka Nwachukwu'],
  ['bursar@fadesrek.edu.ng', 'BURSAR', 'Emeka Okafor'],
  ['secretary@fadesrek.edu.ng', 'SECRETARY', 'Blessing Yakubu'],
  ['registrar@fadesrek.edu.ng', 'REGISTRAR', 'Tunde Salami'],
  ['ictadmin@fadesrek.edu.ng', 'ICT_ADMIN', 'Yusuf Garba'],
  ['teacher@fadesrek.edu.ng', 'TEACHER', 'Ngozi Okonkwo'],
  ['classteacher@fadesrek.edu.ng', 'CLASS_TEACHER', 'Halima Bello'],
  ['subjectteacher@fadesrek.edu.ng', 'SUBJECT_TEACHER', 'Segun Aliyu'],
  ['librarian@fadesrek.edu.ng', 'LIBRARIAN', 'Fatima Lawal'],
  ['transport@fadesrek.edu.ng', 'TRANSPORT_OFFICER', 'Musa Danjuma'],
  ['hosteladmin@fadesrek.edu.ng', 'HOSTEL_ADMIN', 'Kemi Ojo'],
  ['storekeeper@fadesrek.edu.ng', 'STORE_KEEPER', 'Chukwudi Abubakar'],
  ['inventory@fadesrek.edu.ng', 'INVENTORY_OFFICER', 'Amina Olawale'],
  ['hrmanager@fadesrek.edu.ng', 'HR_MANAGER', 'Uche Ogunleye'],
  ['parent@fadesrek.edu.ng', 'PARENT', 'Ibrahim Musa'],
  ['student@fadesrek.edu.ng', 'STUDENT', 'Fatima Musa'],
  ['receptionist@fadesrek.edu.ng', 'RECEPTIONIST', 'Bilkisu Chukwu'],
  ['security@fadesrek.edu.ng', 'SECURITY_OFFICER', 'Sadiq Adebayo'],
];
const DEMO_PASSWORD = 'fadesrek2026';

const FIRST_NAMES = ['Chidinma', 'Oluwaseun', 'Amaka', 'Emeka', 'Bukola', 'Tobi', 'Zainab', 'Musa', 'Chinedu', 'Blessing',
  'Ifeoma', 'Yakubu', 'Ngozi', 'Femi', 'Halima', 'Kelechi', 'Aisha', 'Chukwuemeka', 'Damilola', 'Grace',
  'Success', 'Precious', 'Abdullahi', 'Chiamaka', 'Tunde', 'Rahila', 'Obiora', 'Fadila', 'Ikechukwu', 'Comfort'];
const LAST_NAMES = ['Okafor', 'Adeyemi', 'Bello', 'Okonkwo', 'Suleiman', 'Nwachukwu', 'Danjuma', 'Abubakar', 'Chukwu',
  'Salami', 'Garba', 'Lawal', 'Ojo', 'Olawale', 'Ogunleye', 'Yakubu', 'Aliyu', 'Musa', 'Obi', 'Adebayo'];

function nameFor(index, pool1 = FIRST_NAMES, pool2 = LAST_NAMES) {
  return [pool1[index % pool1.length], pool2[(index * 7 + 3) % pool2.length]];
}

async function main() {
  // Batched with createMany/skipDuplicates rather than the upsert-per-row
  // loop used elsewhere in this script — the role/permission grid alone is
  // ~2,000 RolePermission rows, and against a remote pooler that's ~2,000
  // sequential network round trips (minutes) instead of 5. Ids are generated
  // client-side so the grid can be built as pure in-memory data; a findMany
  // afterwards resolves both newly-inserted and (on a rerun) already-existing
  // rows to their real ids.
  console.log('Seeding roles & permissions...');
  await prisma.role.createMany({
    data: Object.entries(ROLES).map(([key, def]) => ({ id: crypto.randomUUID(), key, title: def.title, scope: def.scope })),
    skipDuplicates: true,
  });
  const roleRows = Object.fromEntries((await prisma.role.findMany()).map(r => [r.key, r]));

  await prisma.permission.createMany({
    data: PERMISSIONS.map(key => {
      const [module, action] = key === 'portal.view' ? ['portal', 'view'] : key.split('.');
      return { id: crypto.randomUUID(), key, module, action };
    }),
    skipDuplicates: true,
  });
  const permissionRows = Object.fromEntries((await prisma.permission.findMany()).map(p => [p.key, p]));

  const rolePermissionData = [];
  for (const [roleKey, perms] of Object.entries(GRANTS)) {
    for (const permKey of perms) {
      rolePermissionData.push({ id: crypto.randomUUID(), roleId: roleRows[roleKey].id, permissionId: permissionRows[permKey].id });
    }
  }
  await prisma.rolePermission.createMany({ data: rolePermissionData, skipDuplicates: true });

  console.log('Seeding academic calendar...');
  const sessionA = await prisma.academicSession.upsert({
    where: { name: '2024/2025' }, update: {}, create: { name: '2024/2025' },
  });
  const sessionB = await prisma.academicSession.upsert({
    where: { name: '2025/2026' }, update: {}, create: { name: '2025/2026' },
  });

  await upsertTerm(sessionA.id, 'First Term', 1, new Date('2024-09-16'), new Date('2024-12-13'), false);
  await upsertTerm(sessionA.id, 'Second Term', 2, new Date('2025-01-06'), new Date('2025-04-04'), false);
  const termA3 = await upsertTerm(sessionA.id, 'Third Term', 3, new Date('2025-04-28'), new Date('2025-07-25'), false);
  const termB1 = await upsertTerm(sessionB.id, 'First Term', 1, dayOffset(-300), dayOffset(-241), false);
  const termB2 = await upsertTerm(sessionB.id, 'Second Term', 2, dayOffset(-240), dayOffset(-181), false);
  const termB3 = await upsertTerm(sessionB.id, 'Third Term', 3, dayOffset(-60), dayOffset(60), true);

  console.log('Seeding classes...');
  const classDefs = [
    { level: 'JSS 1', arm: 'Gold', capacity: 35 },
    { level: 'JSS 2', arm: 'Gold', capacity: 35 },
    { level: 'JSS 3', arm: 'Gold', capacity: 35 },
    { level: 'SS 1', arm: 'Science', stream: 'Science', capacity: 30 },
    { level: 'SS 2', arm: 'Arts', stream: 'Arts', capacity: 30 },
    { level: 'SS 3', arm: 'Science', stream: 'Science', capacity: 30 },
  ];
  const classes = [];
  for (const c of classDefs) {
    classes.push(await prisma.schoolClass.upsert({
      where: { level_arm: { level: c.level, arm: c.arm } },
      update: {},
      create: c,
    }));
  }
  const jss2Gold = classes[1];

  console.log('Seeding staff...');
  const staffRows = {};
  let staffCounter = 0;
  for (const [, roleKey, displayName] of DEMO_USERS) {
    if (roleKey === 'PARENT' || roleKey === 'STUDENT') continue;
    const [first, ...rest] = displayName.split(' ');
    staffCounter++;
    staffRows[roleKey] = await prisma.staff.upsert({
      where: { staffNo: `STF${String(staffCounter).padStart(4, '0')}` },
      update: {},
      create: {
        staffNo: `STF${String(staffCounter).padStart(4, '0')}`,
        firstName: first,
        lastName: rest.join(' '),
        gender: staffCounter % 2 === 0 ? 'FEMALE' : 'MALE',
        position: ROLES[roleKey].title,
        department: ['TEACHER', 'CLASS_TEACHER', 'SUBJECT_TEACHER'].includes(roleKey) ? 'Academics' : 'Administration',
        phone: `080${String(10000000 + staffCounter).slice(0, 8)}`,
      },
    });
  }
  const extraSubjects = ['Mathematics', 'English', 'Biology', 'Chemistry', 'Physics'];
  const extraStaff = [];
  for (let i = 0; i < extraSubjects.length; i++) {
    staffCounter++;
    const [first, last] = nameFor(i + 50);
    extraStaff.push(await prisma.staff.upsert({
      where: { staffNo: `STF${String(staffCounter).padStart(4, '0')}` },
      update: {},
      create: {
        staffNo: `STF${String(staffCounter).padStart(4, '0')}`,
        firstName: first, lastName: last,
        gender: i % 2 === 0 ? 'MALE' : 'FEMALE',
        position: `${extraSubjects[i]} Teacher`,
        department: 'Academics',
        phone: `080${String(20000000 + i).slice(0, 8)}`,
      },
    }));
  }
  const allStaff = [...Object.values(staffRows), ...extraStaff];

  console.log('Seeding leave requests (staff absences)...');
  // Two staff on approved leave covering "today" — real signal for the
  // staff_absences intent. One pending, one declined, for variety.
  await upsertLeave(allStaff[0].id, 'ANNUAL', dayOffset(-2), 7, 'APPROVED', 'Annual leave');
  await upsertLeave(allStaff[1].id, 'SICK', dayOffset(0), 3, 'APPROVED', 'Reported unwell');
  await upsertLeave(allStaff[2].id, 'STUDY', dayOffset(5), 4, 'PENDING', 'Professional development course');
  await upsertLeave(allStaff[3].id, 'CASUAL', dayOffset(-20), 2, 'DECLINED', 'Personal matter');

  console.log('Seeding guardians & students...');
  const musaGuardian = await prisma.guardian.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: { id: '00000000-0000-0000-0000-000000000001', firstName: 'Ibrahim', lastName: 'Musa', phone: '08031112222', email: 'ibrahim.musa@example.com' },
  });

  const STUDENTS_PER_CLASS = 8;
  const students = [];
  let admissionCounter = 1;
  for (let ci = 0; ci < classes.length; ci++) {
    for (let si = 0; si < STUDENTS_PER_CLASS; si++) {
      const idx = ci * STUDENTS_PER_CLASS + si;
      const isFatima = ci === 1 && si === 0; // JSS 2 Gold, first slot
      const isAisha = ci === 0 && si === 0; // JSS 1 Gold, first slot — Fatima's sibling
      const [first, last] = isFatima ? ['Fatima', 'Musa'] : isAisha ? ['Aisha', 'Musa'] : nameFor(idx);
      const admissionNo = `FA${String(admissionCounter).padStart(4, '0')}`;
      admissionCounter++;

      const student = await prisma.student.upsert({
        where: { admissionNo },
        update: {},
        create: {
          admissionNo,
          firstName: first,
          lastName: last,
          gender: idx % 2 === 0 ? 'MALE' : 'FEMALE',
          dob: new Date(Date.UTC(2012 - ci, idx % 12, (idx % 27) + 1)),
          boarder: idx % 6 === 0,
          usesTransport: idx % 3 === 0,
          enrolledOn: dayOffset(-400),
          lifecycleStatus: 'ENROLLED',
        },
      });
      students.push({ student, classRef: classes[ci] });

      await prisma.studentEnrollment.upsert({
        where: { studentId_academicSessionId: { studentId: student.id, academicSessionId: sessionB.id } },
        update: {},
        create: { studentId: student.id, classId: classes[ci].id, academicSessionId: sessionB.id },
      });

      if (isFatima || isAisha) {
        await prisma.studentGuardian.upsert({
          where: { studentId_guardianId: { studentId: student.id, guardianId: musaGuardian.id } },
          update: {},
          create: { studentId: student.id, guardianId: musaGuardian.id, relationship: 'Father', isPrimary: true },
        });
      } else {
        const [gf] = nameFor(idx + 100);
        const guardianId = nameSlugId(`guardian-${admissionNo}`);
        const guardian = await prisma.guardian.upsert({
          where: { id: guardianId },
          update: {},
          create: { id: guardianId, firstName: gf, lastName: last, phone: `080${String(30000000 + idx).slice(0, 8)}` },
        });
        await prisma.studentGuardian.upsert({
          where: { studentId_guardianId: { studentId: student.id, guardianId: guardian.id } },
          update: {},
          create: { studentId: student.id, guardianId: guardian.id, relationship: idx % 2 === 0 ? 'Father' : 'Mother', isPrimary: true },
        });
      }
    }
  }
  const fatima = students.find(s => s.student.firstName === 'Fatima' && s.student.lastName === 'Musa').student;

  console.log('Linking demo user accounts...');
  for (const [username, roleKey, displayName] of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const data = {
      username, passwordHash, displayName, roleId: roleRows[roleKey].id,
    };
    if (roleKey === 'PARENT') data.guardianId = musaGuardian.id;
    if (roleKey === 'STUDENT') data.studentId = fatima.id;
    if (staffRows[roleKey]) data.staffId = staffRows[roleKey].id;
    if (roleKey === 'CLASS_TEACHER') data.homeroomClassId = jss2Gold.id;

    await prisma.user.upsert({ where: { username }, update: data, create: data });
  }

  console.log('Seeding fee items, invoices & payments...');
  const tuition = await upsertFeeItem('Tuition', 150000, 'ALL');
  const books = await upsertFeeItem('Books & Materials', 18000, 'ALL');
  const boarding = await upsertFeeItem('Boarding Fee', 65000, 'BOARDER');
  const sports = await upsertFeeItem('Sports Levy', 5000, 'ALL');

  for (let i = 0; i < students.length; i++) {
    const { student } = students[i];
    const lines = [tuition, books, sports, ...(student.boarder ? [boarding] : [])];

    const invoice = await prisma.invoice.upsert({
      where: { studentId_academicSessionId_termId: { studentId: student.id, academicSessionId: sessionB.id, termId: termB3.id } },
      update: {},
      create: { studentId: student.id, academicSessionId: sessionB.id, termId: termB3.id, issuedOn: dayOffset(-55) },
    });
    for (const fee of lines) {
      await prisma.invoiceLine.upsert({
        where: { invoiceId_feeItemId: { invoiceId: invoice.id, feeItemId: fee.id } },
        update: {},
        create: { invoiceId: invoice.id, feeItemId: fee.id, amountKobo: fee.amountKobo },
      });
    }
    const invoiceTotal = lines.reduce((sum, f) => sum + f.amountKobo, 0n);

    // Deterministic payment pattern: 3/8 fully paid, 1/8 fully paid today
    // (for "who paid today"), 2/8 partially paid, 2/8 unpaid.
    const bucket = i % 8;
    let paidAmount = 0n;
    let paidOn = dayOffset(-(5 + (i % 40)));
    if (bucket <= 2) paidAmount = invoiceTotal;
    else if (bucket === 3) { paidAmount = invoiceTotal; paidOn = dayOffset(0); }
    else if (bucket <= 5) paidAmount = invoiceTotal / 2n;
    // bucket 6,7: unpaid

    if (paidAmount > 0n) {
      await prisma.payment.upsert({
        where: { reference: `SEED-INV-${student.admissionNo}` },
        update: {},
        create: {
          studentId: student.id, invoiceId: invoice.id, amountKobo: paidAmount,
          method: bucket % 2 === 0 ? 'BANK_TRANSFER' : 'PAYSTACK',
          reference: `SEED-INV-${student.admissionNo}`, paidOn,
        },
      });
    }
  }

  // A little extra "who paid today" texture beyond the invoice-linked flow.
  for (let i = 0; i < 3; i++) {
    const { student } = students[i + 10];
    const reference = `SEED-EXTRA-${i}`;
    await prisma.payment.upsert({
      where: { reference },
      update: {},
      create: { studentId: student.id, amountKobo: nairaToKobo(20000 + i * 5000), method: 'CASH', reference, paidOn: dayOffset(0) },
    });
  }

  console.log('Seeding historical revenue (for the trend forecast)...');
  const historicalTerms = [['A3', termA3], ['B1', termB1], ['B2', termB2]];
  for (const [termTag, term] of historicalTerms) {
    for (let i = 0; i < 12; i++) {
      const { student } = students[(i * 5) % students.length];
      const mid = new Date((term.startsOn.getTime() + term.endsOn.getTime()) / 2);
      const reference = `SEED-HIST-${termTag}-${i}`; // reference is @db.VarChar(30) — keep it short, not term.id (a uuid)
      await prisma.payment.upsert({
        where: { reference },
        update: {},
        create: {
          studentId: student.id, amountKobo: nairaToKobo(140000 + i * 3000 + (termTag === 'B2' ? 20000 : 0)),
          method: 'BANK_TRANSFER', reference, paidOn: mid,
        },
      });
    }
  }

  console.log('Seeding attendance for today...');
  for (const classRef of classes) {
    const register = await prisma.attendanceRegister.upsert({
      where: { classId_date: { classId: classRef.id, date: dayOffset(0) } },
      update: {},
      create: { classId: classRef.id, date: dayOffset(0), markedById: allStaff[0].id, markedAt: new Date(), isDraft: false },
    });
    const roster = students.filter(s => s.classRef.id === classRef.id);
    for (let i = 0; i < roster.length; i++) {
      const mark = i % 10 === 0 ? 'ABSENT' : i % 7 === 0 ? 'LATE' : 'PRESENT';
      await prisma.attendanceRecord.upsert({
        where: { registerId_studentId: { registerId: register.id, studentId: roster[i].student.id } },
        update: {},
        create: { registerId: register.id, studentId: roster[i].student.id, mark },
      });
    }
  }

  console.log('Seeding inventory...');
  const inventoryDefs = [
    { name: 'A4 Printing Paper (Ream)', unit: 'ream', reorderLevel: 20, unitCostKobo: nairaToKobo(3500), category: 'Stationery', quantity: 8 },
    { name: 'Whiteboard Markers', unit: 'pack', reorderLevel: 15, unitCostKobo: nairaToKobo(2500), category: 'Stationery', quantity: 30 },
    { name: 'Exercise Books', unit: 'carton', reorderLevel: 25, unitCostKobo: nairaToKobo(12000), category: 'Stationery', quantity: 10 },
    { name: 'Laboratory Gloves', unit: 'box', reorderLevel: 10, unitCostKobo: nairaToKobo(4000), category: 'Science', quantity: 3 },
    { name: 'Football', unit: 'piece', reorderLevel: 5, unitCostKobo: nairaToKobo(8000), category: 'Sports', quantity: 12 },
    { name: 'First Aid Kits', unit: 'piece', reorderLevel: 8, unitCostKobo: nairaToKobo(6000), category: 'Medical', quantity: 2 },
    { name: 'Printer Toner', unit: 'cartridge', reorderLevel: 6, unitCostKobo: nairaToKobo(22000), category: 'ICT', quantity: 4 },
    { name: 'Cleaning Detergent', unit: 'gallon', reorderLevel: 12, unitCostKobo: nairaToKobo(3000), category: 'Facilities', quantity: 40 },
  ];
  for (const item of inventoryDefs) {
    const created = await prisma.inventoryItem.upsert({ where: { id: nameSlugId(item.name) }, update: item, create: { id: nameSlugId(item.name), ...item } });
    await prisma.stockMovement.upsert({
      where: { id: nameSlugId(item.name + '-receipt') },
      update: {},
      create: { id: nameSlugId(item.name + '-receipt'), itemId: created.id, kind: 'RECEIPT', quantity: item.quantity, movedOn: dayOffset(-30) },
    });
  }

  console.log('Seeding admission applications...');
  const stages = ['SUBMITTED', 'PAYMENT_CONFIRMED', 'UNDER_REVIEW', 'SHORTLISTED', 'EXAM_TAKEN', 'INTERVIEWED', 'OFFERED', 'ENROLLED', 'REJECTED'];
  for (let i = 0; i < 18; i++) {
    const [first, last] = nameFor(i + 200);
    const stage = stages[i % stages.length];
    await prisma.application.upsert({
      where: { ref: `APP-${String(i + 1).padStart(4, '0')}` },
      update: {},
      create: {
        ref: `APP-${String(i + 1).padStart(4, '0')}`,
        firstName: first, lastName: last,
        gender: i % 2 === 0 ? 'MALE' : 'FEMALE',
        dob: new Date(Date.UTC(2013, i % 12, (i % 27) + 1)),
        applyingFor: classDefs[i % classDefs.length].level,
        guardianName: `${nameFor(i + 300)[0]} ${last}`,
        guardianPhone: `080${String(40000000 + i).slice(0, 8)}`,
        stage,
        submittedOn: i < 4 ? dayOffset(0) : dayOffset(-(i * 3)),
        feePaid: i % 3 !== 0,
      },
    });
  }

  console.log('Seed complete.');
}

async function upsertTerm(academicSessionId, name, sequence, startsOn, endsOn, isCurrent) {
  return prisma.term.upsert({
    where: { academicSessionId_sequence: { academicSessionId, sequence } },
    update: { name, startsOn, endsOn, isCurrent },
    create: { academicSessionId, name, sequence, startsOn, endsOn, isCurrent },
  });
}

/** No natural unique key on LeaveRequest — findFirst-then-upsert keeps this
 * idempotent across seed reruns (which happen: retried on transient
 * connection errors, see runWithRetries below) instead of duplicating rows
 * every attempt the way a plain create() would. Matched on (staffId,
 * leaveType) only, NOT fromDate — fromDate is computed relative to "today"
 * (dayOffset), which shifts between reruns on different calendar days, so
 * including it in the match would defeat the idempotency check it's meant
 * to provide (confirmed: this is exactly what produced duplicate leave rows
 * before this fix). Update on match so the demo dates stay relative to
 * whenever the seed was last run. */
async function upsertLeave(staffId, leaveType, fromDate, days, leaveStatus, reason) {
  const existing = await prisma.leaveRequest.findFirst({ where: { staffId, leaveType } });
  const data = { fromDate, days, leaveStatus, reason };
  if (existing) return prisma.leaveRequest.update({ where: { id: existing.id }, data });
  return prisma.leaveRequest.create({ data: { staffId, leaveType, ...data } });
}

async function upsertFeeItem(name, amountNaira, appliesTo) {
  const existing = await prisma.feeItem.findFirst({ where: { name } });
  if (existing) return existing;
  return prisma.feeItem.create({ data: { name, amountKobo: nairaToKobo(amountNaira), appliesTo } });
}

// Deterministic UUID-shaped id from a name, so re-running the seed against a
// fresh migration is idempotent without a separate lookup table.
function nameSlugId(name) {
  const hash = crypto.createHash('md5').update(name).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

// The remote pooler occasionally drops a connection mid-script (P1017) or
// times out handing one out (P2024) — transient, not a bug. Every write
// above is an upsert/createMany(skipDuplicates)/findFirst-then-create, so
// simply re-running main() from the top on one of these codes is safe: it
// re-verifies already-seeded rows (cheap) and picks up wherever it stopped.
const TRANSIENT_CODES = new Set(['P1017', 'P1001', 'P2024']);

async function runWithRetries(fn, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      if (!TRANSIENT_CODES.has(err.code) || attempt === attempts) throw err;
      console.warn(`Transient DB error (${err.code}) on attempt ${attempt}/${attempts} — retrying...`);
      await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
    }
  }
}

runWithRetries(main)
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
