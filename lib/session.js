'use strict';

const crypto = require('node:crypto');

/**
 * Stateless signed-cookie sessions.
 *
 * The website must never write to SQLite (the bot is the only writer), so
 * sessions cannot live in the `sessions` table. The cookie is a small JSON
 * payload plus an HMAC-SHA256 signature; anyone without SESSION_SECRET cannot
 * forge or edit it.
 */

const COOKIE_NAME = 'st_session';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;

  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function serialize(data, secret) {
  const payload = b64url(JSON.stringify(data));
  return `${payload}.${sign(payload, secret)}`;
}

/** @returns {object|null} the verified session, or null */
function readSession(req, secret) {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[COOKIE_NAME];
  if (!raw || typeof raw !== 'string') return null;

  const dot = raw.lastIndexOf('.');
  if (dot === -1) return null;

  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!safeEqual(sign(payload, secret), signature)) return null;

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!data || typeof data !== 'object') return null;
  if (!data.exp || data.exp < Date.now()) return null;
  return data;
}

function setSession(res, data, secret, { ttlMs = DEFAULT_TTL_MS, secure = false } = {}) {
  const value = serialize({ ...data, exp: Date.now() + ttlMs }, secret);
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(ttlMs / 1000)}`,
  ];
  if (secure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

function clearSession(res, { secure = false } = {}) {
  const attrs = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

/** Short-lived OAuth state, so a login cannot be replayed or CSRF'd. */
const STATE_COOKIE = 'st_oauth_state';

function setState(res, state, { secure = false } = {}) {
  const attrs = [
    `${STATE_COOKIE}=${encodeURIComponent(state)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=600',
  ];
  if (secure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

function readState(req) {
  return parseCookies(req.headers.cookie)[STATE_COOKIE] || null;
}

module.exports = {
  COOKIE_NAME,
  STATE_COOKIE,
  parseCookies,
  readSession,
  setSession,
  clearSession,
  setState,
  readState,
  serialize,
};
