'use strict';

/**
 * A tiny in-memory rate limiter for the public plugin endpoints.
 *
 * Verification codes are 6 characters, so without a limit the public /verify
 * endpoint is a guessing oracle. This keeps one IP to a few attempts a minute;
 * the codes themselves also expire after 15 minutes.
 *
 * Single process, so a plain Map is enough. If this ever runs multi-process,
 * move it to the bot (which is the single writer) or a shared store.
 */

function createRateLimit({ windowMs = 60_000, max = 20 } = {}) {
  const hits = new Map();

  function prune(now) {
    for (const [key, entry] of hits) {
      if (entry.reset <= now) hits.delete(key);
    }
  }

  return function middleware(req, res, next) {
    const now = Date.now();
    prune(now);

    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const entry = hits.get(key) || { count: 0, reset: now + windowMs };
    entry.count++;
    hits.set(key, entry);

    if (entry.count > max) {
      const retry = Math.max(1, Math.ceil((entry.reset - now) / 1000));
      res.setHeader('retry-after', String(retry));
      return res.status(429).json({ ok: false, error: 'too many attempts, try again shortly' });
    }
    next();
  };
}

module.exports = { createRateLimit };
