'use strict';

const gamemodes = require('../../shared/gamemodes');
const tiers = require('../../shared/tiers');

/**
 * Read-only projections of the shared database for the website.
 *
 * Everything the site shows comes from here, straight out of the same tables
 * the bot writes. There is no export step, no players.json, and no chance of
 * the site showing a stale copy of a result the bot already saved.
 */

const TIER_POINTS = tiers.POINTS;

/**
 * Every player with at least one tier, in the shape the front end expects:
 *   { n: name, t: { "Sword": "HT3", ... }, pts: 26 }
 *
 * Mode names are DISPLAY names, because that is what the site renders and what
 * the tier badges are keyed by.
 */
function playersForSite(db) {
  const rows = db
    .prepare(
      `SELECT p.uuid, p.username, t.gamemode, t.tier, t.tested_at
         FROM player_tiers t
         JOIN players p ON p.uuid = t.uuid
        ORDER BY p.username_lower`
    )
    .all();

  const byPlayer = new Map();

  for (const row of rows) {
    const mode = gamemodes.displayOf(row.gamemode);
    if (!byPlayer.has(row.uuid)) {
      byPlayer.set(row.uuid, {
        uuid: row.uuid,
        n: row.username,
        t: {},
        pts: 0,
        lastTestedAt: 0,
      });
    }
    const player = byPlayer.get(row.uuid);
    player.t[mode] = row.tier;
    player.pts += TIER_POINTS[row.tier] || 0;
    player.lastTestedAt = Math.max(player.lastTestedAt, row.tested_at || 0);
  }

  return [...byPlayer.values()].sort((a, b) => b.pts - a.pts || a.n.localeCompare(b.n));
}

/** Headline counters for the home page. */
function siteCounts(db) {
  return {
    players: db.prepare('SELECT COUNT(DISTINCT uuid) AS c FROM player_tiers').get().c,
    tiers: db.prepare('SELECT COUNT(*) AS c FROM player_tiers').get().c,
    modes: gamemodes.all().length,
  };
}

/** Active products for the store. Checkout is disabled, but the data is real. */
function products(db) {
  return db
    .prepare(
      `SELECT key, name, suit, price_cents, currency, billing_interval, perks_json
         FROM products WHERE active = 1 ORDER BY sort_order, id`
    )
    .all()
    .map((p) => {
      let perks = [];
      try {
        perks = JSON.parse(p.perks_json);
      } catch {
        perks = [];
      }
      return {
        key: p.key,
        name: p.name,
        suit: p.suit,
        price: p.price_cents / 100,
        currency: p.currency,
        monthly: p.billing_interval === 'month',
        perks,
      };
    });
}

/** Everything the admin dashboard needs, read-only. */
function adminStats(db) {
  const now = Date.now();
  return {
    players: db.prepare('SELECT COUNT(DISTINCT uuid) AS c FROM player_tiers').get().c,
    tiers: db.prepare('SELECT COUNT(*) AS c FROM player_tiers').get().c,
    linked: db.prepare('SELECT COUNT(*) AS c FROM linked_accounts').get().c,
    openTickets: db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE status = 'open'").get().c,
    activePunishments: db
      .prepare('SELECT COUNT(*) AS c FROM punishments WHERE active = 1 AND (expires_at IS NULL OR expires_at > ?)')
      .get(now).c,
    recentAudit: db
      .prepare('SELECT actor_id, actor_kind, action, subject, created_at FROM audit_log ORDER BY id DESC LIMIT 12')
      .all(),
    recentResults: db
      .prepare(
        `SELECT username, gamemode, tier, created_at FROM tier_history
          ORDER BY id DESC LIMIT 10`
      )
      .all(),
  };
}

module.exports = { playersForSite, siteCounts, products, adminStats };
