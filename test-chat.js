'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');

const rnd = () => 35000 + Math.floor(Math.random() * 2000);
const PORT = rnd(), PORT2 = PORT + 2000, STUB = rnd() + 3000;
const PORT3 = PORT + 4000, DB3 = os.tmpdir() + `/petpuja-chat3-${Date.now()}.db`;
const BASE = `http://localhost:${PORT}`, BASE2 = `http://localhost:${PORT2}`, BASE3 = `http://localhost:${PORT3}`;
const DB = path.join(os.tmpdir(), `petpuja-chat-${Date.now()}.db`), DB2 = DB + '2';
let p1, p2, p3, stub, stubMode = 'tools', stubCalls = [];

const api = async (base, p, { method = 'GET', body, token } = {}) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const start = async (port, db, env) => {
  const pr = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, 'server.js')], { env: { ...process.env, PORT: port, DB_PATH: db, ...env }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) return pr; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('server did not start');
};
before(async () => {
  stub = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      const body = JSON.parse(b || '{}'); stubCalls.push({ headers: req.headers, body, url: req.url });
      res.setHeader('content-type', 'application/json');
      if (stubMode === 'error') { res.statusCode = 500; return res.end('{"error":"boom"}'); }
      const hasResult = body.messages.some(m => Array.isArray(m.content) && m.content.some(x => x.type === 'tool_result'));
      if (!hasResult) return res.end(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'text', text: 'Let me check.' }, { type: 'tool_use', id: 't1', name: 'show_dishes', input: { dish_ids: ['d3', 'nope'] } }, { type: 'tool_use', id: 't2', name: 'add_to_cart', input: { dish_id: 'd17', quantity: 2 } }, { type: 'tool_use', id: 't3', name: 'add_to_cart', input: { dish_id: 'zzz', quantity: 1 } }] }));
      res.end(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Try the Chettinad biryani, and I added 2 naan.' }] }));
    });
  }).listen(STUB);
  p1 = await start(PORT, DB, { CHAT_RATE: '500' });
  p2 = await start(PORT2, DB2, { CHAT_RATE: '500', ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://localhost:${STUB}` });
  p3 = await start(PORT3, DB3, { CHAT_RATE: '5' });
  await api(BASE, '/api/settings', { method: 'PUT', token: (await api(BASE, '/api/login', { method: 'POST', body: { email: 'admin@petpuja.in', password: 'admin123', portal: 'staff' } })).body.token, body: { hours: { open: '00:00', close: '00:00', accepting: true } } });
});
after(() => { p1 && p1.kill(); p2 && p2.kill(); p3 && p3.kill(); stub && stub.close(); for (const d of [DB, DB2, DB3]) for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(d + s); } catch {} });

const say = (message, extra = {}, base = BASE, token) => api(base, '/api/chat', { method: 'POST', token, body: { message, ...extra } });

test('greeting, thanks, empty and long input', async () => {
  const g = await say('Hi there'); assert.equal(g.status, 200); assert.equal(g.body.mode, 'local'); assert.match(g.body.reply, /assistant/i);
  assert.match((await say('thank you!')).body.reply, /welcome/i);
  assert.equal((await say('   ')).status, 400);
  assert.equal((await say('x'.repeat(5000))).status, 200);
});
test('recommendations respect diet, budget and taste', async () => {
  const menu = (await api(BASE, '/api/bootstrap')).body.menu, by = Object.fromEntries(menu.map(d => [d.id, d]));
  const r = (await say('something spicy non veg under 250')).body;
  assert.ok(r.dishes.length && r.dishes.every(id => !by[id].veg && by[id].price <= 250));
  const v = (await say('light veg lunch')).body; assert.ok(v.dishes.length && v.dishes.every(id => by[id].veg));
  const s = (await say('I want something sweet and cold')).body; assert.equal(s.dishes[0], 'd13');
  assert.match((await say('veg dish under 20 rupees')).body.reply, /couldn't find/i);
});
test('add to cart by name, quantity, ambiguity and pronouns', async () => {
  const a = (await say('add 2 butter naan')).body; assert.deepEqual(a.actions, [{ type: 'add', id: 'd17', qty: 2 }]);
  const w = (await say('I want three masala dosa please')).body; assert.deepEqual(w.actions, [{ type: 'add', id: 'd7', qty: 3 }]);
  const n = (await say('order chicken 65')).body; assert.deepEqual(n.actions, [{ type: 'add', id: 'd9', qty: 1 }]);   /* "65" is part of the name, not a quantity */
  const amb = (await say('add biryani')).body; assert.equal(amb.actions.length, 0); assert.ok(amb.dishes.length >= 2);
  const info = (await say('what is in the paneer butter masala?')).body; assert.equal(info.dishes[0], 'd14'); assert.equal(info.ctx.awaitAdd, 'd14');
  const yes = (await say('yes', { ctx: info.ctx })).body; assert.deepEqual(yes.actions, [{ type: 'add', id: 'd14', qty: 1 }]);
  const it = (await say('add it', { ctx: { lastDishes: ['d11'] } })).body; assert.deepEqual(it.actions, [{ type: 'add', id: 'd11', qty: 1 }]);
  const second = (await say('add the second one', { ctx: { lastDishes: ['d1', 'd2'] } })).body; assert.equal(second.actions[0].id, 'd2');
});
test('sold-out dishes cannot be added through the chat', async () => {
  const t = (await api(BASE, '/api/login', { method: 'POST', body: { email: 'admin@petpuja.in', password: 'admin123', portal: 'staff' } })).body.token;
  await api(BASE, '/api/dishes/d12', { method: 'PUT', token: t, body: { on: false } });
  const r = (await say('add filter coffee')).body; assert.equal(r.actions.length, 0); assert.match(r.reply, /sold out/i);
  await api(BASE, '/api/dishes/d12', { method: 'PUT', token: t, body: { on: true } });
});
test('shop info answers come from live settings', async () => {
  assert.match((await say('what are your opening hours?')).body.reply, /00:00 to 00:00/);
  assert.match((await say('delivery charges for 5 km')).body.reply, /₹44/);
  assert.match((await say('how much is delivery for 30 km')).body.reply, /beyond/);
  assert.match((await say('what are the delivery charges')).body.reply, /₹20 up to 2 km/);
  assert.match((await say('can I pay by UPI')).body.reply, /on delivery/i);
  assert.match((await say('is this nut free? I have a peanut allergy')).body.reply, /phone the restaurant/i);
  assert.match((await say('I want a refund')).body.reply, /contact the restaurant/i);
});
test('cart questions use the cart sent by the browser', async () => {
  const r = (await say('show my cart', { cart: [{ id: 'd1', qty: 2 }, { id: 'd17', qty: 1 }] })).body; assert.match(r.reply, /2 × Banana-leaf meals/); assert.match(r.reply, /₹420/);
  assert.match((await say('show my cart', { cart: [] })).body.reply, /empty/i);
});
test('order status needs login and is private to the customer', async () => {
  assert.match((await say('where is my order?')).body.reply, /log in/i);
  const reg = async (email) => (await api(BASE, '/api/register', { method: 'POST', body: { name: 'T', email, password: 'secret123', phone: '9876543210' } })).body;
  const a = await reg('a@x.com'), b = await reg('b@x.com');
  const o = await api(BASE, '/api/orders', { method: 'POST', token: a.token, body: { name: 'A', phone: '9876543210', address: '12 Anna Nagar, Trichy', loc: { lat: 10.819, lng: 78.6857, src: 'pin' }, payment: 'Cash on delivery', items: [{ id: 'd1', qty: 1 }] } });
  assert.equal(o.status, 201);
  const mine = (await say('where is my order', {}, BASE, a.token)).body; assert.match(mine.reply, new RegExp('#' + o.body.order.id)); assert.match(mine.reply, /waiting for the kitchen/);
  assert.match((await say('where is my order', {}, BASE, b.token)).body.reply, /haven't placed/i);
  assert.match((await say('cancel my order', {}, BASE, a.token)).body.reply, /Cancel order/);
});
test('chat input is sanitised and rate limited', async () => {
  const r = await say('show my cart', { cart: [{ id: '<script>', qty: 9999 }, null, 5], history: 'nope', ctx: 'bad' }); assert.equal(r.status, 200);
  let last; for (let i = 0; i < 6; i++) last = await say('hi', {}, BASE3); assert.equal(last.status, 429);
});
test('Claude mode: tool calls become dish cards and cart actions; API receives a valid request', async () => {
  stubCalls = []; stubMode = 'tools';
  const r = await say('suggest something spicy and add two naan', { history: [{ role: 'bot', text: 'Hello' }, { role: 'user', text: 'hi' }] }, BASE2);
  assert.equal(r.status, 200); assert.equal(r.body.mode, 'claude'); assert.match(r.body.reply, /Chettinad/);
  assert.deepEqual(r.body.dishes, ['d3']); assert.deepEqual(r.body.actions, [{ type: 'add', id: 'd17', qty: 2 }]);
  assert.equal(stubCalls.length, 2);
  const c = stubCalls[0]; assert.equal(c.url, '/v1/messages'); assert.equal(c.headers['x-api-key'], 'test-key'); assert.equal(c.headers['anthropic-version'], '2023-06-01');
  assert.match(c.body.model, /^claude-/); assert.equal(c.body.messages[0].role, 'user'); assert.equal(c.body.messages.at(-1).role, 'user');
  assert.ok(c.body.tools.map(t => t.name).includes('add_to_cart')); assert.match(c.body.system, /Banana-leaf meals/); assert.match(c.body.system, /untrusted/);
  const results = stubCalls[1].body.messages.at(-1).content; assert.equal(results.length, 3); assert.match(results[2].content, /Unknown dish/);
});
test('Claude mode falls back to the built-in assistant when the API fails', async () => {
  stubMode = 'error';
  const r = await say('add 2 butter naan', {}, BASE2); assert.equal(r.status, 200); assert.equal(r.body.mode, 'local'); assert.deepEqual(r.body.actions, [{ type: 'add', id: 'd17', qty: 2 }]);
});
