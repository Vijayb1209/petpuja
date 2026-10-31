'use strict';
/* PetPuja server: zero dependencies (Node >= 22.5).
   http + node:sqlite + crypto. REST API, role-based auth, Server-Sent Events for live updates. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const chat = require('./chat');

const PORT = +process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'petpuja.db');
const PUBLIC = path.join(__dirname, 'public');
const DEMO = process.env.NODE_ENV !== 'production';

/* ------------------------------------------------------------------ database */
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass TEXT NOT NULL, role TEXT NOT NULL, phone TEXT DEFAULT '', address TEXT DEFAULT '', loc TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS dishes(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, desc TEXT DEFAULT '', price INTEGER NOT NULL, cat TEXT NOT NULL,
  veg INTEGER NOT NULL, avail INTEGER NOT NULL DEFAULT 1, img TEXT, tags TEXT DEFAULT '', sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, customer TEXT, phone TEXT, address TEXT, loc TEXT, dist_km REAL,
  note TEXT, payment TEXT, items TEXT, subtotal INTEGER, fee INTEGER, total INTEGER, status TEXT, created INTEGER,
  rating INTEGER, review TEXT, rider TEXT);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
`);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const one = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
const J = s => { try { return JSON.parse(s); } catch { return null; } };

const CATS = ['Meals', 'Biryani', 'Tiffin', 'Breads', 'Starters', 'Sweets', 'Drinks'];
const PAYMENTS = ['Cash on delivery', 'UPI on delivery', 'Card on delivery'];
const PHONE_ERR = 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.';
const DEF = {
  resto: { lat: 10.8190, lng: 78.6857, label: '12 Temple Street, Trichy' },
  fee: { base: 20, freeKm: 2, perKm: 8, maxKm: 15 },
  hours: { open: '11:00', close: '22:00', accepting: true },
  hero: null
};
function getSettings() { const r = one('SELECT value FROM settings WHERE key=?', 'main'); return r ? { ...DEF, ...J(r.value) } : structuredClone(DEF); }
function putSettings(s) { run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'main', JSON.stringify(s)); }

let SECRET = (one('SELECT value FROM settings WHERE key=?', 'secret') || {}).value;
if (!SECRET) { SECRET = crypto.randomBytes(32).toString('hex'); run('INSERT INTO settings(key,value) VALUES(?,?)', 'secret', SECRET); }

/* ------------------------------------------------------------------ passwords + tokens */
function hashPw(pw) { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex'); }
function checkPw(pw, stored) {
  const [salt, h] = String(stored).split(':'); if (!salt || !h) return false;
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sign = p => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); };
function verify(t) {
  if (!t || typeof t !== 'string') return null;
  const [b, s] = t.split('.'); if (!b || !s) return null;
  const e = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  const A = Buffer.from(s), B = Buffer.from(e);
  if (A.length !== B.length || !crypto.timingSafeEqual(A, B)) return null;
  const p = J(Buffer.from(b, 'base64url').toString()); return p && p.exp > Date.now() ? p : null;
}
const pubUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone, address: u.address, loc: J(u.loc) });
const issue = u => sign({ uid: u.id, exp: Date.now() + 7 * 864e5 });

/* ------------------------------------------------------------------ seed */
const DISHES = [
  ['d1', 'Banana-leaf meals', 'Rice, sambar, rasam, two poriyals, kootu, appalam, payasam and curd.', 180, 'Meals', 1, 'meal,filling,traditional,mild,rice,south indian,lunch'],
  ['d2', 'Mini meals', 'Rice, sambar, rasam, one poriyal and curd. A lighter lunch.', 120, 'Meals', 1, 'meal,light,mild,rice,lunch'],
  ['d3', 'Chettinad chicken biryani', 'Seeraga samba rice, pepper-heavy chicken, onion raita.', 260, 'Biryani', 0, 'biryani,spicy,filling,chicken,rice,pepper'],
  ['d4', 'Veg dum biryani', 'Slow-cooked with vegetables, mint and fried onions.', 190, 'Biryani', 1, 'biryani,medium,filling,rice,vegetable'],
  ['d5', 'Ghee pongal', 'Rice and moong dal with pepper, cashew and plenty of ghee.', 90, 'Tiffin', 1, 'breakfast,light,mild,comfort,ghee'],
  ['d6', 'Idli (4) with sambar', 'Soft steamed idlis, sambar and two chutneys.', 70, 'Tiffin', 1, 'breakfast,light,mild,steamed,healthy'],
  ['d7', 'Masala dosa', 'Crisp dosa filled with potato masala.', 100, 'Tiffin', 1, 'breakfast,crispy,medium,potato'],
  ['d8', 'Egg kothu parotta', 'Shredded parotta tossed on the tawa with egg and salna.', 150, 'Tiffin', 0, 'spicy,egg,filling,street food,parotta'],
  ['d9', 'Chicken 65', 'Spicy fried chicken with curry leaf and green chilli.', 190, 'Starters', 0, 'spicy,starter,crispy,chicken,fried'],
  ['d10', 'Gobi 65', 'Crisp cauliflower in a red masala coating.', 140, 'Starters', 1, 'spicy,starter,crispy,cauliflower,fried'],
  ['d11', 'Paal payasam', 'Rice simmered in milk with cardamom.', 70, 'Sweets', 1, 'sweet,dessert,milk,cardamom'],
  ['d12', 'Filter coffee', 'Decoction and hot milk, served sweet.', 40, 'Drinks', 1, 'hot,coffee,drink,sweet'],
  ['d13', 'Jigarthanda', 'Cold milk, almond gum and ice cream.', 90, 'Drinks', 1, 'cold,sweet,drink,dessert,milk,ice cream'],
  ['d14', 'Paneer butter masala', 'Paneer cubes in a creamy tomato and butter gravy.', 210, 'Meals', 1, 'creamy,rich,paneer,north indian,mild,filling'],
  ['d15', 'Dal tadka with jeera rice', 'Yellow dal tempered with garlic and chilli, cumin rice.', 150, 'Meals', 1, 'dal,comfort,lentil,rice,light,north indian'],
  ['d16', 'Butter chicken', 'Tandoori chicken in a smooth, mildly sweet tomato cream gravy.', 280, 'Meals', 0, 'creamy,rich,chicken,north indian,mild,filling'],
  ['d17', 'Butter naan (2)', 'Soft tandoor-baked naan brushed with butter.', 60, 'Breads', 1, 'bread,naan,butter,north indian']
];
function seed() {
  if (!one('SELECT id FROM users LIMIT 1')) {
    const ins = (n, e, p, r) => run('INSERT INTO users(name,email,pass,role,created) VALUES(?,?,?,?,?)', n, e, hashPw(p), r, Date.now());
    ins('Restaurant Admin', 'admin@petpuja.in', process.env.ADMIN_PASSWORD || 'admin123', 'admin');
    ins('Delivery Partner', 'rider@petpuja.in', process.env.RIDER_PASSWORD || 'rider123', 'rider');
    if (!process.env.ADMIN_PASSWORD) console.log('! Default staff passwords in use. Set ADMIN_PASSWORD / RIDER_PASSWORD before going live.');
  }
  if (!one('SELECT id FROM dishes LIMIT 1')) DISHES.forEach((d, i) => run('INSERT INTO dishes(id,name,desc,price,cat,veg,avail,tags,sort) VALUES(?,?,?,?,?,?,1,?,?)', d[0], d[1], d[2], d[3], d[4], d[5], d[6], i));
}
seed();

/* ------------------------------------------------------------------ helpers */
const httpErr = (code, msg) => Object.assign(new Error(msg), { code });
const dishOut = r => ({ id: r.id, name: r.name, desc: r.desc, price: r.price, cat: r.cat, veg: !!r.veg, on: !!r.avail, img: r.img || null, tags: r.tags });
const orderOut = r => ({ id: r.id, userId: r.user_id, customer: r.customer, phone: r.phone, address: r.address, loc: J(r.loc), distKm: r.dist_km, note: r.note, payment: r.payment, items: J(r.items), subtotal: r.subtotal, fee: r.fee, total: r.total, status: r.status, createdAt: r.created, rating: r.rating, review: r.review, rider: J(r.rider) });
const getOrder = id => { const r = one('SELECT * FROM orders WHERE id=?', id); return r ? orderOut(r) : null; };
const normPhone = v => { let d = String(v || '').replace(/\D/g, ''); if (d.length > 10 && d.startsWith('91')) d = d.slice(2); else if (d.length > 10 && d[0] === '0') d = d.slice(1); return d.slice(0, 10); };
const validPhone = p => /^[6-9]\d{9}$/.test(p);
const num = (v, lo, hi, msg) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw httpErr(400, msg); return n; };
const str = (v, lo, hi, msg) => { const s = String(v ?? '').trim(); if (s.length < lo || s.length > hi) throw httpErr(400, msg); return s; };
const hav = (a, b) => { const R = 6371, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r; const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const ROAD = 1.3;
const feeFor = (km, s) => km <= s.fee.freeKm ? s.fee.base : s.fee.base + Math.ceil(km - s.fee.freeKm) * s.fee.perKm;
function openNow(s) {
  if (!s.hours.accepting) return false;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const now = (+parts.find(p => p.type === 'hour').value % 24) * 60 + +parts.find(p => p.type === 'minute').value;
  const [oh, om] = s.hours.open.split(':').map(Number), [ch, cm] = s.hours.close.split(':').map(Number);
  const o = oh * 60 + om, c = ch * 60 + cm;
  if (o === c) return true; /* same time = open 24 hours */
  return o < c ? now >= o && now < c : now >= o || now < c;
}
const publicSettings = s => ({ resto: s.resto, fee: s.fee, hours: s.hours, hero: s.hero });

/* ------------------------------------------------------------------ live events (Server-Sent Events) */
const clients = new Set();
function emit(event, data, pred) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) if (!pred || pred(c.user)) { try { c.res.write(msg); } catch { clients.delete(c); } }
}
const forOrder = o => u => !!u && (u.role !== 'customer' || u.id === o.userId);
const pingTimer = setInterval(() => { for (const c of clients) { try { c.res.write(': ping\n\n'); } catch { clients.delete(c); } } }, 25000); pingTimer.unref();

/* ------------------------------------------------------------------ recommender (TF-IDF + intent rules) */
const STOP = new Set('i want a an the some something with and for me to of under below less than rs rupees please need give show food dish eat have like good best up upto within my is it on in'.split(' '));
const SYN = { hot: ['spicy'], chilli: ['spicy'], spicy: ['spicy'], sweet: ['sweet', 'dessert'], dessert: ['sweet', 'dessert'], cold: ['cold'], cool: ['cold'], light: ['light', 'healthy'], healthy: ['light', 'healthy'], heavy: ['filling'], hungry: ['filling'], filling: ['filling'], lunch: ['lunch', 'meal'], dinner: ['filling', 'meal'], morning: ['breakfast'], tiffin: ['breakfast'], creamy: ['creamy', 'rich'], rich: ['creamy', 'rich'], snack: ['starter', 'crispy'], starter: ['starter'], crispy: ['crispy'], drink: ['drink'], beverage: ['drink'], tea: ['drink'], coffee: ['coffee'], mild: ['mild'] };
const tok = s => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w));
function recommend(q, limit = 5) {
  const dishes = all('SELECT * FROM dishes WHERE avail=1').map(dishOut);
  const text = q.toLowerCase();
  let diet = null;
  if (/non[\s-]?veg|chicken|egg|mutton|fish|meat/.test(text)) diet = 'nonveg'; else if (/\bveg\b|vegetarian|pure veg/.test(text)) diet = 'veg';
  let budget = null; const bm = text.match(/(?:under|below|less than|upto|up to|within|<)\s*(?:rs\.?|₹)?\s*(\d{2,5})/) || text.match(/(?:rs\.?|₹)\s*(\d{2,5})/); if (bm) budget = +bm[1];
  const docs = dishes.map(d => tok(`${d.name} ${d.name} ${d.desc} ${d.cat} ${d.tags.replace(/,/g, ' ')} ${d.tags.replace(/,/g, ' ')}`));
  const df = {}; docs.forEach(ws => new Set(ws).forEach(w => df[w] = (df[w] || 0) + 1));
  const N = docs.length, idf = w => Math.log((N + 1) / ((df[w] || 0) + 1)) + 1;
  const qv = {}; for (const w of tok(text)) { qv[w] = (qv[w] || 0) + 1; for (const s of (SYN[w] || [])) qv[s] = (qv[s] || 0) + .7; }
  const vec = ws => { const v = {}; ws.forEach(w => v[w] = (v[w] || 0) + 1); for (const w in v) v[w] *= idf(w); return v; };
  const norm = v => Math.sqrt(Object.values(v).reduce((a, b) => a + b * b, 0)) || 1;
  const qW = {}; for (const w in qv) qW[w] = qv[w] * idf(w); const qn = norm(qW);
  const out = [];
  dishes.forEach((d, i) => {
    if (diet === 'veg' && !d.veg) return; if (diet === 'nonveg' && d.veg) return; if (budget && d.price > budget) return;
    const dv = vec(docs[i]), dn = norm(dv); let dot = 0; const hit = [];
    for (const w in qW) if (dv[w]) { dot += qW[w] * dv[w]; hit.push(w); }
    const score = dot / (qn * dn);
    if (score > 0 || (!tok(text).length && (diet || budget))) out.push({ id: d.id, score: +score.toFixed(3), reason: hit.length ? 'Matches: ' + [...new Set(hit)].slice(0, 3).join(', ') : 'Fits your filters' });
  });
  out.sort((a, b) => b.score - a.score);
  return { diet, budget, results: out.slice(0, limit) };
}
function pairs(ids, limit = 3) {
  const have = new Set(ids), count = {};
  for (const r of all('SELECT items FROM orders WHERE status != ?', 'cancelled')) {
    const items = (J(r.items) || []).map(i => i.id);
    if (items.some(i => have.has(i))) items.forEach(i => { if (!have.has(i)) count[i] = (count[i] || 0) + 1; });
  }
  const dishes = all('SELECT * FROM dishes WHERE avail=1').map(dishOut).filter(d => !have.has(d.id));
  const out = []; const used = new Set();
  Object.entries(count).sort((a, b) => b[1] - a[1]).forEach(([id, n]) => { const d = dishes.find(x => x.id === id); if (d && out.length < limit) { out.push({ id, reason: `Ordered together ${n} time${n > 1 ? 's' : ''}` }); used.add(id); } });
  const inCart = all(`SELECT cat FROM dishes WHERE id IN (${ids.map(() => '?').join(',') || "''"})`, ...ids).map(r => r.cat);
  for (const [cat, why] of [['Drinks', 'Something to drink'], ['Sweets', 'Finish with a sweet'], ['Breads', 'Goes well with gravies']]) {
    if (out.length >= limit) break;
    if (!inCart.includes(cat)) { const d = dishes.find(x => x.cat === cat && !used.has(x.id)); if (d) { out.push({ id: d.id, reason: why }); used.add(d.id); } }
  }
  return out.slice(0, limit);
}

/* ------------------------------------------------------------------ router */
const routes = [];
const route = (method, pattern, handler, roles) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, roles });
const failures = new Map();

route('GET', '/api/health', () => ({ ok: true }));
route('GET', '/api/bootstrap', () => {
  const s = getSettings();
  return { menu: all('SELECT * FROM dishes ORDER BY sort,rowid').map(dishOut), settings: publicSettings(s), open: openNow(s), demo: DEMO };
});
route('POST', '/api/register', c => {
  const b = c.body, name = str(b.name, 1, 60, 'Enter your name.');
  const email = str(b.email, 3, 120, 'Enter a valid email address.').toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw httpErr(400, 'Enter a valid email address.');
  if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 100) throw httpErr(400, 'Password must be at least 8 characters.');
  const phone = normPhone(b.phone); if (!validPhone(phone)) throw httpErr(400, PHONE_ERR);
  if (one('SELECT id FROM users WHERE email=?', email)) throw httpErr(409, 'This email is already registered. Log in instead.');
  const r = run('INSERT INTO users(name,email,pass,role,phone,created) VALUES(?,?,?,?,?,?)', name, email, hashPw(b.password), 'customer', phone, Date.now());
  const u = one('SELECT * FROM users WHERE id=?', r.lastInsertRowid);
  return { status: 201, token: issue(u), user: pubUser(u) };
});
route('POST', '/api/login', c => {
  const email = String(c.body.email || '').trim().toLowerCase(), pw = String(c.body.password || '');
  const key = c.ip + '|' + email, f = failures.get(key);
  if (f && f.n >= 5 && Date.now() - f.t < 15 * 60e3) throw httpErr(429, 'Too many attempts. Try again in 15 minutes.');
  const u = one('SELECT * FROM users WHERE email=?', email);
  if (!u || !checkPw(pw, u.pass)) { failures.set(key, { n: (f && Date.now() - f.t < 15 * 60e3 ? f.n : 0) + 1, t: Date.now() }); throw httpErr(401, 'Email or password is incorrect.'); }
  failures.delete(key);
  const staff = u.role !== 'customer';
  if (c.body.portal === 'staff' && !staff) throw httpErr(403, 'This is a customer account. Use the Customer tab.');
  if (c.body.portal !== 'staff' && staff) throw httpErr(403, 'Staff log in from the Staff tab.');
  return { token: issue(u), user: pubUser(u) };
});
route('GET', '/api/me', c => ({ user: pubUser(c.user) }), ['customer', 'admin', 'rider']);

/* menu management */
function dishInput(b, partial) {
  const d = {};
  if (!partial || 'name' in b) d.name = str(b.name, 1, 80, 'Enter the dish name.');
  if (!partial || 'desc' in b) d.desc = String(b.desc || '').slice(0, 200);
  if (!partial || 'price' in b) d.price = Math.round(num(b.price, 1, 10000, 'Enter a price between 1 and 10000.'));
  if (!partial || 'cat' in b) { if (!CATS.includes(b.cat)) throw httpErr(400, 'Choose a valid category.'); d.cat = b.cat; }
  if (!partial || 'veg' in b) d.veg = b.veg ? 1 : 0;
  if ('on' in b) d.avail = b.on ? 1 : 0;
  if ('img' in b) { if (b.img !== null && !(typeof b.img === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(b.img) && b.img.length < 1.5e6)) throw httpErr(400, 'Image must be a JPEG, PNG or WebP under 1 MB.'); d.img = b.img; }
  return d;
}
route('POST', '/api/dishes', c => {
  const d = dishInput(c.body, false), id = 'd' + Date.now();
  run('INSERT INTO dishes(id,name,desc,price,cat,veg,avail,img,tags,sort) VALUES(?,?,?,?,?,?,1,?,?,?)', id, d.name, d.desc, d.price, d.cat, d.veg, d.img || null, '', 1000 + Date.now() % 1e6);
  emit('menu', {}); return { status: 201, dish: dishOut(one('SELECT * FROM dishes WHERE id=?', id)) };
}, ['admin']);
route('PUT', '/api/dishes/:id', c => {
  if (!one('SELECT id FROM dishes WHERE id=?', c.params.id)) throw httpErr(404, 'Dish not found.');
  const d = dishInput(c.body, true), keys = Object.keys(d);
  if (keys.length) run(`UPDATE dishes SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`, ...keys.map(k => d[k]), c.params.id);
  emit('menu', {}); return { dish: dishOut(one('SELECT * FROM dishes WHERE id=?', c.params.id)) };
}, ['admin']);
route('DELETE', '/api/dishes/:id', c => { run('DELETE FROM dishes WHERE id=?', c.params.id); emit('menu', {}); return { ok: true }; }, ['admin']);

route('PUT', '/api/settings', c => {
  const b = c.body, s = getSettings();
  if (b.resto) s.resto = { lat: num(b.resto.lat, -90, 90, 'Enter a valid latitude.'), lng: num(b.resto.lng, -180, 180, 'Enter a valid longitude.'), label: str(b.resto.label, 1, 120, 'Enter the restaurant address.') };
  if (b.fee) s.fee = { base: num(b.fee.base, 0, 1000, 'Invalid base fee.'), freeKm: num(b.fee.freeKm, 0, 50, 'Invalid included distance.'), perKm: num(b.fee.perKm, 0, 500, 'Invalid per-km fee.'), maxKm: num(b.fee.maxKm, 1, 100, 'Maximum distance must be between 1 and 100 km.') };
  if (b.hours) { const t = /^([01]\d|2[0-3]):[0-5]\d$/; if (!t.test(b.hours.open) || !t.test(b.hours.close)) throw httpErr(400, 'Use HH:MM for opening hours.'); s.hours = { open: b.hours.open, close: b.hours.close, accepting: !!b.hours.accepting }; }
  if ('hero' in b) { if (b.hero !== null && !(typeof b.hero === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(b.hero) && b.hero.length < 2.5e6)) throw httpErr(400, 'Photo must be a JPEG, PNG or WebP under 2 MB.'); s.hero = b.hero; }
  putSettings(s); emit('menu', {}); return { settings: publicSettings(s) };
}, ['admin']);

/* orders */
route('POST', '/api/orders', c => {
  const b = c.body, s = getSettings();
  if (!openNow(s)) throw httpErr(409, s.hours.accepting ? `We are closed right now. We take orders from ${s.hours.open} to ${s.hours.close}.` : 'We are not taking orders right now.');
  const name = str(b.name, 1, 60, 'Enter the name for the delivery.');
  const phone = normPhone(b.phone); if (!validPhone(phone)) throw httpErr(400, PHONE_ERR);
  const address = str(b.address, 10, 300, 'Enter a full delivery address.');
  if (!b.loc) throw httpErr(400, 'Choose your delivery location first.');
  const loc = { lat: num(b.loc.lat, -90, 90, 'Invalid location.'), lng: num(b.loc.lng, -180, 180, 'Invalid location.'), acc: b.loc.acc == null ? null : Math.round(num(b.loc.acc, 0, 1e6, 'Invalid location.')), src: b.loc.src === 'gps' ? 'gps' : 'pin' };
  if (!PAYMENTS.includes(b.payment)) throw httpErr(400, 'Choose a payment method.');
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 40) throw httpErr(400, 'Your cart is empty.');
  const qty = {}; for (const it of b.items) { const q = num(it.qty, 1, 20, 'Quantity must be between 1 and 20.'); if (!Number.isInteger(q)) throw httpErr(400, 'Invalid quantity.'); qty[String(it.id)] = (qty[String(it.id)] || 0) + q; }
  const items = []; let subtotal = 0;
  for (const [id, q] of Object.entries(qty)) {
    const d = one('SELECT * FROM dishes WHERE id=?', id);
    if (!d) throw httpErr(409, 'A dish in your cart no longer exists.');
    if (!d.avail) throw httpErr(409, `${d.name} is sold out today. Remove it from your cart.`);
    items.push({ id, name: d.name, qty: q, price: d.price }); subtotal += d.price * q; /* price always comes from the database */
  }
  const km = Math.round(hav(s.resto, loc) * ROAD * 10) / 10;
  if (km > s.fee.maxKm) throw httpErr(400, `That is ${km} km away, beyond our ${s.fee.maxKm} km delivery range.`);
  const fee = feeFor(km, s), id = (one('SELECT COALESCE(MAX(id),1000)+1 AS n FROM orders').n);
  run('INSERT INTO orders(id,user_id,customer,phone,address,loc,dist_km,note,payment,items,subtotal,fee,total,status,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, c.user.id, name, phone, address, JSON.stringify(loc), km, String(b.note || '').slice(0, 200), b.payment, JSON.stringify(items), subtotal, fee, subtotal + fee, 'placed', Date.now());
  run('UPDATE users SET phone=?,address=?,loc=? WHERE id=?', phone, address, JSON.stringify(loc), c.user.id);
  const o = getOrder(id); emit('order', o, forOrder(o)); return { status: 201, order: o };
}, ['customer']);
route('GET', '/api/orders/mine', c => ({ orders: all('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC', c.user.id).map(orderOut) }), ['customer']);
route('GET', '/api/admin/orders', c => {
  const rows = c.user.role === 'rider' ? all("SELECT * FROM orders WHERE status IN ('preparing','onway') ORDER BY id DESC") : all('SELECT * FROM orders ORDER BY id DESC LIMIT 500');
  return { orders: rows.map(orderOut), customers: one("SELECT COUNT(*) AS n FROM users WHERE role='customer'").n };
}, ['admin', 'rider']);
const FLOW = { placed: ['preparing', 'cancelled'], preparing: ['onway', 'cancelled'], onway: ['delivered'] };
route('PATCH', '/api/orders/:id/status', c => {
  const o = getOrder(+c.params.id); if (!o) throw httpErr(404, 'Order not found.');
  const to = c.body.status;
  if (!(FLOW[o.status] || []).includes(to)) throw httpErr(409, `An order that is "${o.status}" cannot become "${to}".`);
  if (c.user.role === 'rider' && !((o.status === 'preparing' && to === 'onway') || (o.status === 'onway' && to === 'delivered'))) throw httpErr(403, 'Riders can only pick up and deliver orders.');
  let rider = o.rider;
  if (to === 'onway') { const s = getSettings(); rider = { lat: s.resto.lat, lng: s.resto.lng, mode: 'start', p: 0, ts: Date.now() }; }
  if (to === 'delivered' || to === 'cancelled') rider = null;
  run('UPDATE orders SET status=?, rider=? WHERE id=?', to, rider ? JSON.stringify(rider) : null, o.id);
  const n = getOrder(o.id); emit('order', n, forOrder(n));
  if (to === 'onway') emit('rider', { orderId: n.id, ...rider }, forOrder(n));
  return { order: n };
}, ['admin', 'rider']);
route('POST', '/api/orders/:id/cancel', c => {
  const o = getOrder(+c.params.id); if (!o || o.userId !== c.user.id) throw httpErr(404, 'Order not found.');
  if (o.status !== 'placed') throw httpErr(409, 'The kitchen has already started this order, so it cannot be cancelled. Please call the restaurant.');
  run('UPDATE orders SET status=? WHERE id=?', 'cancelled', o.id);
  const n = getOrder(o.id); emit('order', n, forOrder(n)); return { order: n };
}, ['customer']);
route('POST', '/api/orders/:id/location', c => {
  const o = getOrder(+c.params.id); if (!o) throw httpErr(404, 'Order not found.');
  if (o.status !== 'onway') throw httpErr(409, 'Location can only be shared while the order is out for delivery.');
  const loc = { lat: num(c.body.lat, -90, 90, 'Invalid location.'), lng: num(c.body.lng, -180, 180, 'Invalid location.'), mode: c.body.mode === 'gps' ? 'gps' : 'sim', p: c.body.p == null ? null : num(c.body.p, 0, 1, 'Invalid progress.'), ts: Date.now() };
  run('UPDATE orders SET rider=? WHERE id=?', JSON.stringify(loc), o.id);
  emit('rider', { orderId: o.id, ...loc }, forOrder(o)); return { ok: true };
}, ['admin', 'rider']);
route('POST', '/api/orders/:id/rating', c => {
  const o = getOrder(+c.params.id); if (!o || o.userId !== c.user.id) throw httpErr(404, 'Order not found.');
  if (o.status !== 'delivered') throw httpErr(409, 'You can rate an order after it is delivered.');
  if (o.rating) throw httpErr(409, 'You have already rated this order.');
  const r = num(c.body.rating, 1, 5, 'Rating must be 1 to 5.'); if (!Number.isInteger(r)) throw httpErr(400, 'Rating must be 1 to 5.');
  run('UPDATE orders SET rating=?, review=? WHERE id=?', r, String(c.body.review || '').slice(0, 300), o.id);
  const n = getOrder(o.id); emit('order', n, forOrder(n)); return { order: n };
}, ['customer']);

route('GET', '/api/recommend', c => { const q = String(c.query.get('q') || '').slice(0, 200); if (!q.trim()) throw httpErr(400, 'Tell us what you feel like eating.'); return recommend(q, 5); });
route('GET', '/api/recommend/pairs', c => ({ results: pairs(String(c.query.get('ids') || '').split(',').filter(Boolean).slice(0, 30)) }));

const chatHits = new Map();
const topSellers = n => { const cnt = {}; for (const r of all("SELECT items FROM orders WHERE status != 'cancelled'")) for (const i of (J(r.items) || [])) cnt[i.id] = (cnt[i.id] || 0) + i.qty; const ids = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(x => x[0]); for (const d of all('SELECT id FROM dishes WHERE avail=1 ORDER BY sort')) if (!ids.includes(d.id)) ids.push(d.id); return ids.slice(0, n); };
route('POST', '/api/chat', async c => {
  const h = chatHits.get(c.ip) || { n: 0, t: Date.now() };
  if (Date.now() - h.t > 60000) { h.n = 0; h.t = Date.now(); }
  if (++h.n > (+process.env.CHAT_RATE || 30)) throw httpErr(429, 'You are sending messages very quickly. Please wait a minute.');
  chatHits.set(c.ip, h);
  const message = String(c.body.message || '').trim().slice(0, 500);
  if (!message) throw httpErr(400, 'Type a message first.');
  const cart = (Array.isArray(c.body.cart) ? c.body.cart : []).slice(0, 30).map(x => ({ id: String(x && x.id).slice(0, 40), qty: Math.min(20, Math.max(1, Math.round(Number(x && x.qty)) || 1)) }));
  const ctx = c.body.ctx && typeof c.body.ctx === 'object' ? { awaitAdd: typeof c.body.ctx.awaitAdd === 'string' ? c.body.ctx.awaitAdd.slice(0, 40) : undefined, lastDishes: Array.isArray(c.body.ctx.lastDishes) ? c.body.ctx.lastDishes.slice(0, 5).map(x => String(x).slice(0, 40)) : [] } : {};
  const deps = {
    dishes: () => all('SELECT * FROM dishes ORDER BY sort,rowid').map(dishOut), settings: getSettings, openNow, feeFor, hav,
    recommend, topSellers, userOrders: uid => all('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 20', uid).map(orderOut)
  };
  return await chat.reply({ message, history: c.body.history, ctx, cart, user: c.user, deps });
});

route('GET', '/api/stream', c => ({ stream: true }));

/* ------------------------------------------------------------------ http server */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
function send(res, code, obj) { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(b); }
async function readBody(req) {
  let n = 0; const chunks = [];
  for await (const ch of req) { n += ch.length; if (n > 6e6) throw httpErr(413, 'Request too large.'); chunks.push(ch); }
  if (!chunks.length) return {};
  try { const b = JSON.parse(Buffer.concat(chunks)); return b && typeof b === 'object' ? b : {}; } catch { throw httpErr(400, 'Invalid JSON.'); }
}
function serveStatic(req, res, pathname) {
  let f = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!f.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
    res.end(data);
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return req.method === 'GET' ? serveStatic(req, res, decodeURIComponent(url.pathname)) : (res.writeHead(405), res.end());
  try {
    const r = routes.find(x => x.method === req.method && x.re.test(url.pathname));
    if (!r) throw httpErr(404, 'Not found.');
    const m = url.pathname.match(r.re);
    const auth = (req.headers.authorization || '').replace(/^Bearer /, '') || url.searchParams.get('t');
    const p = verify(auth), user = p ? one('SELECT * FROM users WHERE id=?', p.uid) : null;
    if (r.roles && !user) throw httpErr(401, 'Please log in.');
    if (r.roles && !r.roles.includes(user.role)) throw httpErr(403, 'You do not have access to this.');
    const c = { req, res, user, params: m.groups || {}, query: url.searchParams, ip: req.socket.remoteAddress, body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {} };
    const out = await r.handler(c);
    if (out && out.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      const cl = { res, user: user ? { id: user.id, role: user.role } : null }; clients.add(cl);
      return req.on('close', () => clients.delete(cl));
    }
    const code = (out && out.status) || 200; if (out && out.status) delete out.status;
    send(res, code, out);
  } catch (e) {
    if (!e.code || typeof e.code !== 'number') console.error(e);
    send(res, typeof e.code === 'number' ? e.code : 500, { error: typeof e.code === 'number' ? e.message : 'Something went wrong on the server.' });
  }
});
if (require.main === module) server.listen(PORT, () => console.log(`PetPuja running at http://localhost:${PORT}`));
module.exports = { server, db, hashPw };
