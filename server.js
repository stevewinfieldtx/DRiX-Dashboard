// server.js — DRiX Dashboard
// Standalone Express app. Own Postgres. Calls DRiX-Leads API for processing.
require('dotenv').config();
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const ddb     = require('./dashboard-db');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3100;
const app  = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── CORS (dev) ────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Dash-Token');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});

// ─── COOKIE PARSER (lightweight) ───────────────────────────────────────────────
app.use((req, _res, next) => {
  req.cookies = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) req.cookies[k.trim()] = decodeURIComponent(v.join('='));
  });
  next();
});

// ─── DATABASE ──────────────────────────────────────────────────────────────────
let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
  pool.query('SELECT 1').then(() => {
    console.log('[db] PostgreSQL connected');
    ddb.init(pool);
    ddb.initDashboardSchema();
  }).catch(e => {
    console.error('[db] Connection failed:', e.message);
  });
} else {
  console.warn('[db] No DATABASE_URL — dashboard will not function');
}

// ─── HEALTH ────────────────────────────────────────────────────────────────────
app.get('/healthz', (_req, res) => {
  res.json({
    status: 'ok',
    app: 'DRiX-Dashboard',
    db: !!pool,
    drix_api: !!process.env.DRIX_API_URL,
    time: new Date().toISOString(),
  });
});

// ─── DASHBOARD API ROUTES ──────────────────────────────────────────────────────
require('./dashboard-routes')(app);

// ─── STATIC + SPA FALLBACK ─────────────────────────────────────────────────────
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('*', (_req, res) => {
    res.status(503).send('Client not built. Run: cd client && npm install && npm run build');
  });
}

// ─── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[DRiX-Dashboard] Running on port ${PORT}`);
  if (process.env.DRIX_API_URL) {
    console.log(`[DRiX-Dashboard] DRiX Leads API: ${process.env.DRIX_API_URL}`);
  } else {
    console.warn('[DRiX-Dashboard] No DRIX_API_URL set — lead processing disabled');
  }
});
