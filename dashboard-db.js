// dashboard-db.js — DRiX Vendor Dashboard persistence layer
// Sits alongside db.js. Uses the same DATABASE_URL pool.
// Tables: dashboard_users, opportunities, opp_access_log
const crypto = require('crypto');

let _pool = null;

function init(pool) { _pool = pool; }
function pool() { return _pool; }

// ─── SCHEMA ────────────────────────────────────────────────────────────────────
async function initDashboardSchema() {
  const p = pool();
  if (!p) return;
  try {
    await p.query(`
      -- Dashboard users: vendors, partner managers, sales reps
      CREATE TABLE IF NOT EXISTS dashboard_users (
        id              SERIAL PRIMARY KEY,
        email           TEXT UNIQUE NOT NULL,
        password_hash   TEXT NOT NULL,
        salt            TEXT NOT NULL,
        name            TEXT NOT NULL,
        role            TEXT NOT NULL CHECK (role IN ('vendor','manager','rep')),
        company         TEXT NOT NULL,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        last_login      TIMESTAMPTZ
      );

      -- Opportunities: one per CSV row
      CREATE TABLE IF NOT EXISTS opportunities (
        id              SERIAL PRIMARY KEY,
        -- CSV fields
        customer_name   TEXT NOT NULL,
        customer_url    TEXT NOT NULL,
        solution_url    TEXT NOT NULL,
        partner_company TEXT NOT NULL,
        partner_url     TEXT NOT NULL,
        estimated_value INTEGER DEFAULT 0,
        lead_source     TEXT NOT NULL DEFAULT 'Vendor Assigned',
        notes           TEXT,
        -- Relationships
        vendor_user_id  INTEGER REFERENCES dashboard_users(id),
        manager_user_id INTEGER REFERENCES dashboard_users(id),
        rep_user_id     INTEGER REFERENCES dashboard_users(id),
        -- DRiX Lead output (stored after processing)
        run_id          TEXT,
        drix_result     JSONB,
        hydration_result JSONB,
        chosen_strategy_id TEXT,
        chosen_strategy_title TEXT,
        -- Status tracking
        status          TEXT NOT NULL DEFAULT 'processing'
                        CHECK (status IN ('processing','ready','assigned','reviewing','active','won','lost')),
        -- Timestamps
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        assigned_at     TIMESTAMPTZ,
        strategy_selected_at TIMESTAMPTZ,
        last_accessed_at TIMESTAMPTZ,
        status_changed_at TIMESTAMPTZ,
        -- Counters
        view_count      INTEGER DEFAULT 0,
        tools_used_count INTEGER DEFAULT 0
      );

      -- Access log: every page view, tool use, status change
      CREATE TABLE IF NOT EXISTS opp_access_log (
        id          SERIAL PRIMARY KEY,
        opp_id      INTEGER REFERENCES opportunities(id) ON DELETE CASCADE,
        user_id     INTEGER REFERENCES dashboard_users(id),
        action      TEXT NOT NULL,
        detail      TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_opps_vendor     ON opportunities(vendor_user_id);
      CREATE INDEX IF NOT EXISTS idx_opps_manager    ON opportunities(manager_user_id);
      CREATE INDEX IF NOT EXISTS idx_opps_rep        ON opportunities(rep_user_id);
      CREATE INDEX IF NOT EXISTS idx_opps_status     ON opportunities(status);
      CREATE INDEX IF NOT EXISTS idx_opps_partner    ON opportunities(partner_company);
      CREATE INDEX IF NOT EXISTS idx_opps_created    ON opportunities(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_access_opp      ON opp_access_log(opp_id);
      CREATE INDEX IF NOT EXISTS idx_access_user     ON opp_access_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_dusers_email    ON dashboard_users(email);
      CREATE INDEX IF NOT EXISTS idx_dusers_role     ON dashboard_users(role);
      CREATE INDEX IF NOT EXISTS idx_dusers_company  ON dashboard_users(company);
    `);
    console.log('[dashboard-db] Schema initialized');
  } catch (err) {
    console.error('[dashboard-db] Schema init failed:', err.message);
  }
}

// ─── PASSWORD HASHING ──────────────────────────────────────────────────────────
function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const { hash: check } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
}

// ─── USER CRUD ─────────────────────────────────────────────────────────────────

async function createUser({ email, password, name, role, company }) {
  const p = pool();
  if (!p) throw new Error('Database not configured');
  const { hash, salt } = hashPassword(password);
  const res = await p.query(`
    INSERT INTO dashboard_users (email, password_hash, salt, name, role, company)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      company = EXCLUDED.company
    RETURNING id, email, name, role, company, created_at
  `, [email.toLowerCase().trim(), hash, salt, name, role, company]);
  return res.rows[0];
}

async function getUserByEmail(email) {
  const p = pool();
  if (!p) return null;
  const res = await p.query(
    `SELECT * FROM dashboard_users WHERE email = $1`,
    [email.toLowerCase().trim()]
  );
  return res.rows[0] || null;
}

async function getUserById(id) {
  const p = pool();
  if (!p) return null;
  const res = await p.query(
    `SELECT id, email, name, role, company, created_at, last_login FROM dashboard_users WHERE id = $1`,
    [id]
  );
  return res.rows[0] || null;
}

async function authenticateUser(email, password) {
  const user = await getUserByEmail(email);
  if (!user) return null;
  if (!verifyPassword(password, user.password_hash, user.salt)) return null;
  // Update last login
  const p = pool();
  if (p) {
    await p.query(`UPDATE dashboard_users SET last_login = NOW() WHERE id = $1`, [user.id]).catch(() => {});
  }
  return { id: user.id, email: user.email, name: user.name, role: user.role, company: user.company };
}

// ─── OPPORTUNITY CRUD ──────────────────────────────────────────────────────────

async function createOpportunity(data) {
  const p = pool();
  if (!p) throw new Error('Database not configured');
  const res = await p.query(`
    INSERT INTO opportunities (
      customer_name, customer_url, solution_url, partner_company, partner_url,
      estimated_value, lead_source, notes, vendor_user_id, manager_user_id, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'processing')
    RETURNING *
  `, [
    data.customer_name,
    data.customer_url,
    data.solution_url,
    data.partner_company,
    data.partner_url,
    data.estimated_value || 0,
    data.lead_source || 'Vendor Assigned',
    data.notes || null,
    data.vendor_user_id || null,
    data.manager_user_id || null,
  ]);
  return res.rows[0];
}

async function updateOppDrixResult(oppId, { run_id, drix_result }) {
  const p = pool();
  if (!p) return;
  await p.query(`
    UPDATE opportunities
    SET run_id = $2, drix_result = $3, status = 'ready', status_changed_at = NOW()
    WHERE id = $1
  `, [oppId, run_id, JSON.stringify(drix_result)]);
}

async function updateOppDrixFailed(oppId, errorMsg) {
  const p = pool();
  if (!p) return;
  await p.query(`
    UPDATE opportunities
    SET status = 'ready',
        drix_result = $2,
        status_changed_at = NOW()
    WHERE id = $1
  `, [oppId, JSON.stringify({ error: errorMsg })]);
}

async function assignRep(oppId, repUserId) {
  const p = pool();
  if (!p) return;
  await p.query(`
    UPDATE opportunities
    SET rep_user_id = $2, status = 'assigned', assigned_at = NOW(), status_changed_at = NOW()
    WHERE id = $1
  `, [oppId, repUserId]);
}

async function updateOppStatus(oppId, status) {
  const p = pool();
  if (!p) return;
  await p.query(`
    UPDATE opportunities
    SET status = $2, status_changed_at = NOW()
    WHERE id = $1
  `, [oppId, status]);
}

async function reassignPartner(oppId, { partner_url, partner_company, manager_user_id }) {
  const p = pool();
  if (!p) return;
  await p.query(`
    UPDATE opportunities
    SET partner_url = $2, partner_company = $3, manager_user_id = $4, status_changed_at = NOW()
    WHERE id = $1
  `, [oppId, partner_url, partner_company, manager_user_id]);
}

async function selectStrategy(oppId, { strategyId, strategyTitle, hydration_result }) {
  const p = pool();
  if (!p) return;
  await p.query(`
    UPDATE opportunities
    SET chosen_strategy_id = $2,
        chosen_strategy_title = $3,
        hydration_result = $4,
        status = 'active',
        strategy_selected_at = NOW(),
        status_changed_at = NOW()
    WHERE id = $1
  `, [oppId, strategyId, strategyTitle, JSON.stringify(hydration_result)]);
}

async function recordAccess(oppId, userId, action, detail) {
  const p = pool();
  if (!p) return;
  await p.query(`
    INSERT INTO opp_access_log (opp_id, user_id, action, detail) VALUES ($1, $2, $3, $4)
  `, [oppId, userId, action, detail || null]);
  // Bump counters
  if (action === 'viewed') {
    await p.query(`
      UPDATE opportunities SET view_count = view_count + 1, last_accessed_at = NOW() WHERE id = $1
    `, [oppId]);
  } else if (action === 'used_tool') {
    await p.query(`
      UPDATE opportunities SET tools_used_count = tools_used_count + 1, last_accessed_at = NOW() WHERE id = $1
    `, [oppId]);
  }
}

// ─── QUERIES (role-scoped) ─────────────────────────────────────────────────────

async function getOpportunities(user) {
  const p = pool();
  if (!p) return [];
  let query, params;
  if (user.role === 'vendor') {
    query = `
      SELECT o.*,
        dm.name as manager_name, dm.email as manager_email,
        dr.name as rep_name, dr.email as rep_email
      FROM opportunities o
      LEFT JOIN dashboard_users dm ON o.manager_user_id = dm.id
      LEFT JOIN dashboard_users dr ON o.rep_user_id = dr.id
      WHERE o.vendor_user_id = $1
      ORDER BY o.created_at DESC
    `;
    params = [user.id];
  } else if (user.role === 'manager') {
    query = `
      SELECT o.*,
        dm.name as manager_name, dm.email as manager_email,
        dr.name as rep_name, dr.email as rep_email
      FROM opportunities o
      LEFT JOIN dashboard_users dm ON o.manager_user_id = dm.id
      LEFT JOIN dashboard_users dr ON o.rep_user_id = dr.id
      WHERE o.manager_user_id = $1
      ORDER BY o.created_at DESC
    `;
    params = [user.id];
  } else {
    // rep
    query = `
      SELECT o.*,
        dm.name as manager_name, dm.email as manager_email,
        dr.name as rep_name, dr.email as rep_email
      FROM opportunities o
      LEFT JOIN dashboard_users dm ON o.manager_user_id = dm.id
      LEFT JOIN dashboard_users dr ON o.rep_user_id = dr.id
      WHERE o.rep_user_id = $1
      ORDER BY o.created_at DESC
    `;
    params = [user.id];
  }
  const res = await p.query(query, params);
  return res.rows;
}

async function getOpportunityById(oppId) {
  const p = pool();
  if (!p) return null;
  const res = await p.query(`
    SELECT o.*,
      dm.name as manager_name, dm.email as manager_email,
      dr.name as rep_name, dr.email as rep_email,
      dv.name as vendor_name, dv.email as vendor_email
    FROM opportunities o
    LEFT JOIN dashboard_users dm ON o.manager_user_id = dm.id
    LEFT JOIN dashboard_users dr ON o.rep_user_id = dr.id
    LEFT JOIN dashboard_users dv ON o.vendor_user_id = dv.id
    WHERE o.id = $1
  `, [oppId]);
  return res.rows[0] || null;
}

// Check if user has access to this opp
function userCanAccess(user, opp) {
  if (user.role === 'vendor' && opp.vendor_user_id === user.id) return true;
  if (user.role === 'manager' && opp.manager_user_id === user.id) return true;
  if (user.role === 'rep' && opp.rep_user_id === user.id) return true;
  return false;
}

// ─── STATS (vendor summary) ────────────────────────────────────────────────────

async function getStats(user) {
  const p = pool();
  if (!p) return {};
  let whereClause, params;
  if (user.role === 'vendor') {
    whereClause = 'WHERE vendor_user_id = $1';
    params = [user.id];
  } else if (user.role === 'manager') {
    whereClause = 'WHERE manager_user_id = $1';
    params = [user.id];
  } else {
    whereClause = 'WHERE rep_user_id = $1';
    params = [user.id];
  }
  const res = await p.query(`
    SELECT
      status,
      COUNT(*) as count,
      COALESCE(SUM(estimated_value), 0) as total_value
    FROM opportunities
    ${whereClause}
    GROUP BY status
    ORDER BY status
  `, params);
  const stats = {};
  let totalCount = 0, totalValue = 0;
  for (const row of res.rows) {
    stats[row.status] = { count: parseInt(row.count), value: parseInt(row.total_value) };
    totalCount += parseInt(row.count);
    totalValue += parseInt(row.total_value);
  }
  stats.total = { count: totalCount, value: totalValue };
  return stats;
}

// Get reps for a manager (for assignment dropdown)
async function getRepsByCompany(company) {
  const p = pool();
  if (!p) return [];
  const res = await p.query(
    `SELECT id, email, name FROM dashboard_users WHERE role = 'rep' AND company = $1 ORDER BY name`,
    [company]
  );
  return res.rows;
}

module.exports = {
  init,
  pool,
  initDashboardSchema,
  createUser,
  getUserByEmail,
  getUserById,
  authenticateUser,
  hashPassword,
  verifyPassword,
  createOpportunity,
  updateOppDrixResult,
  updateOppDrixFailed,
  assignRep,
  reassignPartner,
  updateOppStatus,
  selectStrategy,
  recordAccess,
  getOpportunities,
  getOpportunityById,
  userCanAccess,
  getStats,
  getRepsByCompany,
};
