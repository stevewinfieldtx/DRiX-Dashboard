// dashboard-routes.js — DRiX Dashboard API routes
const crypto = require('crypto');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const ddb = require('./dashboard-db');
const drixApi = require('./drix-api-client');

const SESSION_SECRET = process.env.SESSION_SECRET
  || crypto.createHash('sha256').update('drix-dash::' + (process.env.DATABASE_URL || 'dev')).digest('hex');
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.DASHBOARD_FROM_EMAIL || 'nick@getthedrix.com';
const SEND_EMAILS = process.env.SEND_EMAILS === '1'; // DEV: emails off unless SEND_EMAILS=1
const APP_URL = (process.env.APP_URL || process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '').replace(/\/+$/, '');

// ─── SESSION ───────────────────────────────────────────────────────────────────

function signToken(userId) {
  const payload = `${userId}:${Date.now() + SESSION_TTL}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}:${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split(':');
  if (parts.length !== 3) return null;
  const [userId, expiry, sig] = parts;
  const check = crypto.createHmac('sha256', SESSION_SECRET).update(`${userId}:${expiry}`).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(check))) return null;
  } catch { return null; }
  if (Date.now() > parseInt(expiry)) return null;
  return parseInt(userId);
}

async function requireAuth(req, res, next) {
  const token = req.cookies?.drix_dash || req.headers['x-dash-token'];
  const userId = verifyToken(token);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = await ddb.getUserById(userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role))
      return res.status(403).json({ error: `Requires ${roles.join(' or ')} role` });
    next();
  };
}

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ─── EMAIL ─────────────────────────────────────────────────────────────────────

async function sendEmail(to, subject, html) {
  if (!SEND_EMAILS) { console.log('[email] skipped (dev): ' + to + ' - ' + subject); return; }
  if (!RESEND_API_KEY) {
    console.log(`[email] Skipped (no key): ${to} — ${subject}`);
    return;
  }
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
    });
    console.log(`[email] Sent: ${to} — ${subject}`);
  } catch (e) {
    console.error(`[email] Failed: ${e.message}`);
  }
}

function tempPassword() { return 'password1'; } // DEV: fixed password; restore random for production

// Derive a display name from a URL (e.g. https://www.acme-corp.com -> "Acme Corp")
function nameFromUrl(url) {
  try {
    let h = String(url || '').trim();
    if (!h) return '';
    if (!/^https?:\/\//i.test(h)) h = 'https://' + h;
    const host = new URL(h).hostname.replace(/^www\./i, '');
    const label = host.split('.').slice(0, -1)[0] || host;
    return label.split(/[-_]/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  } catch { return String(url || '').trim(); }
}

function setCookie(res, token) {
  res.cookie('drix_dash', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_PUBLIC_DOMAIN,
    sameSite: 'lax',
    maxAge: SESSION_TTL,
    path: '/',
  });
}

// ─── ROUTES ────────────────────────────────────────────────────────────────────

module.exports = function install(app) {

  // ══ AUTH ══════════════════════════════════════════════════════════════════════

  app.post('/api/dashboard/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await ddb.authenticateUser(email, password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    setCookie(res, signToken(user.id));
    res.json({ ok: true, user });
  });

  app.post('/api/dashboard/logout', (_req, res) => {
    res.clearCookie('drix_dash', { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/dashboard/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  // Bootstrap: register first vendor account
  app.post('/api/dashboard/register-vendor', async (req, res) => {
    const { email, password, name, company } = req.body || {};
    if (!email || !password || !name || !company)
      return res.status(400).json({ error: 'email, password, name, company required' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be 8+ characters' });
    try {
      const user = await ddb.createUser({ email, password, name, role: 'vendor', company });
      setCookie(res, signToken(user.id));
      res.json({ ok: true, user });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/dashboard/change-password', requireAuth, async (req, res) => {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
    if (new_password.length < 8) return res.status(400).json({ error: 'Password must be 8+ characters' });
    const full = await ddb.getUserByEmail(req.user.email);
    if (!full || !ddb.verifyPassword(current_password, full.password_hash, full.salt))
      return res.status(401).json({ error: 'Current password incorrect' });
    const { hash, salt } = ddb.hashPassword(new_password);
    const p = ddb.pool();
    if (p) await p.query('UPDATE dashboard_users SET password_hash=$1, salt=$2 WHERE id=$3', [hash, salt, full.id]);
    res.json({ ok: true });
  });

  // ══ CSV UPLOAD ═══════════════════════════════════════════════════════════════

  app.post('/api/dashboard/upload-csv', requireAuth, requireRole('vendor', 'manager'), csvUpload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    let rows;
    try {
      rows = parse(req.file.buffer.toString('utf-8'), {
        columns: true, skip_empty_lines: true, trim: true, relax_column_count: true,
      });
    } catch (e) {
      return res.status(400).json({ error: `CSV parse error: ${e.message}` });
    }
    if (!rows.length) return res.status(400).json({ error: 'CSV is empty' });

    const required = ['customer_url','solution_url','partner_url','manager_email'];
    const headers = Object.keys(rows[0]);
    const missing = required.filter(r => !headers.includes(r));
    if (missing.length) return res.status(400).json({ error: `Missing columns: ${missing.join(', ')}`, expected: required });

    const errors = [];
    rows.forEach((row, i) => {
      if (!row.partner_url?.trim()) errors.push(`Row ${i+1}: missing partner_url`);
      if (!row.customer_url?.trim()) errors.push(`Row ${i+1}: missing customer_url`);
      if (!row.solution_url?.trim()) errors.push(`Row ${i+1}: missing solution_url`);
      if (!row.manager_email?.trim()) errors.push(`Row ${i+1}: missing manager_email`);
    });
    if (errors.length) return res.status(400).json({ error: 'Validation errors', details: errors.slice(0, 10) });

    const created = [];
    const managersNew = [];

    for (const row of rows) {
      try {
        const partnerCompany = nameFromUrl(row.partner_url) || row.partner_url.trim();
        const customerName = nameFromUrl(row.customer_url) || row.customer_url.trim();
        let mgr = await ddb.getUserByEmail(row.manager_email.trim());
        if (!mgr) {
          const pw = tempPassword();
          mgr = await ddb.createUser({
            email: row.manager_email.trim(),
            password: pw,
            name: row.manager_email.split('@')[0],
            role: 'manager',
            company: partnerCompany,
          });
          managersNew.push({ email: mgr.email, name: mgr.name, pw });
        }
        const opp = await ddb.createOpportunity({
          customer_name: customerName,
          customer_url: row.customer_url.trim(),
          solution_url: row.solution_url.trim(),
          partner_company: partnerCompany,
          partner_url: row.partner_url.trim(),
          estimated_value: parseInt(String(row.estimated_value || '').replace(/[^0-9]/g, '')) || 0,
          lead_source: row.lead_source?.trim() || 'Vendor Assigned',
          notes: row.notes?.trim() || null,
          vendor_user_id: req.user.role === 'vendor' ? req.user.id : null,
          manager_user_id: mgr.id,
        });
        created.push(opp);
      } catch (e) {
        errors.push(`${row.customer_url || 'row'}: ${e.message}`);
      }
    }

    // Welcome emails (fire-and-forget)
    const loginUrl = APP_URL ? `${APP_URL}/login` : 'the DRiX Dashboard';
    for (const m of managersNew) {
      sendEmail(m.email, `${created.length} new opportunities in DRiX`,
        `<p>Hi ${m.name},</p>
        <p>You've been assigned opportunities in the DRiX Dashboard.</p>
        <p><strong>Email:</strong> ${m.email}<br><strong>Temporary password:</strong> ${m.pw}</p>
        <p>${APP_URL ? `<a href="${APP_URL}/login">Log in</a>` : loginUrl}</p>
        <p>— DRiX by WinTech Partners</p>`);
    }

    // Background: process each opp through DRiX-Leads
    if (drixApi.isConfigured()) {
      for (const opp of created) {
        processDrixLead(opp).catch(e => {
          console.error(`[process] Failed opp ${opp.id} (${opp.customer_name}): ${e.message}`);
          ddb.updateOppDrixFailed(opp.id, e.message);
        });
      }
    } else {
      console.warn('[process] DRIX_API_URL not configured — marking all as ready without processing');
      for (const opp of created) {
        ddb.updateOppDrixResult(opp.id, { run_id: `manual_${opp.id}`, drix_result: { note: 'Processing skipped — DRIX_API_URL not configured' } });
      }
    }

    res.json({
      ok: true,
      created: created.length,
      managers_created: managersNew.length,
      errors: errors.length ? errors : undefined,
    });
  });

  // ══ QUERIES ══════════════════════════════════════════════════════════════════

  app.get('/api/dashboard/opportunities', requireAuth, async (req, res) => {
    try {
      const opps = await ddb.getOpportunities(req.user);
      const lite = opps.map(o => ({
        id: o.id, customer_name: o.customer_name, customer_url: o.customer_url,
        solution_url: o.solution_url, partner_company: o.partner_company,
        estimated_value: o.estimated_value, lead_source: o.lead_source,
        status: o.status, manager_name: o.manager_name, rep_name: o.rep_name,
        rep_email: o.rep_email, chosen_strategy_title: o.chosen_strategy_title,
        created_at: o.created_at, assigned_at: o.assigned_at,
        last_accessed_at: o.last_accessed_at, view_count: o.view_count,
        tools_used_count: o.tools_used_count, notes: o.notes,
      }));
      res.json({ opportunities: lite });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
    try {
      const stats = await ddb.getStats(req.user);
      res.json({ stats });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/dashboard/opp/:id', requireAuth, async (req, res) => {
    try {
      const opp = await ddb.getOpportunityById(parseInt(req.params.id));
      if (!opp) return res.status(404).json({ error: 'Not found' });
      if (!ddb.userCanAccess(req.user, opp)) return res.status(403).json({ error: 'Access denied' });
      ddb.recordAccess(opp.id, req.user.id, 'viewed').catch(() => {});
      if (req.user.role === 'rep' && opp.status === 'assigned') {
        ddb.updateOppStatus(opp.id, 'reviewing').catch(() => {});
        opp.status = 'reviewing';
      }
      res.json({ opportunity: opp });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/dashboard/reps', requireAuth, requireRole('manager', 'vendor'), async (req, res) => {
    try {
      res.json({ reps: await ddb.getRepsByCompany(req.user.company) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ══ ACTIONS ══════════════════════════════════════════════════════════════════

  app.post('/api/dashboard/opp/:id/assign', requireAuth, requireRole('manager', 'vendor'), async (req, res) => {
    const { rep_name, rep_email } = req.body || {};
    if (!rep_name || !rep_email) return res.status(400).json({ error: 'rep_name and rep_email required' });
    try {
      const opp = await ddb.getOpportunityById(parseInt(req.params.id));
      if (!opp) return res.status(404).json({ error: 'Not found' });
      if (!ddb.userCanAccess(req.user, opp)) return res.status(403).json({ error: 'Access denied' });

      let rep = await ddb.getUserByEmail(rep_email);
      let pw = null;
      if (!rep) {
        pw = tempPassword();
        rep = await ddb.createUser({ email: rep_email.trim(), password: pw, name: rep_name.trim(), role: 'rep', company: opp.partner_company });
      }
      await ddb.assignRep(opp.id, rep.id);
      ddb.recordAccess(opp.id, req.user.id, 'assigned_rep', `${rep.name} (${rep.email})`).catch(() => {});

      sendEmail(rep.email, `New opportunity: ${opp.customer_name}`,
        `<p>Hi ${rep.name},</p>
        <p>You've been assigned: <strong>${opp.customer_name}</strong> — $${(opp.estimated_value || 0).toLocaleString()}</p>
        <p>Intelligence is ready. Log in to review strategies and select your approach.</p>
        ${pw ? `<p><strong>Email:</strong> ${rep.email}<br><strong>Temporary password:</strong> ${pw}</p>` : ''}
        ${APP_URL ? `<p><a href="${APP_URL}/login">Log in</a></p>` : ''}
        <p>— DRiX by WinTech Partners</p>`);

      res.json({ ok: true, rep: { id: rep.id, name: rep.name, email: rep.email } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Reassign partner + its manager after the breakdown - owner only
  app.post('/api/dashboard/opp/:id/reassign-partner', requireAuth, requireRole('vendor'), async (req, res) => {
    const { partner_url, manager_email } = req.body || {};
    if (!partner_url || !manager_email) return res.status(400).json({ error: 'partner_url and manager_email required' });
    try {
      const opp = await ddb.getOpportunityById(parseInt(req.params.id));
      if (!opp) return res.status(404).json({ error: 'Not found' });
      if (!ddb.userCanAccess(req.user, opp)) return res.status(403).json({ error: 'Access denied' });

      const partnerCompany = nameFromUrl(partner_url) || partner_url.trim();
      let mgr = await ddb.getUserByEmail(manager_email);
      let pw = null;
      if (!mgr) {
        pw = tempPassword();
        mgr = await ddb.createUser({ email: manager_email.trim(), password: pw, name: manager_email.split('@')[0], role: 'manager', company: partnerCompany });
      }
      await ddb.reassignPartner(opp.id, { partner_url: partner_url.trim(), partner_company: partnerCompany, manager_user_id: mgr.id });
      ddb.recordAccess(opp.id, req.user.id, 'reassigned_partner', partnerCompany + ' (' + mgr.email + ')').catch(() => {});

      sendEmail(mgr.email, 'New opportunity: ' + opp.customer_name,
        '<p>Hi ' + mgr.name + ',</p>' +
        '<p>You have been assigned an opportunity in the DRiX Dashboard: <strong>' + opp.customer_name + '</strong></p>' +
        (pw ? '<p><strong>Email:</strong> ' + mgr.email + '<br><strong>Temporary password:</strong> ' + pw + '</p>' : '') +
        (APP_URL ? '<p><a href="' + APP_URL + '/login">Log in</a></p>' : '') +
        '<p>- DRiX by WinTech Partners</p>');

      res.json({ ok: true, partner_company: partnerCompany, manager: { id: mgr.id, name: mgr.name, email: mgr.email } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/dashboard/opp/:id/select-strategy', requireAuth, async (req, res) => {
    const { strategy_id } = req.body || {};
    if (!strategy_id) return res.status(400).json({ error: 'strategy_id required' });
    try {
      const opp = await ddb.getOpportunityById(parseInt(req.params.id));
      if (!opp) return res.status(404).json({ error: 'Not found' });
      if (!ddb.userCanAccess(req.user, opp)) return res.status(403).json({ error: 'Access denied' });

      const drixResult = opp.drix_result || {};
      const strategies = drixResult.strategies?.strategies || [];
      const chosen = strategies.find(s => s.id === strategy_id);
      if (!chosen) return res.status(400).json({ error: `Strategy ${strategy_id} not found` });

      if (!opp.run_id) return res.status(400).json({ error: 'No run_id — DRiX processing may not be complete' });

      // Call DRiX-Leads for hydration
      const hydrationData = await drixApi.hydrateLead({ run_id: opp.run_id, strategy_id });
      const hydration = hydrationData.hydration || hydrationData;

      await ddb.selectStrategy(opp.id, {
        strategyId: strategy_id,
        strategyTitle: chosen.title,
        hydration_result: hydration,
      });
      ddb.recordAccess(opp.id, req.user.id, 'selected_strategy', chosen.title).catch(() => {});

      res.json({ ok: true, chosen_strategy: chosen, hydration });
    } catch (e) {
      console.error(`[select-strategy] Failed:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/dashboard/opp/:id/delete', requireAuth, requireRole('vendor'), async (req, res) => {
    const reason = String((req.body || {}).reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'A reason is required to delete' });
    try {
      const opp = await ddb.getOpportunityById(parseInt(req.params.id));
      if (!opp) return res.status(404).json({ error: 'Not found' });
      if (!ddb.userCanAccess(req.user, opp)) return res.status(403).json({ error: 'Access denied' });
      await ddb.deleteOpportunity(opp.id, reason, req.user.email);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/dashboard/opp/:id/value', requireAuth, requireRole('vendor','manager','rep'), async (req, res) => {
    const v = parseInt(String((req.body || {}).estimated_value).replace(/[^0-9]/g, ''));
    if (isNaN(v) || v < 0) return res.status(400).json({ error: 'valid estimated_value required' });
    try {
      const opp = await ddb.getOpportunityById(parseInt(req.params.id));
      if (!opp) return res.status(404).json({ error: 'Not found' });
      if (!ddb.userCanAccess(req.user, opp)) return res.status(403).json({ error: 'Access denied' });
      await ddb.updateOppValue(opp.id, v);
      res.json({ ok: true, estimated_value: v });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/dashboard/opp/:id/status', requireAuth, async (req, res) => {
    const { status } = req.body || {};
    if (!['active', 'won', 'lost'].includes(status))
      return res.status(400).json({ error: 'Status must be active, won, or lost' });
    try {
      const opp = await ddb.getOpportunityById(parseInt(req.params.id));
      if (!opp) return res.status(404).json({ error: 'Not found' });
      if (!ddb.userCanAccess(req.user, opp)) return res.status(403).json({ error: 'Access denied' });
      await ddb.updateOppStatus(opp.id, status);
      ddb.recordAccess(opp.id, req.user.id, 'updated_status', status).catch(() => {});
      res.json({ ok: true, status });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ══ STATUS UPDATE VIA EMAIL LINK (tokenized, no login required) ══════════════

  app.get('/api/dashboard/quick-status/:token', async (req, res) => {
    const decoded = verifyToken(req.params.token);
    // Token format overloaded: we store opp_id:status in a signed wrapper
    // For V1, redirect to login. V2 can have proper email link tokens.
    res.redirect(APP_URL ? `${APP_URL}/login` : '/login');
  });
};

// ─── BACKGROUND PROCESSOR ──────────────────────────────────────────────────────

async function processDrixLead(opp) {
  const t0 = Date.now();
  console.log(`[process] Starting: opp ${opp.id} — ${opp.customer_name}`);
  try {
    const result = await drixApi.processLead({
      partner_url: opp.partner_url,
      solution_url: opp.solution_url,
      customer_url: opp.customer_url,
    });

    await ddb.updateOppDrixResult(opp.id, {
      run_id: result.run_id,
      drix_result: result,
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[process] Done: opp ${opp.id} — ${opp.customer_name} (${elapsed}s, ${result.strategies?.strategies?.length || 0} strategies)`);
  } catch (e) {
    console.error(`[process] Failed: opp ${opp.id} — ${e.message}`);
    await ddb.updateOppDrixFailed(opp.id, e.message);
  }
}
