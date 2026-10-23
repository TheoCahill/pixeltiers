'use strict';

/**
 * Minimal Discord OAuth2 (identify only).
 *
 * The website asks Discord who the visitor is; it never asks for guilds or
 * anything it does not need. Admin rights are decided by DISCORD_ADMIN_IDS,
 * not by anything the browser sends.
 */

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const USER_URL = 'https://discord.com/api/users/@me';

function redirectUri(config) {
  const base = String(config.PUBLIC_URL || '').replace(/\/+$/, '');
  const path = config.DISCORD_OAUTH_REDIRECT || '/auth/discord/callback';
  return `${base}${path}`;
}

function authorizeUrl(config, state) {
  const params = new URLSearchParams({
    client_id: config.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri(config),
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'none',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function exchangeCode(config, code) {
  const body = new URLSearchParams({
    client_id: config.DISCORD_CLIENT_ID,
    client_secret: config.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(config),
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Discord rejected the login (${response.status})${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return response.json();
}

async function fetchUser(accessToken) {
  const response = await fetch(USER_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Discord user lookup failed (${response.status})`);
  return response.json();
}

/** Discord avatar URL, with a deterministic fallback for users without one. */
function avatarUrl(user) {
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${
      String(user.avatar).startsWith('a_') ? 'gif' : 'png'
    }?size=128`;
  }
  const index = Number(BigInt(user.id) % 5n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

module.exports = { redirectUri, authorizeUrl, exchangeCode, fetchUser, avatarUrl };
