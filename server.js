const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const crypto = require('crypto');
const path = require('path');

const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ══════════════════════════════════════════════
// POSTGRESQL CONNECTION
// Source: mpower database, cae schema
// ══════════════════════════════════════════════

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: process.env.PG_PORT || 5432,
  database: process.env.PG_DATABASE || 'mpower',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// ══════════════════════════════════════════════
// CONFIG — Allowed users and OAuth credentials
// ══════════════════════════════════════════════

const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

// Magic link tokens (in-memory — fine for single instance)
const magicTokens = new Map();

// ══════════════════════════════════════════════
// SESSION
// ══════════════════════════════════════════════

// Trust Render's proxy so secure cookies work behind HTTPS termination
app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Prevent browser/proxy caching of HTML pages — always serve fresh
app.use((req, res, next) => {
  if (req.accepts('html')) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

// Local dev bypass — auto-login when no OAuth configured
// Must be BEFORE any route definitions so all routes see the authenticated user
if (!process.env.GOOGLE_CLIENT_ID && !process.env.MICROSOFT_CLIENT_ID) {
  app.use((req, res, next) => {
    if (!req.isAuthenticated()) {
      req.login({ id: 'dev', email: 'tpmanzano@gmail.com', name: 'Dev User', provider: 'dev' }, () => {});
    }
    next();
  });
}

// ══════════════════════════════════════════════
// PASSPORT SERIALIZATION
// ══════════════════════════════════════════════

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ══════════════════════════════════════════════
// CHECK ALLOWED
// ══════════════════════════════════════════════

function isAllowed(email) {
  if (!email) return false;
  const lower = email.toLowerCase();
  // If no allowed list configured, allow all authenticated users
  if (ALLOWED_EMAILS.length === 0) return true;
  return ALLOWED_EMAILS.includes(lower);
}

// ══════════════════════════════════════════════
// GOOGLE OAUTH
// ══════════════════════════════════════════════

const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${BASE_URL}/auth/google/callback`
  }, (accessToken, refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value || profile._json?.email;
    console.log('[Google Auth]', JSON.stringify({ id: profile.id, email, name: profile.displayName, emailsRaw: profile.emails }));
    if (!isAllowed(email)) {
      return done(null, false, { message: 'Access denied' });
    }
    done(null, {
      id: profile.id,
      email: email || 'unknown',
      name: profile.displayName || 'User',
      photo: profile.photos?.[0]?.value,
      provider: 'google'
    });
  }));

  app.get('/auth/google', passport.authenticate('google', {
    scope: ['profile', 'email']
  }));

  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login?error=denied' }),
    (req, res) => res.redirect('/')
  );
}

// ══════════════════════════════════════════════
// MICROSOFT OAUTH
// ══════════════════════════════════════════════

if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
  passport.use(new MicrosoftStrategy({
    clientID: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    callbackURL: `${BASE_URL}/auth/microsoft/callback`,
    scope: ['user.read'],
    tenant: 'common'
  }, (accessToken, refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value || profile._json?.mail || profile._json?.userPrincipalName;
    if (!isAllowed(email)) {
      return done(null, false, { message: 'Access denied' });
    }
    done(null, {
      id: profile.id,
      email,
      name: profile.displayName,
      photo: null,
      provider: 'microsoft'
    });
  }));

  app.get('/auth/microsoft', passport.authenticate('microsoft'));

  app.get('/auth/microsoft/callback',
    passport.authenticate('microsoft', { failureRedirect: '/login?error=denied' }),
    (req, res) => res.redirect('/')
  );
}

// ══════════════════════════════════════════════
// MAGIC LINK
// ══════════════════════════════════════════════

app.post('/auth/magic-link', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!email || !isAllowed(email)) {
    return res.json({ success: false, message: 'Access denied — email not authorized.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  magicTokens.set(token, { email, expires: Date.now() + 15 * 60 * 1000 }); // 15 min

  // TODO: Send email via Gmail API with the magic link
  // For now, log the link (development mode)
  const link = `${BASE_URL}/auth/magic-link/verify?token=${token}`;
  console.log(`[Magic Link] ${email}: ${link}`);

  res.json({ success: true, message: 'Login link sent to your email. Check your inbox.' });
});

app.get('/auth/magic-link/verify', (req, res) => {
  const { token } = req.query;
  const record = magicTokens.get(token);

  if (!record || Date.now() > record.expires) {
    magicTokens.delete(token);
    return res.redirect('/login?error=expired');
  }

  magicTokens.delete(token);
  req.login({
    id: record.email,
    email: record.email,
    name: record.email.split('@')[0],
    photo: null,
    provider: 'magic-link'
  }, (err) => {
    if (err) return res.redirect('/login?error=failed');
    res.redirect('/');
  });
});

// ══════════════════════════════════════════════
// AUTH MIDDLEWARE
// ══════════════════════════════════════════════

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

// ══════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════

// Login page — always public
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Logout
app.get('/auth/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/login');
  });
});

// API — current user
app.get('/api/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// Static assets — public (CSS, JS, images)
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

// ══════════════════════════════════════════════
// DRE LOOKUP API — native proxy (no iframe)
// Source: California DRE public licensee database
// ══════════════════════════════════════════════

const DRE_SEARCH_URL = 'https://www2.dre.ca.gov/publicasp/pplinfo.asp?start=1';

app.post('/api/dre-lookup', requireAuth, async (req, res) => {
  const licenseId = (req.body.license_id || '').trim();

  if (!licenseId || !/^\d{1,8}$/.test(licenseId)) {
    return res.status(400).json({ error: 'Invalid license number. Digits only, max 8 characters.' });
  }

  try {
    const params = new URLSearchParams();
    params.append('h_nextstep', 'SEARCH');
    params.append('LICENSEE_NAME', '');
    params.append('CITY_STATE', '');
    params.append('LICENSE_ID', licenseId);

    const dreResp = await fetch(DRE_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!dreResp.ok) {
      return res.status(502).json({ error: `DRE site returned status ${dreResp.status}` });
    }

    const html = await dreResp.text();

    if (html.includes('No records found') || !html.includes('License Type:')) {
      return res.status(404).json({ error: `No records found for license ID: ${licenseId}` });
    }

    // Extract result section
    const match = html.match(
      /License information taken[\s\S]*?Public information request complete\s*(?:<<<<|&lt;&lt;&lt;&lt;)/
    );
    let content = match ? match[0] : html;

    // Rewrite relative URLs to absolute
    content = content.replace(/HREF\s*=\s*"\/static\//gi, 'HREF = "https://www2.dre.ca.gov/static/');
    content = content.replace(/HREF\s*=\s*"\/publicasp\//gi, 'HREF = "https://www2.dre.ca.gov/publicasp/');
    content = content.replace(/href\s*=\s*'\/static\//gi, "href='https://www2.dre.ca.gov/static/");
    content = content.replace(/href\s*=\s*'\/publicasp\//gi, "href='https://www2.dre.ca.gov/publicasp/");

    // Extract name
    const nameMatch = html.match(/<strong>Name:<\/strong>[\s\S]*?<\/td>\s*<td>[\s\S]*?>([\w,\s]+)</);
    const name = nameMatch ? nameMatch[1].trim() : '';

    res.json({ html: content, name, license_id: licenseId });

  } catch (err) {
    res.status(502).json({ error: `Could not reach DRE site: ${err.message}` });
  }
});

// ══════════════════════════════════════════════
// REPORT API ROUTES
// Source: PostgreSQL mpower.web schema (materialized from cae gold views)
// ══════════════════════════════════════════════

// Pipeline summary — active escrows by phase
// Source: web.escrow_complete (materialized from cae.gold_vw_escrow_complete)
// Filters: Escrow Category=Escrow, Escrow Status=O (Open), Bin Status=Active
// Matches: ggl_vw_escrow_summary filter logic
app.get('/api/reports/pipeline-summary', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT "Bin Phase" as phase, COUNT(*) as count,
        COALESCE(SUM("Fees Total"), 0) as total_value
      FROM web.escrow_complete
      WHERE "Escrow Category" = 'Escrow'
        AND "Escrow Status" = 'O'
        AND "Bin Status" = 'Active'
      GROUP BY "Bin Phase"
      ORDER BY CASE "Bin Phase"
        WHEN 'Opening' THEN 1 WHEN 'Processing' THEN 2
        WHEN 'Funding' THEN 3 WHEN 'Closing' THEN 4 END
    `);
    const total = result.rows.reduce((acc, r) => ({
      count: acc.count + parseInt(r.count),
      value: acc.value + parseFloat(r.total_value)
    }), { count: 0, value: 0 });
    res.json({ phases: result.rows, total });
  } catch (err) {
    console.error('Pipeline summary error:', err.message);
    res.status(500).json({ error: 'Data unavailable', detail: err.message });
  }
});

// Open escrows — detailed table
// Source: web.escrow_complete (materialized from cae.gold_vw_escrow_complete)
// Filters: Escrow Category=Escrow, Escrow Status=O (Open), Bin Status=Active
// Matches: ggl_vw_escrow_summary filter logic
app.get('/api/reports/open-escrows', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT "Escrow Number" as escrow_number,
        "Open Date"::text as open_date,
        "Bin Phase" as phase,
        "Property Address" as address,
        "Escrow Officer" as officer,
        "Assigned To" as assigned_to,
        "Listing Agent 1" as listing_agent,
        "Selling Agent 1" as selling_agent,
        "Fees Total" as fees_total,
        "Tasks Completed" as tasks_done,
        "Tasks Total" as tasks_total,
        "Number of Days" as days_open
      FROM web.escrow_complete
      WHERE "Escrow Category" = 'Escrow'
        AND "Escrow Status" = 'O'
        AND "Bin Status" = 'Active'
      ORDER BY "Open Date" DESC
    `);
    res.json({ escrows: result.rows, count: result.rowCount });
  } catch (err) {
    console.error('Open escrows error:', err.message);
    res.status(500).json({ error: 'Data unavailable', detail: err.message });
  }
});

// Processor workload — escrows per assigned processor
// Source: web.escrow_complete (materialized from cae.gold_vw_escrow_complete)
// Filters: Escrow Category=Escrow, Escrow Status=O (Open), Bin Status=Active
// Matches: ggl_vw_escrow_summary filter logic
app.get('/api/reports/officer-workload', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COALESCE("Assigned To", 'Unassigned') as officer,
        COUNT(*) as count,
        COALESCE(SUM("Fees Total"), 0) as total_value,
        SUM(CASE WHEN "Bin Phase" = 'Opening' THEN 1 ELSE 0 END) as opening,
        SUM(CASE WHEN "Bin Phase" = 'Processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN "Bin Phase" = 'Funding' THEN 1 ELSE 0 END) as funding,
        SUM(CASE WHEN "Bin Phase" = 'Closing' THEN 1 ELSE 0 END) as closing
      FROM web.escrow_complete
      WHERE "Escrow Category" = 'Escrow'
        AND "Escrow Status" = 'O'
        AND "Bin Status" = 'Active'
      GROUP BY "Assigned To"
      ORDER BY COUNT(*) DESC
    `);
    res.json({ officers: result.rows });
  } catch (err) {
    console.error('Officer workload error:', err.message);
    res.status(500).json({ error: 'Data unavailable', detail: err.message });
  }
});

// ══════════════════════════════════════════════
// ADMIN API ROUTES — database inventory (Tom only)
// ══════════════════════════════════════════════

app.get('/api/admin/view-inventory', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        v.table_name as name,
        CASE
          WHEN v.table_name LIKE 'dim_%' THEN 'Dimension'
          WHEN v.table_name LIKE 'ggl_%' THEN 'Google'
          WHEN v.table_name LIKE 'gold_%' THEN 'Gold'
          WHEN v.table_name LIKE 'silver_%' THEN 'Silver'
          WHEN v.table_name LIKE 'lgcy_%' THEN 'Legacy'
          ELSE 'Other'
        END as layer,
        (SELECT count FROM (SELECT reltuples::bigint as count FROM pg_class WHERE relname = v.table_name) x) as row_estimate,
        (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_schema = v.table_schema AND c.table_name = v.table_name) as columns,
        CASE WHEN w.table_name IS NOT NULL THEN 'Yes' ELSE 'No' END as materialized,
        CASE WHEN w.table_name IS NOT NULL THEN 'web.' || w.table_name ELSE '' END as web_table
      FROM information_schema.views v
      LEFT JOIN information_schema.tables w ON w.table_schema = 'web' AND w.table_name = v.table_name
      WHERE v.table_schema = 'cae'
      ORDER BY
        CASE
          WHEN v.table_name LIKE 'silver_%' THEN 1
          WHEN v.table_name LIKE 'gold_%' THEN 2
          WHEN v.table_name LIKE 'dim_%' THEN 3
          WHEN v.table_name LIKE 'ggl_%' THEN 4
          WHEN v.table_name LIKE 'lgcy_%' THEN 5
          ELSE 6
        END, v.table_name
    `);

    // Also get web schema tables with actual counts
    const webResult = await pool.query(`
      SELECT table_name, pg_total_relation_size('web.' || table_name) as size_bytes
      FROM information_schema.tables
      WHERE table_schema = 'web' AND table_type = 'BASE TABLE'
    `);
    const webTables = {};
    webResult.rows.forEach(r => { webTables[r.table_name] = r.size_bytes; });

    res.json({ views: result.rows, webTables });
  } catch (err) {
    console.error('View inventory error:', err.message);
    res.status(500).json({ error: 'Database unavailable', detail: err.message });
  }
});

// ══════════════════════════════════════════════
// PRODUCTION / MANAGEMENT REPORTS
// Source: web.escrow_complete
// ══════════════════════════════════════════════

// Monthly production — closings, fees, volume by month
app.get('/api/reports/production-monthly', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT "Close Date Year"::text || '-' || "Close Date Month MM" as month,
        "Close Date Year" as year,
        "Close Date Month MM" as month_num,
        COUNT(*) as closed,
        COALESCE(SUM("Fees Total"), 0) as fees,
        COALESCE(SUM("Consideration"), 0) as volume
      FROM web.escrow_complete
      WHERE "Escrow Status" = 'C' AND "Escrow Category" = 'Escrow'
        AND "Close Date Year" >= 2025
      GROUP BY "Close Date Year", "Close Date Month MM"
      ORDER BY "Close Date Year", "Close Date Month MM"
    `);
    res.json({ months: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Data unavailable', detail: err.message });
  }
});

// Agent production — closings and fees by agent/team
app.get('/api/reports/production-agents', requireAuth, async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear().toString();
    const result = await pool.query(`
      SELECT COALESCE("Owner Team Override", 'Unassigned') as team,
        COALESCE("List Agent Override", 'Unknown') as agent,
        COUNT(*) as closed,
        COALESCE(SUM("Fees Total"), 0) as fees,
        COALESCE(SUM("Consideration"), 0) as volume,
        COALESCE(AVG("Consideration"), 0) as avg_price
      FROM web.escrow_complete
      WHERE "Escrow Status" = 'C' AND "Escrow Category" = 'Escrow'
        AND "Close Date Year" = $1::int
      GROUP BY "Owner Team Override", "List Agent Override"
      ORDER BY COUNT(*) DESC
    `, [year]);
    res.json({ agents: result.rows, year });
  } catch (err) {
    res.status(500).json({ error: 'Data unavailable', detail: err.message });
  }
});

// Recent closings — detail (by year or days)
app.get('/api/reports/recent-closings', requireAuth, async (req, res) => {
  try {
    let result;
    if (req.query.year) {
      result = await pool.query(`
        SELECT "Escrow Number" as escrow_number,
          "Close Date"::text as close_date,
          "Close Date Month MM" as month,
          "Property Address" as address,
          COALESCE("List Agent Override", "Listing Agent 1") as agent,
          "Owner Team Override" as team,
          "Consideration" as price,
          "Fees Total" as fees,
          "Escrow Type Desc" as type
        FROM web.escrow_complete
        WHERE "Escrow Status" = 'C' AND "Escrow Category" = 'Escrow'
          AND "Close Date Year" = $1::int
        ORDER BY "Close Date" DESC
      `, [req.query.year]);
      res.json({ closings: result.rows, count: result.rowCount, year: req.query.year });
    } else {
      const days = parseInt(req.query.days) || 30;
      result = await pool.query(`
        SELECT "Escrow Number" as escrow_number,
          "Close Date"::text as close_date,
          "Close Date Month MM" as month,
          "Property Address" as address,
          COALESCE("List Agent Override", "Listing Agent 1") as agent,
          "Owner Team Override" as team,
          "Consideration" as price,
          "Fees Total" as fees,
          "Escrow Type Desc" as type
        FROM web.escrow_complete
        WHERE "Escrow Status" = 'C' AND "Escrow Category" = 'Escrow'
          AND "Close Date" >= CURRENT_DATE - $1
        ORDER BY "Close Date" DESC
      `, [days]);
      res.json({ closings: result.rows, count: result.rowCount, days });
    }
  } catch (err) {
    res.status(500).json({ error: 'Data unavailable', detail: err.message });
  }
});

// Template assignments — progress item templates
// Source: web.rbj_template
app.get('/api/reports/templates', requireAuth, async (req, res) => {
  try {
    const templateType = req.query.type || 'Sale';
    const result = await pool.query(`
      SELECT progress_item as item,
        party,
        days_in_processing as days,
        importance,
        sort_order,
        gate_type
      FROM web.rbj_template
      WHERE template_type = $1
      ORDER BY sort_order
    `, [templateType]);

    // Get available template types
    const types = await pool.query(`
      SELECT DISTINCT template_type FROM web.rbj_template ORDER BY template_type
    `);

    res.json({
      items: result.rows,
      count: result.rowCount,
      type: templateType,
      available_types: types.rows.map(r => r.template_type)
    });
  } catch (err) {
    console.error('Template error:', err.message);
    res.status(500).json({ error: 'Data unavailable', detail: err.message });
  }
});

// Task detail for a single escrow
// Source: web.task_complete (materialized from cae.gold_vw_task_complete)
app.get('/api/reports/tasks/:escrowNumber', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT "Progress Description" as description,
        "Assigned To" as assigned_to,
        "Sent On Date"::text as sent_date,
        "Comp/Recd Date"::text as completed_date,
        "Due Date"::text as due_date,
        "Send By Date"::text as send_by_date,
        "On Letter" as on_letter,
        "Progress Notes" as notes,
        "Task Category" as category,
        "Task Party" as party,
        template_days,
        template_importance,
        template_sort_order,
        template_gate_type,
        process_stage,
        item_category,
        CASE WHEN "Comp/Recd Date" IS NOT NULL THEN true ELSE false END as is_completed
      FROM web.task_complete
      WHERE "Escrow Number" = $1
      ORDER BY
        CASE WHEN "Comp/Recd Date" IS NOT NULL THEN 1 ELSE 0 END,
        "Due Date" ASC NULLS LAST,
        "Progress Description"
    `, [req.params.escrowNumber]);
    res.json({ tasks: result.rows, escrow_number: req.params.escrowNumber, count: result.rowCount });
  } catch (err) {
    console.error('Task detail error:', err.message);
    res.status(500).json({ error: 'Data unavailable', detail: err.message });
  }
});

// Google Drive inventory — shared documents
app.get('/api/admin/google-drive-inventory', requireAdmin, async (req, res) => {
  try {
    const { exec } = require('child_process');
    const scriptPath = path.join(__dirname, 'scripts', 'drive_inventory.py');
    const result = await new Promise((resolve, reject) => {
      exec('python "' + scriptPath + '"',
        { timeout: 20000 },
        (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout.trim());
        }
      );
    });
    res.json({ files: JSON.parse(result) });
  } catch (err) {
    console.error('Drive inventory error:', err.message);
    res.status(500).json({ error: 'Google Drive unavailable', detail: err.message });
  }
});

// Dev bypass removed from here — moved earlier in the file

// Protected pages
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dre-lookup', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dre-lookup.html'));
});

app.get('/reports', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reports.html'));
});

// ══════════════════════════════════════════════
// OFFICER PAGES — restricted per officer
// ══════════════════════════════════════════════

const OFFICER_ACCESS = {
  erin: ['erin@caescrow.net', 'tpmanzano@gmail.com', 'tom@mpoweranalytics.com'],
};

function requireOfficerAccess(officer) {
  return (req, res, next) => {
    if (!req.isAuthenticated()) return res.redirect('/login');
    const email = (req.user.email || '').toLowerCase();
    const allowed = OFFICER_ACCESS[officer] || [];
    if (allowed.includes(email)) return next();
    res.status(403).send('Access restricted');
  };
}

app.get('/officers/erin', requireOfficerAccess('erin'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'officers', 'erin.html'));
});

// ══════════════════════════════════════════════
// SANDBOX — Tom only (feature development workspace)
// ══════════════════════════════════════════════

const SANDBOX_ALLOWED = ['tpmanzano@gmail.com', 'tom@mpoweranalytics.com'];

function requireSandbox(req, res, next) {
  if (!req.isAuthenticated()) return res.redirect('/login');
  const email = (req.user.email || '').toLowerCase();
  if (SANDBOX_ALLOWED.includes(email)) return next();
  res.status(403).send('Access restricted');
}

app.get('/sandbox', requireSandbox, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sandbox.html'));
});

// ══════════════════════════════════════════════
// ADMIN — Tom only
// ══════════════════════════════════════════════

const ADMIN_ALLOWED = ['tpmanzano@gmail.com', 'tom@mpoweranalytics.com'];

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.redirect('/login');
  const email = (req.user.email || '').toLowerCase();
  if (ADMIN_ALLOWED.includes(email)) return next();
  res.status(403).send('Access restricted');
}

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ══════════════════════════════════════════════
// AMY'S CORNER — restricted access
// ══════════════════════════════════════════════

// Access tiers: All (any auth), Management (Amy + Erin + Tom), Executive (Amy + Tom)
const EXECUTIVE = ['amyc@kw.com', 'tpmanzano@gmail.com', 'tom@mpoweranalytics.com'];
const MANAGEMENT = ['amyc@kw.com', 'erin@caescrow.net', 'tpmanzano@gmail.com', 'tom@mpoweranalytics.com'];

function requireExecutive(req, res, next) {
  if (!req.isAuthenticated()) return res.redirect('/login');
  if (EXECUTIVE.includes((req.user.email || '').toLowerCase())) return next();
  res.status(403).send('Access restricted');
}

function requireManagement(req, res, next) {
  if (!req.isAuthenticated()) return res.redirect('/login');
  if (MANAGEMENT.includes((req.user.email || '').toLowerCase())) return next();
  res.status(403).send('Access restricted');
}

app.get('/amy', requireExecutive, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'amy.html'));
});

app.get('/production', requireExecutive, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'management.html'));
});

app.get('/templates', requireManagement, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'templates.html'));
});

app.get('/owner-production', requireManagement, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'owner-production.html'));
});

// ══════════════════════════════════════════════
// START
// ══════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`CAE Portal running on port ${PORT}`);
  console.log(`Auth providers: ${[
    process.env.GOOGLE_CLIENT_ID ? 'Google' : null,
    process.env.MICROSOFT_CLIENT_ID ? 'Microsoft' : null,
    'Magic Link'
  ].filter(Boolean).join(', ')}`);
  console.log(`Allowed emails: ${ALLOWED_EMAILS.length ? ALLOWED_EMAILS.join(', ') : '(all authenticated users)'}`);
});
