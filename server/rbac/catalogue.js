'use strict';

// ============================================================================
// RBAC catalogue — server-side source of truth for the AI layer.
//
// This intentionally mirrors MODULES / VERBS / ROLES / GRANTS as defined in
// the existing front-end demo (script.js, "roles" section). That copy is a
// client-side mock with no backend behind it; this one is what the AI
// gateway actually authorizes against, resolved from real Postgres session
// data rather than trusted client state. Reconciling the two into one shared
// definition (e.g. a JSON file both sides import) is future work — for now
// they are kept in sync by hand, and this file is the one that matters for
// security since it's the one enforced server-side.
//
// One deliberate difference from script.js: ROLES here carries only the kind
// of scope a role has (GLOBAL / CLASS / OWN_RECORDS / SELF), never a scope
// *parameter*. script.js hardcodes CLASS_TEACHER's classId onto the role
// definition itself, which only works because it's a single-demo-user mock.
// Real scope parameters (which class, which children, which student) are
// per-session facts and are resolved from the database — see
// server/rbac/permissionEngine.js#resolveScope.
// ============================================================================

const MODULES = [
  'admissions', 'academics', 'timetable', 'students', 'attendance', 'examinations',
  'finance', 'payroll', 'hr', 'staff', 'library', 'transport', 'hostel', 'inventory',
  'communication', 'files', 'reports', 'settings', 'website', 'audit',
  'medical', 'behaviour',
];

const VERBS = ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'export', 'print', 'restore'];

const PERMISSIONS = ['portal.view', ...MODULES.flatMap(m => VERBS.map(v => `${m}.${v}`))];

const grant = (modules, verbs) => modules.flatMap(m => verbs.map(v => `${m}.${v}`));

/** role key -> scope kind (+ title, for display only). No scope parameters here. */
const ROLES = {
  SUPER_ADMIN: { title: 'Super Administrator', scope: 'GLOBAL' },
  PROPRIETOR: { title: 'School Proprietor', scope: 'GLOBAL' },
  PRINCIPAL: { title: 'Principal', scope: 'GLOBAL' },
  VICE_PRINCIPAL: { title: 'Vice Principal', scope: 'GLOBAL' },
  ACADEMIC_COORDINATOR: { title: 'Academic Coordinator', scope: 'GLOBAL' },
  BURSAR: { title: 'Bursar', scope: 'GLOBAL' },
  SECRETARY: { title: 'Secretary', scope: 'GLOBAL' },
  REGISTRAR: { title: 'Registrar', scope: 'GLOBAL' },
  ICT_ADMIN: { title: 'ICT Administrator', scope: 'GLOBAL' },
  TEACHER: { title: 'Teacher', scope: 'GLOBAL' },
  CLASS_TEACHER: { title: 'Class Teacher', scope: 'CLASS' },
  SUBJECT_TEACHER: { title: 'Subject Teacher', scope: 'GLOBAL' },
  LIBRARIAN: { title: 'Librarian', scope: 'GLOBAL' },
  TRANSPORT_OFFICER: { title: 'Transport Officer', scope: 'GLOBAL' },
  HOSTEL_ADMIN: { title: 'Hostel Administrator', scope: 'GLOBAL' },
  STORE_KEEPER: { title: 'Store Keeper', scope: 'GLOBAL' },
  INVENTORY_OFFICER: { title: 'Inventory Officer', scope: 'GLOBAL' },
  HR_MANAGER: { title: 'HR Manager', scope: 'GLOBAL' },
  PARENT: { title: 'Parent', scope: 'OWN_RECORDS' },
  STUDENT: { title: 'Student', scope: 'SELF' },
  RECEPTIONIST: { title: 'Receptionist', scope: 'GLOBAL' },
  SECURITY_OFFICER: { title: 'Security Officer', scope: 'GLOBAL' },
};

const GRANTS = {
  SUPER_ADMIN: ['portal.view', ...grant(MODULES, VERBS)],

  PROPRIETOR: [
    ...grant(MODULES, ['view', 'export', 'print', 'approve', 'reject']),
    ...grant(['settings'], ['view', 'create', 'edit']),
  ],

  PRINCIPAL: [
    'portal.view',
    ...grant(['admissions', 'academics', 'timetable', 'students', 'attendance', 'examinations',
      'staff', 'communication', 'library', 'transport', 'hostel', 'inventory', 'files', 'reports', 'behaviour'],
      ['view', 'create', 'edit', 'approve', 'reject', 'export', 'print']),
    ...grant(['medical'], ['view', 'export', 'print']),
    ...grant(['finance'], ['view', 'create', 'approve', 'export', 'print']),
    ...grant(['payroll'], ['view', 'approve']),
    ...grant(['hr'], ['view', 'approve', 'reject']),
    ...grant(['settings', 'website'], ['view', 'edit']),
    ...grant(['audit'], ['view', 'export']),
  ],

  VICE_PRINCIPAL: [
    'portal.view',
    ...grant(['admissions', 'academics', 'timetable', 'students', 'attendance', 'examinations', 'staff', 'communication', 'library', 'behaviour'],
      ['view', 'create', 'edit', 'approve', 'export', 'print']),
    ...grant(['medical'], ['view']),
    ...grant(['hr'], ['view', 'approve']),
    ...grant(['reports'], ['view', 'export', 'print']),
  ],

  ACADEMIC_COORDINATOR: [
    'portal.view',
    ...grant(['academics', 'timetable', 'examinations'], ['view', 'create', 'edit', 'approve', 'reject', 'export', 'print']),
    ...grant(['students', 'attendance'], ['view', 'export']),
    ...grant(['reports'], ['view', 'export', 'print']),
  ],

  BURSAR: [
    ...grant(['finance', 'payroll'], ['view', 'create', 'edit', 'approve', 'export', 'print']),
    ...grant(['students'], ['view']),
    ...grant(['inventory'], ['view', 'approve']),
    ...grant(['reports'], ['view', 'export', 'print']),
  ],

  SECRETARY: [
    ...grant(['communication'], ['view', 'create', 'edit', 'print']),
    ...grant(['students', 'admissions'], ['view', 'create']),
    ...grant(['files'], ['view', 'create']),
    ...grant(['reports'], ['view', 'print']),
  ],

  REGISTRAR: [
    ...grant(['admissions'], ['view', 'create', 'edit', 'approve', 'reject', 'export', 'print']),
    ...grant(['students'], ['view', 'create', 'edit', 'approve', 'export', 'print']),
    ...grant(['academics'], ['view', 'create']),
    ...grant(['timetable', 'examinations', 'attendance'], ['view']),
    ...grant(['communication', 'files'], ['view', 'create']),
    ...grant(['medical'], ['view', 'create', 'edit']),
    ...grant(['behaviour'], ['view']),
    ...grant(['reports'], ['view', 'export']),
  ],

  ICT_ADMIN: [
    ...grant(['settings', 'files'], ['view', 'create', 'edit', 'export', 'print']),
    ...grant(['audit'], ['view', 'export', 'print']),
    ...grant(['website'], ['view', 'create', 'edit']),
    ...grant(MODULES, ['restore']),
  ],

  TEACHER: [
    'portal.view',
    ...grant(['academics', 'timetable'], ['view', 'create', 'edit']),
    ...grant(['examinations'], ['view', 'edit']),
    ...grant(['students', 'attendance', 'library'], ['view']),
    ...grant(['communication'], ['view', 'create']),
    ...grant(['behaviour'], ['view', 'create']),
  ],

  CLASS_TEACHER: [
    'portal.view',
    ...grant(['academics', 'timetable'], ['view', 'create', 'edit']),
    ...grant(['examinations'], ['view', 'edit', 'print']),
    ...grant(['attendance'], ['view', 'create', 'approve']),
    ...grant(['students', 'library'], ['view']),
    ...grant(['communication'], ['view', 'create']),
    ...grant(['behaviour'], ['view', 'create', 'approve']),
    ...grant(['medical'], ['view']),
  ],

  SUBJECT_TEACHER: [
    'portal.view',
    ...grant(['academics'], ['view', 'create', 'edit']),
    ...grant(['examinations'], ['view', 'edit']),
    ...grant(['timetable', 'students'], ['view']),
    ...grant(['communication'], ['view', 'create']),
    ...grant(['behaviour'], ['view', 'create']),
  ],

  LIBRARIAN: [
    ...grant(['library'], ['view', 'create', 'edit', 'delete', 'approve', 'export', 'print', 'restore']),
    ...grant(['students'], ['view']),
  ],

  TRANSPORT_OFFICER: [
    ...grant(['transport'], ['view', 'create', 'edit', 'delete', 'export', 'print']),
    ...grant(['students'], ['view']),
  ],

  HOSTEL_ADMIN: [
    ...grant(['hostel'], ['view', 'create', 'edit', 'delete', 'export', 'print']),
    ...grant(['students'], ['view']),
  ],

  STORE_KEEPER: [
    ...grant(['inventory'], ['view', 'create', 'edit', 'print']),
  ],

  INVENTORY_OFFICER: [
    ...grant(['inventory'], ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'export', 'print', 'restore']),
  ],

  HR_MANAGER: [
    ...grant(['staff', 'hr'], ['view', 'create', 'edit', 'approve', 'reject', 'export', 'print']),
    ...grant(['payroll', 'attendance'], ['view']),
    ...grant(['reports'], ['view', 'export']),
  ],

  PARENT: [
    'portal.view',
    ...grant(['students', 'academics', 'timetable', 'examinations', 'attendance', 'medical', 'behaviour'], ['view']),
    ...grant(['communication'], ['view', 'create']),
    ...grant(['finance'], ['view', 'create']),
  ],

  STUDENT: [
    'portal.view',
    ...grant(['students', 'academics', 'timetable', 'examinations', 'attendance', 'communication', 'library'], ['view']),
  ],

  RECEPTIONIST: [
    ...grant(['admissions', 'students'], ['view', 'create']),
    ...grant(['communication', 'files'], ['view', 'create']),
    ...grant(['transport'], ['view']),
  ],

  SECURITY_OFFICER: [
    ...grant(['students', 'staff', 'transport', 'attendance', 'communication'], ['view']),
  ],
};

module.exports = { MODULES, VERBS, PERMISSIONS, ROLES, GRANTS, grant };
