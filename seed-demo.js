'use strict';
/* Fills the database with sample customers and a week of orders so the admin Overview, best sellers
   and ratings look alive in a demo.   Usage:  npm run demo      (safe to run more than once) */
const { db, hashPw } = require('./server');
const J = JSON.stringify;
const resto = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='main'").get()?.value || 'null') || { resto: { lat: 10.8190, lng: 78.6857 }, fee: { base: 20, freeKm: 2, perKm: 8 } };
const R = resto.resto, F = resto.fee || { base: 20, freeKm: 2, perKm: 8 };
if (db.prepare("SELECT id FROM users WHERE email='priya@example.com'").get()) { console.log('Demo data already present. Nothing to do.'); process.exit(0); }
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];
const people = [['Priya Raman', 'priya@example.com', '9840012345'], ['Arun Kumar', 'arun@example.com', '9791123456'], ['Meena Sundar', 'meena@example.com', '9884098765'], ['Karthik S', 'karthik@example.com', '9500011122'], ['Divya Nair', 'divya@example.com', '9443366778'], ['Faisal Ahmed', 'faisal@example.com', '9344455667']];
const streets = ['Anna Nagar', 'Thillai Nagar', 'Srirangam', 'Woraiyur', 'Cantonment', 'KK Nagar'];
const ids = people.map(([n, e, p], i) => Number(db.prepare('INSERT INTO users(name,email,pass,role,phone,created) VALUES(?,?,?,?,?,?)').run(n, e, hashPw('demo1234'), 'customer', p, Date.now() - 8 * 864e5).lastInsertRowid));
const dishes = db.prepare('SELECT id,name,price FROM dishes WHERE avail=1').all();
const weights = { d4: 5, d1: 5, d3: 4, d9: 3, d17: 4, d7: 3, d12: 3, d11: 2, d14: 3, d16: 2 };
const bag = dishes.flatMap(d => Array(weights[d.id] || 1).fill(d));
const reviews = ['Tasty and hot!', 'Delivery was quick.', 'Loved the biryani.', 'Good value.', 'Portion could be bigger.', ''];
let nextId = db.prepare('SELECT COALESCE(MAX(id),1000)+1 AS n FROM orders').get().n;
function add(daysAgo, status, rating) {
  const uIdx = Math.floor(rnd() * people.length), items = [];
  const n = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) { const d = pick(bag); const ex = items.find(x => x.id === d.id); if (ex) ex.qty++; else items.push({ id: d.id, name: d.name, qty: 1 + Math.floor(rnd() * 2), price: d.price }); }
  const sub = items.reduce((a, x) => a + x.price * x.qty, 0), km = Math.round((1 + rnd() * 9) * 10) / 10, fee = km <= F.freeKm ? F.base : F.base + Math.ceil(km - F.freeKm) * F.perKm;
  const loc = { lat: R.lat + (rnd() - .5) * .08, lng: R.lng + (rnd() - .5) * .08, acc: 15, src: rnd() > .4 ? 'gps' : 'pin' };
  const created = Date.now() - daysAgo * 864e5 - Math.floor(rnd() * 8) * 36e5;
  db.prepare('INSERT INTO orders(id,user_id,customer,phone,address,loc,dist_km,note,payment,items,subtotal,fee,total,status,created,rating,review) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(nextId++, ids[uIdx], people[uIdx][0], people[uIdx][2], `${Math.floor(rnd() * 90) + 1}, ${pick(streets)}, Trichy`, J(loc), km, '', pick(['Cash on delivery', 'UPI on delivery', 'Card on delivery']), J(items), sub, fee, sub + fee, status, created, rating || null, rating ? pick(reviews) : null);
}
for (let d = 7; d >= 1; d--) for (let k = 0; k < 2 + Math.floor(rnd() * 3); k++) add(d, 'delivered', rnd() > .3 ? 3 + Math.floor(rnd() * 3) : 0);
add(2, 'cancelled', 0); add(0.02, 'placed', 0); add(0.05, 'preparing', 0);
console.log(`Added ${people.length} demo customers (password: demo1234) and sample orders.`);
process.exit(0);
