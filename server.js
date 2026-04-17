require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

const cron = require('node-cron');
const { initDb, dbAll } = require('./db');
const { sendEmail, certExpiryEmail } = require('./email');
const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payment');
const profileRoutes = require('./routes/profile');
const adminRoutes = require('./routes/admin');
const courseRoutes = require('./routes/course');
const certificateRoutes = require('./routes/certificate');
const eventsRoutes = require('./routes/events');
const stripeWebhook = require('./routes/stripeWebhook');
const chatRoutes = require('./routes/chat');
const compHistoryRoutes = require('./routes/compHistory');
const authMiddleware = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Refuse to run with placeholder secrets
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be at least 32 characters. Set it in .env');
  process.exit(1);
}

app.set('trust proxy', 1); // Required for accurate req.ip behind proxies

// --------------- Stripe webhook (raw body — must be before express.json) ---------------
app.post('/api/payment/webhook', express.raw({ type: 'application/json' }), stripeWebhook);

// --------------- Security middleware ---------------
const isDev = process.env.NODE_ENV !== 'production';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://usastreetlifting.org"],
      connectSrc: ["'self'", "https://usastreetlifting.org", "https://calendar.app.google"],
      frameSrc: ["'self'", "blob:"],
      mediaSrc: ["'self'", "https://pub-be06f36754244e97924aad36ac6257af.r2.dev"],
      // Disable HTTPS upgrade locally — the dev server runs on HTTP
      upgradeInsecureRequests: isDev ? null : [],
    },
  },
  // Don't send HSTS on localhost (it can get cached by browsers and break HTTP dev)
  strictTransportSecurity: isDev ? false : undefined,
}));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// Rate limiting – general
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Stricter rate limit on auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many attempts. Please try again later.' },
});

// --------------- Static files ---------------
app.use(express.static(path.join(__dirname, 'public')));

// Serve avatars from volume in production, fallback to public/avatars locally
if (process.env.DB_PATH) {
  const avatarDir = path.join(require('path').dirname(process.env.DB_PATH), 'avatars');
  if (!require('fs').existsSync(avatarDir)) require('fs').mkdirSync(avatarDir, { recursive: true });
  app.use('/avatars', express.static(avatarDir));
}

// --------------- API routes ---------------
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/payment', authMiddleware, paymentRoutes);
app.use('/api/profile', authMiddleware, profileRoutes);
app.use('/api/admin', authMiddleware, adminRoutes);
app.use('/api/course', authMiddleware, courseRoutes);
app.use('/api/certificate', authMiddleware, certificateRoutes);
app.use('/api/chat', authMiddleware, chatRoutes);
app.use('/api/comp-history', authMiddleware, compHistoryRoutes);

// Public listing (GET /api/events) is unauthenticated; register/unregister/my require auth
app.use('/api/events', (req, res, next) => {
  if (req.method === 'GET' && req.path === '/') return next();
  authMiddleware(req, res, next);
}, eventsRoutes);

// Public stats — certified judges count (from DB) + manually set counters
app.get('/api/stats', (req, res) => {
  const { dbGet, dbAll } = require('./db');
  const judges = dbGet(`SELECT value FROM settings WHERE key = 'certified_judges'`);
  const comps  = dbGet(`SELECT value FROM settings WHERE key = 'competitions_judged'`);
  const states = dbGet(`SELECT value FROM settings WHERE key = 'states_covered'`);
  res.json({
    certified_judges:    parseInt(judges?.value || 0),
    competitions_judged: parseInt(comps?.value  || 0),
    states_covered:      parseInt(states?.value || 0),
  });
});

// Protected route – returns current user info
app.get('/api/me', authMiddleware, (req, res) => {
  const { dbGet } = require('./db');
  const user = dbGet('SELECT id, email, name, is_admin, avatar FROM users WHERE id = ?', [req.user.id]);
  res.json({ user });
});

// Public judge directory
app.get('/api/judges', (req, res) => {
  const { dbAll } = require('./db');
  const judges = dbAll(
    `SELECT u.id, u.name, u.state, u.instagram, u.position, u.avatar,
            (SELECT COUNT(*) FROM comp_history ch WHERE ch.user_id = u.id) AS comps_judged,
            GROUP_CONCAT(c.level ORDER BY c.level) AS levels
     FROM users u
     JOIN certifications c ON c.user_id = u.id
     WHERE u.email_verified = 1 AND u.show_in_directory = 1 AND u.is_admin = 0
     GROUP BY u.id
     ORDER BY u.state, u.name`,
    []
  );
  res.json({ judges });
});

// Public judge profile
app.get('/api/judge/:id', (req, res) => {
  const { dbGet, dbAll } = require('./db');
  const user = dbGet(
    `SELECT u.id, u.name, u.state, u.avatar, u.instagram, u.position, u.experience,
            (SELECT COUNT(*) FROM comp_history ch WHERE ch.user_id = u.id) AS comps_judged
     FROM users u WHERE u.id = ? AND u.email_verified = 1 AND u.is_admin = 0`,
    [req.params.id]
  );
  if (!user) return res.status(404).json({ error: 'Judge not found.' });
  const certs = dbAll(
    `SELECT level, granted_at FROM certifications WHERE user_id = ? ORDER BY level`,
    [user.id]
  );
  const history = dbAll(
    `SELECT comp_name, comp_date, location, role FROM comp_history WHERE user_id = ? ORDER BY comp_date DESC`,
    [user.id]
  );
  res.json({ user, certs, history });
});

// SPA fallback – serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --------------- Start ---------------
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`USA Streetlifting server running on http://localhost:${PORT}`);
  });

  // Daily cron: check for certs expiring in ~30 days and send reminder
  cron.schedule('0 9 * * *', async () => {
    const soon = dbAll(
      `SELECT u.name, u.email, c.level, c.granted_at
       FROM certifications c
       JOIN users u ON u.id = c.user_id
       WHERE u.email_verified = 1`,
      []
    );
    const now = Date.now();
    for (const row of soon) {
      const expiry = new Date(row.granted_at);
      expiry.setFullYear(expiry.getFullYear() + 1);
      const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
      if (daysLeft === 30) {
        await sendEmail({
          to: row.email,
          subject: `Your Level ${row.level} USASL certification expires in 30 days`,
          html: certExpiryEmail(row.name, row.level, expiry.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })),
        });
        console.log(`Expiry reminder sent to ${row.email} for Level ${row.level}`);
      }
    }
  });
});
