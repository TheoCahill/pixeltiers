'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');

const { loadConfig } = require('../shared/config');
const { openDatabase } = require('../shared/db');
const logger = require('../shared/logger');
const gamemodes = require('../shared/gamemodes');
const tiers = require('../shared/tiers');

const data = require('./lib/data');
const session = require('./lib/session');
const discord = require('./lib/discord');
const { callBot } = require('./lib/botApi');
const { createRateLimit } = require('./lib/rateLimit');

/**
 * The public website.
 *
 * It opens the shared SQLite file READ-ONLY and never writes to it. Tier resets
 * and punishments in the admin view are posted to the bot's control API, so the
 * bot remains the only writer, which is what keeps the site and Discord from
 * ever disagreeing about a result.
 *
 * The page itself is one server-rendered shell with hash routing (#/home,
 * #/tiers, #/store, #/p/<name>), matching the design of the previous site.
 */

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
};

function createApp({ db, config, botCall = callBot }) {
  const app = express();
  const secureCookies = String(config.PUBLIC_URL || '').startsWith('https://');
  const adminIds = new Set(
    String(config.DISCORD_ADMIN_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );

  app.disable('x-powered-by');
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');

  app.use((req, res, next) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    next();
  });
  app.use('/assets', express.static(path.join(__dirname, 'public', 'assets'), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));

  // ----------------------------------------------------------------
  // helpers
  // ----------------------------------------------------------------

  function currentUser(req) {
    const s = session.readSession(req, config.SESSION_SECRET);
    if (!s) return null;
    return {
      id: s.id,
      username: s.username,
      avatar: s.avatar,
      admin: !!s.admin,
      csrf: s.csrf,
    };
  }

  function bootFor(user) {
    return {
      discordInvite: config.DISCORD_INVITE_URL || '',
      refreshSeconds: 20,
      modes: gamemodes.all().map((g) => ({ name: g.display, icon: g.icon, key: g.key })),
      tiers: tiers.TIERS,
      points: tiers.POINTS,
      titles: tiers.TITLES,
      products: data.products(db),
      user: user ? { name: user.username, avatar: user.avatar, admin: user.admin } : null,
    };
  }

  function requireAdmin(req, res, next) {
    const user = currentUser(req);
    if (!user) return res.redirect('/auth/discord');
    if (!user.admin) {
      return res.status(403).render('error', {
        title: 'Not allowed',
        message: 'This account is not on the administrator list for the site.',
      });
    }
    req.user = user;
    next();
  }

  function checkCsrf(req, res, next) {
    const token = req.body?.csrf || req.get('x-csrf-token');
    if (!token || !req.user?.csrf || token !== req.user.csrf) {
      return res.status(403).render('error', {
        title: 'Expired form',
        message: 'That form expired or was tampered with. Reload the admin page and try again.',
      });
    }
    next();
  }

  function fail(res, message) {
    return res.status(400).render('error', { title: 'Action failed', message });
  }

  // ----------------------------------------------------------------
  // public pages + data
  // ----------------------------------------------------------------

  app.get('/', (req, res) => {
    const user = currentUser(req);
    res.render('index', {
      user,
      boot: bootFor(user),
      counts: data.siteCounts(db),
    });
  });

  app.get('/api/players', (req, res) => {
    res.setHeader('cache-control', 'no-store');
    const players = data.playersForSite(db);
    res.json({
      ok: true,
      updatedAt: Date.now(),
      counts: data.siteCounts(db),
      players,
    });
  });

  app.get('/healthz', (req, res) => {
    try {
      db.prepare('SELECT 1 AS x').get();
      res.json({ ok: true, service: 'pixeltiers-web' });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ----------------------------------------------------------------
  // Minecraft plugin endpoints
  //
  // The plugin's configured base URL is this site's /api/plugin. Only the three
  // player-facing routes are exposed, never the /admin/* routes, and the
  // plugin's own bearer secret is forwarded untouched, so the website does not
  // become a way around the bot's authentication.
  // ----------------------------------------------------------------

  const verifyLimit = createRateLimit({ windowMs: 60_000, max: 20 });

  function proxyPlugin(target) {
    return async (req, res) => {
      const host = config.CONTROL_API_HOST || '127.0.0.1';
      const port = config.CONTROL_API_PORT || 3001;
      const path = typeof target === 'function' ? target(req) : target;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);

      try {
        const upstream = await fetch(`http://${host}:${port}${path}`, {
          method: req.method,
          headers: {
            authorization: req.get('authorization') || '',
            ...(req.method === 'POST' ? { 'content-type': 'application/json' } : {}),
          },
          body: req.method === 'POST' ? JSON.stringify(req.body || {}) : undefined,
          signal: controller.signal,
        });

        const text = await upstream.text();
        res
          .status(upstream.status)
          .set('content-type', upstream.headers.get('content-type') || 'application/json')
          .set('cache-control', 'no-store')
          .send(text);
      } catch {
        res.status(502).json({ ok: false, error: 'the bot is unavailable' });
      } finally {
        clearTimeout(timer);
      }
    };
  }

  app.get('/api/plugin/health', proxyPlugin('/health'));
  app.post('/api/plugin/verify', verifyLimit, express.json({ limit: '16kb' }), proxyPlugin('/verify'));
  app.get(
    '/api/plugin/player/:uuid/tiers',
    proxyPlugin((req) => `/player/${encodeURIComponent(req.params.uuid)}/tiers`)
  );

  // ----------------------------------------------------------------
  // Discord OAuth
  // ----------------------------------------------------------------

  app.get('/auth/discord', (req, res) => {
    if (!config.DISCORD_CLIENT_ID || !config.DISCORD_CLIENT_SECRET) {
      return res.status(503).render('error', {
        title: 'Login not configured',
        message: 'DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET are not set, so staff login is unavailable.',
      });
    }

    const state = crypto.randomBytes(16).toString('hex');
    session.setState(res, state, { secure: secureCookies });
    res.redirect(discord.authorizeUrl(config, state));
  });

  app.get(config.DISCORD_OAUTH_REDIRECT || '/auth/discord/callback', async (req, res) => {
    const expected = session.readState(req);
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).render('error', {
        title: 'Login cancelled',
        message: `Discord returned: ${String(error).slice(0, 100)}`,
      });
    }
    if (!code || !state || !expected || state !== expected) {
      return res.status(400).render('error', {
        title: 'Login failed',
        message: 'The login state did not match. Start again from the admin link.',
      });
    }

    try {
      const token = await discord.exchangeCode(config, String(code));
      const profile = await discord.fetchUser(token.access_token);

      const user = {
        id: profile.id,
        username: profile.global_name || profile.username,
        avatar: discord.avatarUrl(profile),
        admin: adminIds.has(profile.id),
        csrf: crypto.randomBytes(20).toString('hex'),
      };

      session.setSession(res, user, config.SESSION_SECRET, { secure: secureCookies });
      logger.info(`website login: ${user.username} (${user.id}) admin=${user.admin}`);
      res.redirect(user.admin ? '/admin' : '/');
    } catch (err) {
      logger.error('discord login failed:', err.message);
      res.status(502).render('error', {
        title: 'Login failed',
        message: 'Discord did not complete the login. Please try again.',
      });
    }
  });

  app.post('/auth/logout', (req, res) => {
    session.clearSession(res, { secure: secureCookies });
    res.redirect('/');
  });

  // ----------------------------------------------------------------
  // admin (OAuth-gated; every write is forwarded to the bot)
  // ----------------------------------------------------------------

  app.get('/admin', requireAdmin, async (req, res) => {
    const overview = await botCall(config, '/admin/overview');

    res.render('admin', {
      user: req.user,
      stats: data.adminStats(db),
      overview: overview.ok ? overview.data : null,
      botError: overview.ok ? null : overview.error,
      message: req.query.ok || null,
      error: req.query.error || null,
      modes: gamemodes.all(),
      tiers: tiers.TIERS,
    });
  });

  app.post('/admin/reset', requireAdmin, checkCsrf, async (req, res) => {
    const { scope, gamemode, player, guildId } = req.body;
    if (!guildId) return fail(res, 'No server selected.');

    // The player field accepts a Minecraft name; resolve it to a uuid and a
    // Discord id from the shared database (read-only).
    let uuid = null;
    let playerId = null;
    if (scope === 'player') {
      const name = String(player || '').trim();
      if (!name) return fail(res, 'Enter the Minecraft username to reset.');
      const row = db
        .prepare(
          `SELECT p.uuid, la.discord_id
             FROM players p
             LEFT JOIN linked_accounts la ON la.uuid = p.uuid
            WHERE p.username_lower = ? LIMIT 1`
        )
        .get(name.toLowerCase());
      if (!row) return fail(res, `No player called **${name}** has been tested yet.`);
      uuid = row.uuid;
      playerId = row.discord_id || null;
    }

    const result = await botCall(config, '/admin/resettiers', {
      method: 'POST',
      body: {
        guildId,
        scope,
        gamemodeKey: gamemode || null,
        uuid,
        playerId,
        actorId: req.user.id,
      },
    });

    if (!result.ok) return fail(res, result.error);
    const d = result.data;
    return res.redirect(
      `/admin?ok=${encodeURIComponent(
        `Reset done: ${d.tiers} tier(s) and ${d.cooldowns} cooldown(s) cleared, ${d.rolesRemoved} role(s) removed. Backup: ${d.backup}`
      )}`
    );
  });

  app.post('/admin/punish', requireAdmin, checkCsrf, async (req, res) => {
    const { guildId, userId, type, reason, duration } = req.body;
    if (!guildId) return fail(res, 'No server selected.');
    if (!userId || !/^\d{5,25}$/.test(userId)) return fail(res, 'Enter the member\'s numeric Discord ID.');
    if (!reason || !reason.trim()) return fail(res, 'A reason is required.');

    const durationMs = duration ? require('../shared/store/punishments').parseDuration(duration) : null;
    if (duration && !durationMs) return fail(res, 'Could not read that duration. Use e.g. 30m, 2h, 7d.');

    const result = await botCall(config, '/admin/punishments', {
      method: 'POST',
      body: { guildId, userId, type, reason: reason.trim(), durationMs, actorId: req.user.id },
    });

    if (!result.ok) return fail(res, result.error);
    return res.redirect(
      `/admin?ok=${encodeURIComponent(`${type} recorded as case #${result.data.caseId}.`)}`
    );
  });

  app.post('/admin/unban', requireAdmin, checkCsrf, async (req, res) => {
    const { guildId, userId, scope } = req.body;
    if (!guildId) return fail(res, 'No server selected.');
    if (!userId || !/^\d{5,25}$/.test(userId)) return fail(res, 'Enter the member\'s numeric Discord ID.');

    const result = await botCall(config, '/admin/unban', {
      method: 'POST',
      body: { guildId, userId, scope: scope || 'all', actorId: req.user.id },
    });

    if (!result.ok) return fail(res, result.error);
    return res.redirect(
      `/admin?ok=${encodeURIComponent(`Lifted ${result.data.lifted.length} ban(s).`)}`
    );
  });

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' });
  });

  return app;
}

if (require.main === module) {
  const config = loadConfig('web');

  if (!config.DISCORD_ADMIN_IDS) {
    logger.warn('DISCORD_ADMIN_IDS is empty. Nobody can sign into /admin');
  }
  if (!config.PUBLIC_URL) {
    logger.warn('PUBLIC_URL is empty. Discord OAuth redirect URIs will be wrong');
  }

  const db = openDatabase(config.DATABASE_PATH, { readonly: true });
  const app = createApp({ db, config });

  app.listen(config.WEB_PORT, config.WEB_HOST, () => {
    logger.info(`website listening on http://${config.WEB_HOST}:${config.WEB_PORT}`);
  });
}

module.exports = { createApp };
