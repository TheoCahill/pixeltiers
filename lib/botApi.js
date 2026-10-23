'use strict';

/**
 * Server-to-server calls from the website to the bot's control API.
 *
 * The browser never sees PLUGIN_API_SECRET and never chooses the URL: it posts a
 * form to this website, which validates the session and forwards a fixed call.
 * That is what keeps the bot the only process that writes to SQLite.
 */

function baseUrl(config) {
  const host = config.CONTROL_API_HOST || '127.0.0.1';
  const port = config.CONTROL_API_PORT || 3001;
  return `http://${host}:${port}`;
}

async function callBot(config, path, { method = 'GET', body = null, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(baseUrl(config) + path, {
      method,
      headers: {
        authorization: `Bearer ${config.PLUGIN_API_SECRET}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { ok: false, error: text.slice(0, 300) };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: payload?.error || `the bot API returned ${response.status}`,
      };
    }
    return { ok: true, status: response.status, data: payload };
  } catch (err) {
    const timedOut = err.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      error: timedOut
        ? 'the bot API did not respond in time'
        : `could not reach the bot API (${err.message})`,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { callBot, baseUrl };
