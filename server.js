const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    const email = profile.emails?.[0]?.value;
    if (!isAllowed(email)) {
      return done(null, false, { message: 'Access denied' });
    }
    done(null, {
      id: profile.id,
      email,
      name: profile.displayName,
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

// Protected pages
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dre-lookup', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dre-lookup.html'));
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
