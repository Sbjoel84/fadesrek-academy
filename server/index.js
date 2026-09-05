'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { requireCsrf } = require('./lib/requireCsrf');
const authRoutes = require('./auth/routes');
const aiRoutes = require('./ai/gateway');
const studentsRoutes = require('./routes/students');
const admissionsRoutes = require('./routes/admissions');
const academicsRoutes = require('./routes/academics');
const timetableRoutes = require('./routes/timetable');
const attendanceRoutes = require('./routes/attendance');
const examinationsRoutes = require('./routes/examinations');
const financeRoutes = require('./routes/finance');
const payrollRoutes = require('./routes/payroll');
const hrRoutes = require('./routes/hr');
const staffRoutes = require('./routes/staff');
const libraryRoutes = require('./routes/library');
const transportRoutes = require('./routes/transport');
const hostelRoutes = require('./routes/hostel');
const inventoryRoutes = require('./routes/inventory');
const communicationRoutes = require('./routes/communication');
const filesRoutes = require('./routes/files');
const reportsRoutes = require('./routes/reports');
const settingsRoutes = require('./routes/settings');
const websiteRoutes = require('./routes/website');
const auditRoutes = require('./routes/audit');
const medicalRoutes = require('./routes/medical');
const behaviourRoutes = require('./routes/behaviour');
const notificationsRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.API_PORT || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:8080';

// http-server (npm run dev / dev:server's sibling static server) binds
// 0.0.0.0 but its `-o` flag opens the browser at 127.0.0.1, not localhost —
// browsers treat those as different origins, so both must be allowed or a
// credentialed fetch from the 127.0.0.1 tab gets silently CORS-blocked.
const ALLOWED_ORIGINS = [
  FRONTEND_ORIGIN,
  FRONTEND_ORIGIN.replace('://localhost', '://127.0.0.1'),
  FRONTEND_ORIGIN.replace('://127.0.0.1', '://localhost'),
];

app.use(helmet());
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin)),
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Global brute-force/abuse ceiling — /api/auth/login carries its own
// stricter limiter (server/auth/routes.js) on top of this one.
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
}));

// CSRF (double-submit cookie, server/lib/requireCsrf.js) — after
// cookieParser (needs req.cookies) and before every route.
app.use(requireCsrf);

app.use('/api/auth', authRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/admissions', admissionsRoutes);
app.use('/api/academics', academicsRoutes);
app.use('/api/timetable', timetableRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/examinations', examinationsRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/transport', transportRoutes);
app.use('/api/hostel', hostelRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/communication', communicationRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/website', websiteRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/medical', medicalRoutes);
app.use('/api/behaviour', behaviourRoutes);
app.use('/api/notifications', notificationsRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Centralised error handler — permission errors become 403s, HttpErrors
// (lib/httpErrors.js: badRequest/notFound/conflict) carry their own status,
// everything else a generic 500 without leaking internals to the client.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.code === 'permission_denied') {
    return res.status(403).json({ error: err.code, permission: err.permission });
  }
  if (err.statusCode) {
    return res.status(err.statusCode).json({ error: err.code, ...err.payload });
  }
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, () => {
  console.log(`Intelligent School OS API listening on :${PORT}`);
});
