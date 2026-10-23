'use strict';

/* ------------------------------------------------------------------
 * Pixel Tiers front end.
 *
 * One shell, hash-routed: #/home, #/tiers, #/info, #/store, #/p/<name>.
 * All rankings come from /api/players, which the server builds from the same
 * SQLite tables the bot writes, so the page is never more than a refresh behind
 * a result.
 * ------------------------------------------------------------------ */

const BOOT = JSON.parse(document.getElementById('boot').textContent);

const DISCORD_INVITE = BOOT.discordInvite || '';
const REFRESH_SECONDS = BOOT.refreshSeconds || 20;
const LABEL = { 'money-smp': 'Diamond SMP', nethpot: 'NethPot' };
const label = (m) => LABEL[m.key] || m.name;
const MODES = BOOT.modes.map(label);
const MODE_SVGS = Object.fromEntries(BOOT.modes.map((m) => [label(m), m.icon]));
const MODE_ICONS = Object.fromEntries(
  BOOT.modes.map((m) => [
    label(m),
    `<img src="/assets/emojis/${m.key}.png" alt="" width="32" height="32" loading="lazy" onerror="this.outerHTML=MODE_SVGS['${label(m).replace(/'/g, "\\'")}'] || ''">`,
  ])
);
const TIERS = BOOT.tiers;
const PTS = BOOT.points;
const TITLES = BOOT.titles.map((t) => [t.name, t.className, t.min, t.range]);
const PRODUCTS = BOOT.products;

const RANK = (p) => [...TITLES].reverse().find((t) => p >= t[2]);
const $ = (s) => document.getElementById(s);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ico = (m) => MODE_ICONS[m] || '';

// Any spelling of a mode (key, old name, new name) resolves to one display name,
// so a rename can never drop a player's tiers.
const slug = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
const CANON = {};
BOOT.modes.forEach((m) => [m.key, m.name, label(m)].forEach((a) => (CANON[slug(a)] = label(m))));
Object.entries({ moneysmp: 'money-smp', diamondsmp: 'money-smp', dsmp: 'money-smp', nethop: 'nethpot', netheritepot: 'nethpot', diamondpot: 'diamond-pots', dpot: 'diamond-pots' }).forEach(([a, k]) => {
  const m = BOOT.modes.find((x) => x.key === k);
  if (m) CANON[a] = label(m);
});
const canon = (x) => CANON[slug(x)];

const svg16 = (d) => `<svg viewBox="0 0 16 16" width="18" height="18" shape-rendering="crispEdges" aria-hidden="true">${d}</svg>`;
const SPK = '<path fill="currentColor" d="M2 6h3l4-3v10l-4-3H2z"/>';
const ICONS = {
  sound: svg16(SPK + '<path d="M11 5v6M13 3v10" stroke="currentColor" stroke-width="2" fill="none"/>'),
  mute: svg16(SPK + '<path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" stroke-width="2" fill="none"/>'),
};

let P = [];
let mode = 'Overall';
let live = false;
let last = 0;

const avatar = (p, cls = 'av') => {
  // Prefer the UUID: it survives a Minecraft name change. Fall back to the name
  // for any older payload that does not carry one.
  const key = p.uuid || p.n;
  const head = `https://mc-heads.net/avatar/${encodeURIComponent(key)}/64`;
  return `<div class="${cls}"><img loading="lazy" alt="" src="${esc(p.a || head)}" data-alt="${head}" data-l="${esc((p.n[0] || '?').toUpperCase())}"></div>`;
};

document.addEventListener(
  'error',
  (e) => {
    const i = e.target;
    if (!(i instanceof HTMLImageElement) || !i.closest('.av')) return;
    if (i.dataset.alt && i.src !== i.dataset.alt) {
      i.src = i.dataset.alt;
      i.dataset.alt = '';
    } else i.replaceWith(document.createTextNode(i.dataset.l || '?'));
  },
  true
);

const tcls = (t) => 't' + Math.min(3, +t[2]);
const badge = (m, t) =>
  `<div class="tb ${tcls(t)}" title="${esc(m)}: ${esc(t)}"><div class="ic">${ico(m)}</div><div class="tt">${esc(t)}</div></div>`;
const sortedTiers = (p) =>
  Object.entries(p.t).sort(
    (a, b) => TIERS.indexOf(a[1]) - TIERS.indexOf(b[1]) || MODES.indexOf(a[0]) - MODES.indexOf(b[0])
  );
const filtered = () => {
  const q = $('q').value.trim().toLowerCase();
  return P.filter((p) => !q || p.n.toLowerCase().includes(q));
};

function render() {
  document.querySelectorAll('.live').forEach((e) => {
    e.classList.toggle('off', !live);
    e.querySelector('.lt').textContent = live
      ? `Live · ${P.length} players · updates every ${REFRESH_SECONDS}s`
      : last
        ? 'Reconnecting…'
        : 'Connecting…';
  });
  if (!$('tiers').hidden) renderTiers();
  if (!$('home').hidden) renderHome();
}

function renderTiers() {
  const list = filtered();

  if (mode === 'Overall') {
    const ranks = new Map(P.map((p, i) => [p, i + 1]));
    $('out').innerHTML = list.length
      ? `<div class="list">${list
          .map((p) => {
            const n = ranks.get(p);
            const [t, c] = RANK(p.pts);
            return `<button class="row ${n < 4 ? 'p' + n : ''}" data-p="${esc(p.n)}"><div class="rank">${n}</div><div><div class="who">${avatar(
              p
            )}<div style="min-width:0"><div class="nm">${esc(p.n)}</div><div class="sub"><span class="rk ${c}">${t}</span></div></div></div><div class="badges">${sortedTiers(
              p
            )
              .map(([m, tier]) => badge(m, tier))
              .join('')}</div></div><div class="pts">${p.pts}<small>points</small></div></button>`;
          })
          .join('')}</div>`
      : `<div class="empty">${P.length ? 'No players match.' : live ? 'No players yet.' : 'Loading players…'}</div>`;
    return;
  }

  const cols = [1, 2, 3, 4, 5].map((n) => {
    const ps = list
      .filter((p) => p.t[mode] && +p.t[mode][2] === n)
      .sort(
        (a, b) =>
          (a.t[mode][0] === 'H' ? 0 : 1) - (b.t[mode][0] === 'H' ? 0 : 1) || b.pts - a.pts
      );
    return `<div class="col" style="--a:${(0.34 - n * 0.055).toFixed(2)}"><h3>Tier ${n}</h3>${
      ps
        .map(
          (p) =>
            `<button class="pl" data-p="${esc(p.n)}">${avatar(p)}<span>${esc(p.n)}</span><em class="${
              p.t[mode][0] === 'H' ? 'h' : ''
            }">${p.t[mode].slice(0, 2)}</em></button>`
        )
        .join('') || '<div class="none">Nobody yet</div>'
    }</div>`;
  });
  $('out').innerHTML = `<div class="cols">${cols.join('')}</div>`;
}

function renderHome() {
  const tested = P.reduce((a, p) => a + Object.keys(p.t).length, 0);
  $('stats').innerHTML = [
    [P.length, 'Players ranked'],
    [tested, 'Tiers awarded'],
    [MODES.length, 'Gamemodes'],
  ]
    .map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`)
    .join('');

  $('top3').innerHTML = P.slice(0, 3)
    .map(
      (p, i) =>
        `<button data-p="${esc(p.n)}">${avatar(p)}<div class="n">#${i + 1}</div><div class="nm">${esc(
          p.n
        )}</div><div class="sub">${RANK(p.pts)[0]} · ${p.pts} points</div></button>`
    )
    .join('');
}

function showProf(p) {
  const [t, c] = RANK(p.pts);
  const n = P.indexOf(p) + 1;
  $('prof').innerHTML = `<button class="back" onclick="location.hash='#/tiers'">← Back to tiers</button>
  <div class="head">${avatar(p)}<div><div class="nm">${esc(p.n)}</div><div class="sub" style="font-size:15px"><span class="rk ${c}">${t}</span> · #${n} overall</div></div><div class="big"><b>${
    p.pts
  }</b><div class="sub">points</div></div></div>
  <div class="grid">${MODES.map((m) =>
    p.t[m]
      ? `<div class="pm"><div class="mi">${ico(m)}</div>${esc(m)}<b>${esc(p.t[m])}</b><div class="sub">${
          PTS[p.t[m]]
        } pts</div></div>`
      : `<div class="pm un"><div class="mi">${ico(m)}</div>${esc(m)}<b>Untested</b></div>`
  ).join('')}</div>`;
}

function buildTabs() {
  const t = (m, i, c) =>
    `<button role="tab" data-m="${esc(m)}" class="${c || ''} ${m === mode ? 'on' : ''}"><span class="mi">${i}</span><span>${esc(
      m
    )}</span></button>`;
  $('modes').innerHTML = MODES.map((m) => t(m, ico(m))).join('') + t('Overall', '<img src="/assets/crown.png" alt="" width="16" height="16">', 'all');
}

function buildInfo() {
  $('info').innerHTML = `<h2 class="ih">About Pixel Tiers</h2>
  <div class="card"><p>Pixel Tiers ranks Minecraft PvP players by testing them head-to-head in different gamemodes. Every player gets a tier in each gamemode they have been tested in, and all of their tiers add up to an overall score.</p></div>
  <h2 class="ih">How tiers work</h2>
  <div class="card"><p>Tiers run from <b>Tier 1</b> (the best) down to <b>Tier 5</b>. Each one is split into <b>High Tier (HT)</b> and <b>Low Tier (LT)</b>, so HT1 is the top and LT5 is the lowest. Your overall points are the total from every gamemode you are tested in.</p>
  <table>${Object.entries(PTS)
    .map(([t, v]) => `<tr><td><b>${esc(t)}</b></td><td>${v} pts</td></tr>`)
    .join('')}</table></div>
  <h2 class="ih">Combat titles</h2>
  <div class="card"><p>Your total points decide your title, shown under your name.</p><table>${TITLES.map(
    ([n, c, , r]) => `<tr><td><span class="rk ${c}">${esc(n)}</span></td><td>${esc(r)} pts</td></tr>`
  ).join('')}</table></div>
  <h2 class="ih">Gamemodes</h2>
  <div class="card"><div class="gm">${MODES.map((m) => `<span><i>${ico(m)}</i>${esc(m)}</span>`).join('')}</div></div>
  <h2 class="ih">Get tested</h2>
  <div class="card"><p>Want a tier? Join the Discord to get tested.</p><a class="cta" data-discord target="_blank" rel="noopener noreferrer">Get tested</a></div>`;
}

/* ---- store: ranks come from the server data, checkout stays off ---- */
const RANK_DISPLAY = {
  diamonds: { name: 'Diamond', price: 10, monthly: false, icon: 'diamond', rgb: '79,227,234' },
  hearts: { name: 'Platinum', price: 19.99, monthly: false, icon: 'platinum', rgb: '139,108,240' },
  clubs: { name: 'Zinc', price: 5.5, monthly: true, icon: 'zinc', rgb: '166,171,184' },
  spades: { name: 'Pixle', price: 13.5, monthly: true, icon: 'pixle', rgb: '168,85,247', best: true },
};
const perk = (t) =>
  t.replace(/(\d)\u2013(\d)/g, '$1 to $2').replace(/Diamonds/g, 'Diamond').replace(/Hearts/g, 'Platinum').replace(/Clubs/g, 'Zinc').replace(/Spades/g, 'Pixle');
const isMonthly = (p) => RANK_DISPLAY[p.key]?.monthly ?? p.monthly;

function buildStore() {
  const money = (p) => (Number.isInteger(p) ? String(p) : p.toFixed(2));

  const card = (p) => {
    const d = RANK_DISPLAY[p.key] || {};
    const icon = d.icon
      ? `<img class="rk-ico" src="/assets/ranks/${d.icon}.svg" alt="" width="64" height="64">`
      : esc(p.suit || '');
    return `<div class="rk-card ${d.best ? 'best' : ''}" style="--c:${d.rgb || '245,184,32'}">${
      d.best ? '<span class="tag">Best</span>' : ''
    }<div class="suit">${icon}</div><h3>${esc(d.name || p.name)}</h3><div class="price">$${money(
      d.price ?? p.price
    )}<small>${isMonthly(p) ? ' / month' : ' one-time'}</small></div><ul>${p.perks
      .map((x) => `<li>${esc(perk(x))}</li>`)
      .join('')}</ul><button class="cta" disabled aria-disabled="true">Coming soon</button></div>`;
  };

  const group = (title, list) =>
    list.length ? `<section class="rk-group"><h2 class="rk-head">${title}</h2><div class="rk-row">${list.map(card).join('')}</div></section>` : '';

  $('ranks').innerHTML =
    group('One-time purchases', PRODUCTS.filter((p) => !isMonthly(p))) + group('Monthly subscriptions', PRODUCTS.filter(isMonthly));
}

/* ---- routing ---- */
function route() {
  const h = location.hash;
  const m = h.match(/^#\/p\/(.+)$/);

  let name = '';
  try {
    name = m ? decodeURIComponent(m[1]).toLowerCase() : '';
  } catch {
    name = '';
  }

  const p = m && P.find((x) => x.n.toLowerCase() === name);
  const page = p
    ? 'prof'
    : h.startsWith('#/tiers') || m
      ? 'tiers'
      : h.startsWith('#/info')
        ? 'info'
        : h.startsWith('#/store')
          ? 'store'
          : 'home';

  for (const s of ['home', 'tiers', 'prof', 'info', 'store']) $(s).hidden = s !== page;

  $('ns').classList.toggle('on', page === 'store');
  $('nh').classList.toggle('on', page === 'home');
  $('nt').classList.toggle('on', page === 'tiers' || page === 'prof');
  $('ni').classList.toggle('on', page === 'info');

  if (p) showProf(p);
  document.querySelectorAll('[data-discord]').forEach((a) => {
    a.href = DISCORD_INVITE || '#';
  });
  render();
}

addEventListener('hashchange', () => {
  route();
  scrollTo(0, 0);
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-m]');
  if (b) {
    mode = b.dataset.m;
    document.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x.dataset.m === mode));
    render();
    return;
  }
  const r = e.target.closest('[data-p]');
  if (r) location.hash = '#/p/' + encodeURIComponent(r.dataset.p);
});

$('q').oninput = () => render();

/* ---- theme, colours, gradients ---- */
const ACCENTS = [
  ['Yellow', '#ffe14d'],
  ['Gold', '#F5B820'], ['Amber', '#ffa620'], ['Orange', '#ff8a3d'], ['Coral', '#ff6b5e'], ['Red', '#ff4d4d'], ['Crimson', '#e11d48'],
  ['Rose', '#fb7185'], ['Pink', '#ec4899'], ['Magenta', '#d946ef'], ['Purple', '#a855f7'], ['Violet', '#8b5cf6'], ['Indigo', '#6366f1'],
  ['Blue', '#3b82f6'], ['Sky', '#38bdf8'], ['Cyan', '#22d3ee'], ['Aqua', '#2dd4bf'], ['Teal', '#14b8a6'], ['Silver', '#d4d4d8'],
];


const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: settings simply do not persist */
    }
  },
};

let theme = store.get('st-theme') || 'dark';
let accent = store.get('st-accent2') || '#F5B820';

function hsl(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0;
  let s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  }
  return [h, s, l, 0.2126 * r + 0.7152 * g + 0.0722 * b];
}

const hs = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');

function applyTheme() {
  const light = theme === 'light';
  const R = document.documentElement;
  if (!/^#[0-9a-f]{6}$/i.test(accent)) accent = '#F5B820';
  const [h, sat, l, lum] = hsl(accent);

  R.dataset.theme = theme;
  R.style.setProperty('--accent', accent);
  R.style.setProperty('--accent-hover', hs(h, sat, Math.min(0.8, l + 0.08)));
  R.style.setProperty('--accent-rgb', rgbOf(accent));
  R.style.setProperty('--on', lum > 0.4 ? '#1a1200' : '#ffffff');

  store.set('st-theme', theme);
  store.set('st-accent2', accent);

  $('tp').innerHTML = `<h4>Mode</h4><div class="seg"><button data-th="light" class="${light ? 'on' : ''}">Light</button><button data-th="dark" class="${
    light ? '' : 'on'
  }">Dark</button></div>
  <h4>Colour</h4><div class="sw">${ACCENTS.map(
    ([n, c]) =>
      `<button data-ac="${c}" title="${n}" aria-label="${n}" class="${c === accent ? 'on' : ''}" style="background:${c};color:${
        hsl(c)[3] > 0.45 ? '#0a0a0a' : '#fff'
      }"></button>`
  ).join('')}</div>
  <h4>Click sound</h4><div class="snds">${Object.keys(SOUNDS)
    .map((n) => `<button data-snd="${n}" class="${n === sound ? 'on' : ''}">${n}</button>`)
    .join('')}</div>`;
}

$('th').onclick = (e) => {
  e.stopPropagation();
  $('tp').hidden = !$('tp').hidden;
};

$('tp').addEventListener('click', (e) => {
  e.stopPropagation();
  const t = e.target.closest('[data-th]');
  const a = e.target.closest('[data-ac]');
  const sn = e.target.closest('[data-snd]');

  if (t) theme = t.dataset.th;
  else if (a) accent = a.dataset.ac;
  else if (sn) {
    sound = sn.dataset.snd;
    store.set('st-sound', sound);
    if (muted) {
      muted = false;
      store.set('st-mute', '0');
      sndIcon();
    }
    tick();
  } else return;

  applyTheme();
});

document.addEventListener('click', () => {
  $('tp').hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('tp').hidden = true;
});

/* ---- click sounds: each is a list of [wave, startHz, endHz, seconds, volume, delay] ---- */
const SOUNDS = {
  Click: [['sine', 620, 620, 0.12, 0.22, 0], ['sine', 930, 930, 0.12, 0.22, 0.045]],
  Pop: [['sine', 520, 150, 0.09, 0.4, 0]],
  Bubble: [['sine', 280, 900, 0.12, 0.3, 0]],
  Blip: [['square', 880, 880, 0.05, 0.07, 0]],
  Coin: [['square', 988, 988, 0.07, 0.07, 0], ['square', 1319, 1319, 0.28, 0.07, 0.07]],
  Chime: [['triangle', 1047, 1047, 0.25, 0.18, 0], ['triangle', 1319, 1319, 0.25, 0.16, 0.06], ['triangle', 1568, 1568, 0.35, 0.14, 0.12]],
  Laser: [['sawtooth', 1500, 180, 0.14, 0.07, 0]],
  Thud: [['sine', 170, 55, 0.13, 0.5, 0]],
  Tap: [['triangle', 1800, 1200, 0.03, 0.25, 0]],
};

let AC;
let muted = store.get('st-mute') === '1';
let sound = store.get('st-sound') || 'Click';
if (!SOUNDS[sound]) sound = 'Click';

function tick() {
  if (muted) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    const t = AC.currentTime;
    SOUNDS[sound].forEach(([w, f0, f1, dur, vol, d]) => {
      const o = AC.createOscillator();
      const g = AC.createGain();
      o.type = w;
      o.frequency.setValueAtTime(f0, t + d);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + d + dur);
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(vol, t + d + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + dur);
      o.connect(g);
      g.connect(AC.destination);
      o.start(t + d);
      o.stop(t + d + dur + 0.02);
    });
  } catch {
    /* audio blocked: the site works without it */
  }
}

document.addEventListener(
  'pointerdown',
  (e) => {
    if (e.target.closest('[data-snd]')) return;
    if (e.target.closest('button,a,select,[role=tab],[data-p],[data-m],[data-th],[data-ac]')) tick();
  },
  true
);

const sndIcon = () => ($('snd').innerHTML = muted ? ICONS.mute : ICONS.sound);
sndIcon();

$('snd').onclick = () => {
  muted = !muted;
  store.set('st-mute', muted ? '1' : '0');
  sndIcon();
  tick();
};

/* ---- live data ---- */
async function load() {
  try {
    const r = await fetch('/api/players', { cache: 'no-store' });
    if (!r.ok) throw new Error('bad response');
    const data = await r.json();
    if (!Array.isArray(data.players)) throw new Error('bad payload');

    P = data.players
      .filter((p) => p && p.n && p.t)
      .map((p) => {
        const t = {};
        for (const [m, v] of Object.entries(p.t)) {
          const c = canon(m);
          if (c && PTS[v]) t[c] = v;
        }
        return {
          ...p,
          t,
          pts: Object.values(t).reduce((a, b) => a + (PTS[b] || 0), 0),
        };
      })
      .sort((a, b) => b.pts - a.pts || a.n.localeCompare(b.n));

    live = true;
    last = Date.now();
  } catch {
    live = false;
  }
  route();
}

applyTheme();
buildTabs();
buildInfo();
buildStore();
route();
load();

setInterval(() => {
  if (!document.hidden) load();
}, REFRESH_SECONDS * 1000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - last > REFRESH_SECONDS * 1000) load();
});
