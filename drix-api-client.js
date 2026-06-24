// drix-api-client.js — Calls the running DRiX-Leads instance for intelligence processing
// Handles auth, SSE parsing, and hydration.

const DRIX_API_URL = () => (process.env.DRIX_API_URL || '').replace(/\/+$/, '');
const DRIX_API_EMAIL = () => process.env.DRIX_API_EMAIL || '';
const DRIX_API_PASSWORD = () => process.env.DRIX_API_PASSWORD || '';

let _sessionCookie = null;
let _cookieExpiry = 0;

// ─── AUTH ───────────────────────────────────────────────────────────────────────

async function ensureAuth() {
  const base = DRIX_API_URL();
  if (!base) throw new Error('DRIX_API_URL not configured');
  if (!DRIX_API_EMAIL()) throw new Error('DRIX_API_EMAIL not configured');

  // Reuse session if still valid (refresh every 12 hours)
  if (_sessionCookie && Date.now() < _cookieExpiry) return _sessionCookie;

  console.log('[drix-api] Authenticating with DRiX-Leads...');
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DRIX_API_EMAIL(), password: DRIX_API_PASSWORD() }),
  });

  if (!res.ok) {
    // Try signup if login fails (first-time setup)
    const signupRes = await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DRIX_API_EMAIL(), password: DRIX_API_PASSWORD() }),
    });
    if (!signupRes.ok) {
      const err = await signupRes.json().catch(() => ({}));
      throw new Error(`DRiX-Leads auth failed: ${err.error || signupRes.status}`);
    }
    const cookies = signupRes.headers.getSetCookie?.() || [];
    _sessionCookie = cookies.find(c => c.startsWith('drix_session='))?.split(';')[0] || null;
  } else {
    const cookies = res.headers.getSetCookie?.() || [];
    _sessionCookie = cookies.find(c => c.startsWith('drix_session='))?.split(';')[0] || null;
  }

  if (!_sessionCookie) throw new Error('DRiX-Leads did not return a session cookie');
  _cookieExpiry = Date.now() + 12 * 60 * 60 * 1000;
  console.log('[drix-api] Authenticated successfully');
  return _sessionCookie;
}

// ─── PROCESS LEAD (calls /api/demo-flow via SSE) ───────────────────────────────

async function processLead({ partner_url, solution_url, customer_url, email }) {
  const base = DRIX_API_URL();
  if (!base) throw new Error('DRIX_API_URL not configured');

  const cookie = await ensureAuth();

  const body = {
    email: email || DRIX_API_EMAIL(),
    sender_company_url: partner_url,
    solution_url: solution_url,
    customer_url: customer_url,
    mode: 'production',
  };

  console.log(`[drix-api] Processing lead: ${customer_url}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300000); // 5-min hard cap; a hung run must never stick
  let res;
  try {
    res = await fetch(`${base}/api/demo-flow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('DRiX-Leads processing timed out (5 min)');
    throw e;
  }

  if (!res.ok) {
    clearTimeout(timer);
    const err = await res.json().catch(() => ({}));
    throw new Error(`DRiX-Leads processing failed: ${err.error || res.status}`);
  }

  // Parse SSE stream
  const result = { sender: null, solution: null, customer: null, pain_groups: null, strategies: null, run_id: null };
  let text;
  try {
    text = await res.text();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('DRiX-Leads processing timed out (5 min)');
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const events = text.split('\n\n').filter(Boolean);

  for (const block of events) {
    const em = block.match(/^event:\s*(.+)$/m);
    const dm = block.match(/^data:\s*(.+)$/m);
    if (!em || !dm) continue;
    let data;
    try { data = JSON.parse(dm[1]); } catch { continue; }

    switch (em[1].trim()) {
      case 'error':
        throw new Error(data.message || 'DRiX-Leads processing error');
      case 'atoms':
        result.sender = data.sender || null;
        result.solution = data.solution || null;
        result.customer = data.customer || null;
        break;
      case 'pain':
        result.pain_groups = data.pain_groups || { company_pain: [], subindustry_pain: [], industry_pain: data.pain_points || [] };
        break;
      case 'strategies':
        result.strategies = data;
        if (data.run_id) result.run_id = data.run_id;
        break;
      case 'done':
        if (data.run_id) result.run_id = data.run_id;
        break;
    }
  }

  console.log(`[drix-api] Lead processed: ${result.strategies?.strategies?.length || 0} strategies, run_id=${result.run_id}`);
  return result;
}

// ─── HYDRATE (calls /api/hydrate) ──────────────────────────────────────────────

async function hydrateLead({ run_id, strategy_id, custom_strategy }) {
  const base = DRIX_API_URL();
  if (!base) throw new Error('DRIX_API_URL not configured');

  const cookie = await ensureAuth();

  const body = custom_strategy
    ? { run_id, custom_strategy }
    : { run_id, strategy_id };

  console.log(`[drix-api] Hydrating run ${run_id}, strategy ${strategy_id || 'custom'}`);
  const res = await fetch(`${base}/api/hydrate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Hydration failed: ${err.error || err.detail || res.status}`);
  }

  const data = await res.json();
  console.log(`[drix-api] Hydration complete for run ${run_id}`);
  return data;
}

async function coachChat(run_id, message, history) {
  const base = DRIX_API_URL();
  if (!base) throw new Error('DRIX_API_URL not configured');
  const cookie = await ensureAuth();
  const res = await fetch(`${base}/api/coach-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({ run_id, message, history: history || [] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Coach failed (${res.status})`);
  return data;
}

async function provisionVoice(run_id) {
  const base = DRIX_API_URL();
  if (!base) throw new Error('DRIX_API_URL not configured');
  const cookie = await ensureAuth();
  const res = await fetch(`${base}/api/coach-voice/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({ run_id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Voice provisioning failed (${res.status})`);
  return data;
}

function isConfigured() {
  return !!(DRIX_API_URL() && DRIX_API_EMAIL() && DRIX_API_PASSWORD());
}

module.exports = { processLead, hydrateLead, ensureAuth, isConfigured, coachChat, provisionVoice };
