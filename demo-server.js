'use strict';
/*
 * Demo server for previewing the Pixel Tiers site without the bot, database or
 * ../shared folder (for example inside Bolt). It renders the real views/index.ejs
 * and serves the real public/assets, but fills the rankings with sample players.
 * The production server is still server.js.
 */
const path = require('node:path');
const express = require('express');

const modes = [
  ['crystal', 'Crystal'], ['uhc', 'UHC'], ['pot', 'Pot'], ['nethpot', 'NethPot'], ['smp', 'SMP'],
  ['sword', 'Sword'], ['axe', 'Axe'], ['mace', 'Mace'], ['spear-mace', 'Spear Mace'],
  ['creeper', 'Creeper'], ['bed', 'Bed'], ['money-smp', 'Money SMP'], ['cart', 'Cart'],
].map(([key, name]) => ({
  key,
  name,
  icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="6" y="6" width="20" height="20" fill="#8a8ab8"/></svg>',
}));

const tiers = ['HT1', 'LT1', 'HT2', 'LT2', 'HT3', 'LT3', 'HT4', 'LT4', 'HT5', 'LT5'];
const points = { HT1: 60, LT1: 44, HT2: 32, LT2: 22, HT3: 16, LT3: 10, HT4: 6, LT4: 4, HT5: 2, LT5: 1 };
const titles = [
  { name: 'PvPer', className: 'r0', min: 0, range: 'Under 20' },
  { name: 'Semi-PvPer', className: 'r1', min: 20, range: '20 to 49' },
  { name: 'Combat Pro', className: 'r2', min: 50, range: '50 to 74' },
  { name: 'Combat Legend', className: 'r3', min: 75, range: '75 to 149' },
];
const perks = ['Cape in game', 'Chat tag', 'Priority testing queue'];
const products = [
  { key: 'diamonds', name: 'Diamond', price: 10, monthly: false, perks },
  { key: 'hearts', name: 'Platinum', price: 19.99, monthly: false, perks },
  { key: 'clubs', name: 'Zinc', price: 5.5, monthly: true, perks },
  { key: 'spades', name: 'Pixle', price: 13.5, monthly: true, perks },
];
const players = [
  { n: 'Steve', t: { Sword: 'HT1', Mace: 'LT1', Crystal: 'HT2' }, pts: 136 },
  { n: 'caarhill', t: { Sword: 'HT3', Crystal: 'LT2', Axe: 'HT4' }, pts: 44 },
  { n: 'Alex', t: { UHC: 'LT3', Pot: 'HT4' }, pts: 16 },
  { n: 'Notch', t: { Creeper: 'LT4' }, pts: 4 },
];
const counts = { players: players.length, tiers: players.reduce((a, p) => a + Object.keys(p.t).length, 0), modes: modes.length };

const app = express();
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

app.get('/api/players', (req, res) => res.json({ ok: true, updatedAt: Date.now(), counts, players }));
app.get('/auth/discord', (req, res) => res.redirect('/'));
app.get('/', (req, res) => {
  const boot = { discordInvite: '', refreshSeconds: 20, modes, tiers, points, titles, products, user: null };
  res.render('index', { user: null, boot, counts });
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log(`Pixel Tiers demo on http://localhost:${port}`));
