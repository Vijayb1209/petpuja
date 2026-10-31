'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');

const PORT = 34000 + Math.floor(Math.random() * 1000), BASE = `http://localhost:${PORT}`;
const DB = path.join(os.tmpdir(), `petpuja-test-${Date.now()}.db`);
let proc;
const api = async (p, { method = 'GET', body, token } = {}) => {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
before(async () => {
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, 'server.js')], { env: { ...process.env, PORT, DB_PATH: DB }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/health')).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
after(() => { proc.kill(); for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(DB + s); } catch {} });

let admin, rider, cust, cust2, orderId;
const near = { lat: 10.8190, lng: 78.6857 };              /* at the restaurant */
const far = { lat: 10.8190, lng: 78.7857 };               /* ~11 km east */
const tooFar = { lat: 10.8190, lng: 79.3857 };            /* ~70 km east */
const addr = '12 Anna Nagar, Trichy 620001';
const order = (token, over = {}) => api('/api/orders', { method: 'POST', token, body: { name: 'Ravi', phone: '9876543210', address: addr, loc: { ...near, src: 'pin' }, payment: 'Cash on delivery', items: [{ id: 'd1', qty: 2 }], ...over } });

test('bootstrap returns menu with veg/non-veg and settings', async () => {
  const r = await api('/api/bootstrap');
  assert.equal(r.status, 200); assert.ok(r.body.menu.length >= 17);
  assert.ok(r.body.menu.some(d => d.veg) && r.body.menu.some(d => !d.veg));
  assert.equal(r.body.settings.fee.base, 20);
});
test('staff and customer portals are separate', async () => {
  admin = (await api('/api/login', { method: 'POST', body: { email: 'admin@petpuja.in', password: 'admin123', portal: 'staff' } })).body;
  rider = (await api('/api/login', { method: 'POST', body: { email: 'rider@petpuja.in', password: 'rider123', portal: 'staff' } })).body;
  assert.equal(admin.user.role, 'admin'); assert.equal(rider.user.role, 'rider');
  const wrong = await api('/api/login', { method: 'POST', body: { email: 'admin@petpuja.in', password: 'admin123', portal: 'customer' } });
  assert.equal(wrong.status, 403);
  const bad = await api('/api/login', { method: 'POST', body: { email: 'admin@petpuja.in', password: 'nope', portal: 'staff' } });
  assert.equal(bad.status, 401);
});
test('registration validates phone, password and duplicates', async () => {
  const base = { name: 'Ravi', email: 'ravi@example.com', password: 'secret123', phone: '9876543210' };
  assert.equal((await api('/api/register', { method: 'POST', body: { ...base, phone: '5123456789' } })).status, 400);
  assert.equal((await api('/api/register', { method: 'POST', body: { ...base, phone: '98765' } })).status, 400);
  assert.equal((await api('/api/register', { method: 'POST', body: { ...base, password: 'short' } })).status, 400);
  const ok = await api('/api/register', { method: 'POST', body: { ...base, phone: '+91 98765-43210' } });
  assert.equal(ok.status, 201); assert.equal(ok.body.user.phone, '9876543210'); cust = ok.body;
  assert.equal((await api('/api/register', { method: 'POST', body: base })).status, 409);
  cust2 = (await api('/api/register', { method: 'POST', body: { ...base, name: 'Meena', email: 'meena@example.com' } })).body;
});
test('role checks are enforced on the server', async () => {
  assert.equal((await api('/api/admin/orders')).status, 401);
  assert.equal((await api('/api/admin/orders', { token: cust.token })).status, 403);
  assert.equal((await api('/api/dishes', { method: 'POST', token: cust.token, body: { name: 'x', price: 1, cat: 'Meals', veg: true } })).status, 403);
  assert.equal((await api('/api/settings', { method: 'PUT', token: rider.token, body: {} })).status, 403);
  assert.equal((await api('/api/orders', { method: 'POST', token: admin.token, body: {} })).status, 403);
  assert.equal((await api('/api/me', { token: cust.token + 'x' })).status, 401);
});
test('opening hours are enforced (and can be switched off)', async () => {
  const closed = await api('/api/settings', { method: 'PUT', token: admin.token, body: { hours: { open: '00:00', close: '00:01', accepting: false } } });
  assert.equal(closed.status, 200);
  const r = await order(cust.token); assert.equal(r.status, 409); assert.match(r.body.error, /not taking orders/);
  await api('/api/settings', { method: 'PUT', token: admin.token, body: { hours: { open: '00:00', close: '00:00', accepting: true } } });
});
test('order totals are computed by the server, not the client', async () => {
  const r = await order(cust.token, { items: [{ id: 'd1', qty: 2, price: 1 }], total: 1, fee: 0 });
  assert.equal(r.status, 201); orderId = r.body.order.id;
  assert.equal(r.body.order.subtotal, 360); assert.equal(r.body.order.fee, 20); assert.equal(r.body.order.total, 380);
});
test('delivery fee grows with distance and far addresses are refused', async () => {
  const r = await order(cust.token, { loc: { ...far, src: 'gps', acc: 12 } });
  assert.equal(r.status, 201); assert.ok(r.body.order.distKm > 10 && r.body.order.distKm < 16);
  const km = r.body.order.distKm; assert.equal(r.body.order.fee, 20 + Math.ceil(km - 2) * 8);
  assert.equal((await order(cust.token, { loc: { ...tooFar, src: 'pin' } })).status, 400);
});
test('input validation: phone, address, qty, payment, unavailable dish', async () => {
  assert.equal((await order(cust.token, { phone: '1234567890' })).status, 400);
  assert.equal((await order(cust.token, { address: 'short' })).status, 400);
  assert.equal((await order(cust.token, { items: [{ id: 'd1', qty: 0 }] })).status, 400);
  assert.equal((await order(cust.token, { items: [{ id: 'd1', qty: 99 }] })).status, 400);
  assert.equal((await order(cust.token, { items: [{ id: 'nope', qty: 1 }] })).status, 409);
  assert.equal((await order(cust.token, { payment: 'Bitcoin' })).status, 400);
  assert.equal((await order(cust.token, { loc: undefined })).status, 400);
  await api('/api/dishes/d2', { method: 'PUT', token: admin.token, body: { on: false } });
  const r = await order(cust.token, { items: [{ id: 'd2', qty: 1 }] }); assert.equal(r.status, 409); assert.match(r.body.error, /sold out/);
  await api('/api/dishes/d2', { method: 'PUT', token: admin.token, body: { on: true } });
});
test('customers only see their own orders; admin sees all', async () => {
  const mine = await api('/api/orders/mine', { token: cust.token }); assert.ok(mine.body.orders.length >= 2);
  assert.equal((await api('/api/orders/mine', { token: cust2.token })).body.orders.length, 0);
  assert.ok((await api('/api/admin/orders', { token: admin.token })).body.orders.length >= 2);
  assert.equal((await api(`/api/orders/${orderId}/cancel`, { method: 'POST', token: cust2.token })).status, 404);
});
test('order status flow, rider permissions and location sharing', async () => {
  const patch = (token, status) => api(`/api/orders/${orderId}/status`, { method: 'PATCH', token, body: { status } });
  assert.equal((await patch(cust.token, 'preparing')).status, 403);
  assert.equal((await patch(admin.token, 'delivered')).status, 409);           /* cannot skip steps */
  assert.equal((await api(`/api/orders/${orderId}/location`, { method: 'POST', token: rider.token, body: near })).status, 409); /* not on the way yet */
  assert.equal((await patch(rider.token, 'preparing')).status, 403);          /* riders cannot accept */
  assert.equal((await patch(admin.token, 'preparing')).status, 200);
  assert.equal((await api(`/api/orders/${orderId}/cancel`, { method: 'POST', token: cust.token })).status, 409); /* kitchen started */
  assert.equal((await patch(rider.token, 'onway')).status, 200);
  assert.equal((await api(`/api/orders/${orderId}/location`, { method: 'POST', token: cust.token, body: near })).status, 403);
  assert.equal((await api(`/api/orders/${orderId}/location`, { method: 'POST', token: rider.token, body: { lat: 'x', lng: 1 } })).status, 400);
  assert.equal((await api(`/api/orders/${orderId}/location`, { method: 'POST', token: rider.token, body: { ...near, mode: 'gps' } })).status, 200);
});
test('live rider location is pushed to the right customer only', async () => {
  const open = async token => { const ctl = new AbortController(); const r = await fetch(`${BASE}/api/stream?t=${token}`, { signal: ctl.signal }); return { ctl, reader: r.body.getReader(), buf: '' }; };
  const read = async (s, ms = 2500) => { const end = Date.now() + ms; while (Date.now() < end && !/event: rider/.test(s.buf)) { const t = await Promise.race([s.reader.read(), new Promise(r => setTimeout(() => r(null), 300))]); if (t && t.value) s.buf += Buffer.from(t.value).toString(); } return s.buf; };
  const a = await open(cust.token), b = await open(cust2.token);
  await new Promise(r => setTimeout(r, 300));
  await api(`/api/orders/${orderId}/location`, { method: 'POST', token: rider.token, body: { lat: 10.83, lng: 78.69, mode: 'gps' } });
  const got = await read(a), other = await read(b, 800);
  assert.match(got, /event: rider/); assert.match(got, /"lat":10.83/);
  assert.doesNotMatch(other, /event: rider/);
  a.ctl.abort(); b.ctl.abort();
});
test('delivery, rating and one-time review', async () => {
  const rate = (token, rating) => api(`/api/orders/${orderId}/rating`, { method: 'POST', token, body: { rating, review: 'Tasty' } });
  assert.equal((await api(`/api/orders/${orderId}/status`, { method: 'PATCH', token: rider.token, body: { status: 'delivered' } })).status, 200);
  assert.equal((await rate(cust.token, 9)).status, 400);
  assert.equal((await rate(cust2.token, 5)).status, 404);
  assert.equal((await rate(cust.token, 5)).body.order.rating, 5);
  assert.equal((await rate(cust.token, 4)).status, 409);
});
test('customer can cancel only while the order is still "placed"', async () => {
  const o = (await order(cust.token)).body.order;
  const r = await api(`/api/orders/${o.id}/cancel`, { method: 'POST', token: cust.token });
  assert.equal(r.body.order.status, 'cancelled');
});
test('menu management: add, validate, hide, delete', async () => {
  assert.equal((await api('/api/dishes', { method: 'POST', token: admin.token, body: { name: '', price: 10, cat: 'Meals', veg: true } })).status, 400);
  assert.equal((await api('/api/dishes', { method: 'POST', token: admin.token, body: { name: 'Test', price: 10, cat: 'Pizza', veg: true } })).status, 400);
  assert.equal((await api('/api/dishes', { method: 'POST', token: admin.token, body: { name: 'T', price: 10, cat: 'Meals', veg: true, img: 'javascript:alert(1)' } })).status, 400);
  const d = (await api('/api/dishes', { method: 'POST', token: admin.token, body: { name: 'Lemon rice', price: 80, cat: 'Meals', veg: true } })).body.dish;
  assert.equal(d.on, true);
  assert.equal((await api('/api/dishes/' + d.id, { method: 'DELETE', token: admin.token })).status, 200);
  assert.ok(!(await api('/api/bootstrap')).body.menu.some(x => x.id === d.id));
});
test('recommender understands diet, budget and taste words', async () => {
  const get = q => api('/api/recommend?q=' + encodeURIComponent(q));
  const spicy = (await get('something spicy non veg under 250')).body;
  assert.equal(spicy.diet, 'nonveg'); assert.equal(spicy.budget, 250); assert.ok(spicy.results.length);
  const menu = (await api('/api/bootstrap')).body.menu, byId = Object.fromEntries(menu.map(d => [d.id, d]));
  assert.ok(spicy.results.every(r => !byId[r.id].veg && byId[r.id].price <= 250));
  const sweet = (await get('something sweet and cold')).body.results; assert.equal(sweet[0].id, 'd13');
  const veg = (await get('light veg lunch')).body.results; assert.ok(veg.every(r => byId[r.id].veg));
  assert.equal((await api('/api/recommend?q=')).status, 400);
  const p = (await api('/api/recommend/pairs?ids=d3,d16')).body.results; assert.ok(p.length && p.every(r => r.id !== 'd3' && r.id !== 'd16'));
});
test('static page is served and path traversal is blocked', async () => {
  assert.equal((await fetch(BASE + '/')).status, 200);
  assert.notEqual((await fetch(BASE + '/..%2f..%2fserver.js')).status, 200);
});
