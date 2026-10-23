'use strict';

const path = require('node:path');
const express = require('express');

// ---- Mock data that the real app reads from its shared database ----

const GAMEMODES = [
  { key: 'sword', display: 'Sword', icon: '<svg viewBox="0 0 16 16" width="18" height="18" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M2 1h2v8h2v2H4v3H2v-3H0V9h2z"/></svg>' },
  { key: 'axe', display: 'Axe', icon: '<svg viewBox="0 0 16 16" width="18" height="18" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M2 2h6v3H6v2H4v6H2V2z"/></svg>' },
  { key: 'crystal', display: 'Crystal', icon: '<svg viewBox="0 0 16 16" width="18" height="18" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M6 1h4l3 5-5 9-5-9z"/></svg>' },
  { key: 'mace', display: 'Mace', icon: '<svg viewBox="0 0 16 16" width="18" height="18" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M7 1h2v8h2v2h2v3H3v-3h2v-2h2z"/></svg>' },
  { key: 'nethpot', display: 'NethPot', icon: '<svg viewBox="0 0 16 16" width="18" height="18" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M3 4h2v8h6V4h2v10H3z"/></svg>' },
  { key: 'uhc', display: 'UHC', icon: '<svg viewBox="0 0 16 16" width="18" height="18" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M3 2h2v12H3zM7 2h2v12H7zM11 2h2v12h-2z"/></svg>' },
];

const TIERS = ['HT1','LT1','HT2','LT2','HT3','LT3','HT4','LT4','HT5','LT5'];
const POINTS = { HT1: 15, LT1: 13, HT2: 11, LT2: 9, HT3: 7, LT3: 5, HT4: 3, LT4: 2, HT5: 1, LT5: 1 };
const TITLES = [
  { name: 'Unranked', className: 'un', min: 0, range: '0-4' },
  { name: 'Bronze', className: 'br', min: 5, range: '5-14' },
  { name: 'Iron', className: 'ir', min: 15, range: '15-29' },
  { name: 'Gold', className: 'go', min: 30, range: '30-49' },
  { name: 'Diamond', className: 'di', min: 50, range: '50-74' },
  { name: 'Netherite', className: 'ne', min: 75, range: '75+' },
];

const PRODUCTS = [
  { key: 'diamonds', name: 'Diamond', suit: '♦', price: 10, currency: 'USD', monthly: false, perks: ['Custom join message','Cape in game','2 extra custom kits'] },
  { key: 'hearts', name: 'Platinum', suit: '♥', price: 19.99, currency: 'USD', monthly: false, perks: ['Everything in Diamond','Custom Discord role colour','Priority testing queue'] },
  { key: 'clubs', name: 'Zinc', suit: '♣', price: 5.5, currency: 'USD', monthly: true, perks: ['Cape in game','1 extra custom kit','No testing cooldown'] },
  { key: 'spades', name: 'Pixle', suit: '♠', price: 13.5, currency: 'USD', monthly: true, perks: ['Everything in Zinc & Diamond','Custom Discord role','Animated cape','3 extra custom kits'] },
];

const MOCK_PLAYERS = [
  { n: 'XclsFrogMC', t: { Sword: 'HT1', Axe: 'HT2', Crystal: 'LT1', Mace: 'HT3', NethPot: 'HT2', UHC: 'LT2' } },
  { n: 'NandoMC_',   t: { Sword: 'HT2', Axe: 'HT1', Crystal: 'HT2', Mace: 'LT1', NethPot: 'HT3', UHC: 'HT1' } },
  { n: 'BlazeKnight', t: { Sword: 'LT1', Axe: 'LT2', Crystal: 'HT2', Mace: 'LT3', NethPot: 'LT1', UHC: 'LT3' } },
  { n: 'EnderQueen', t: { Sword: 'HT2', Axe: 'LT3', Crystal: 'LT2', Mace: 'HT4', NethPot: 'HT2', UHC: 'LT4' } },
  { n: 'ShadowPvP', t: { Sword: 'HT3', Axe: 'HT3', Crystal: 'LT3', Mace: 'LT2', NethPot: 'LT3' } },
  { n: 'CreeperCrush', t: { Sword: 'LT3', Axe: 'HT4', Crystal: 'HT4', Mace: 'LT4', UHC: 'HT5' } },
  { n: 'DiamondHand', t: { Sword: 'HT4', Axe: 'LT4', Crystal: 'LT4', Mace: 'HT5', NethPot: 'LT5' } },
  { n: 'NinjaBlock', t: { Sword: 'LT2', Axe: 'LT1', Crystal: 'HT1', Mace: 'HT2', NethPot: 'HT1', UHC: 'HT2' } },
  { n: 'GoldSword77', t: { Sword: 'HT1', Axe: 'LT2', Crystal: 'LT1', UHC: 'LT5' } },
  { n: 'IronGolem42', t: { Sword: 'HT5', Axe: 'LT5', Crystal: 'LT5', Mace: 'LT5', NethPot: 'LT4', UHC: 'HT4' } },
];

const PLAYERS = MOCK_PLAYERS.map((p) => {
  const pts = Object.values(p.t).reduce((a, t) => a + (POINTS[t] || 0), 0);
  return { ...p, pts };
}).sort((a, b) => b.pts - a.pts || a.n.localeCompare(b.n));

const COUNTS = {
  players: PLAYERS.length,
  tiers: PLAYERS.reduce((a, p) => a + Object.keys(p.t).length, 0),
  modes: GAMEMODES.length,
};

// ---- App ----

const app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use('/assets', express.static(path.join(__dirname, 'public', 'assets'), { maxAge: '1h' }));

function bootFor() {
  return {
    discordInvite: '#',
    refreshSeconds: 20,
    modes: GAMEMODES.map((g) => ({ name: g.display, icon: g.icon, key: g.key })),
    tiers: TIERS,
    points: POINTS,
    titles: TITLES,
    products: PRODUCTS,
    user: null,
  };
}

app.get('/', (req, res) => {
  res.render('index', {
    user: null,
    boot: bootFor(),
    counts: COUNTS,
  });
});

app.get('/api/players', (req, res) => {
  res.setHeader('cache-control', 'no-store');
  res.json({
    ok: true,
    updatedAt: Date.now(),
    counts: COUNTS,
    players: PLAYERS,
  });
});

app.get('/healthz', (req, res) => {
  res.json({ ok: true, service: 'pixeltiers-web' });
});

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Pixel Tiers website listening on http://0.0.0.0:${PORT}`);
});

module.exports = app;