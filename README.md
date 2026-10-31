# PetPuja – single-restaurant ordering platform

Customer, admin and rider portals with live delivery tracking.
**No `npm install` and no database server needed.** It uses only Node.js built-ins (Node 22.5 or newer).

## Run it
```bash
node -v            # must be v22.5 or higher
npm start          # then open http://localhost:3000
npm test           # 26 automated tests (API + chatbot)
npm run demo       # optional: adds sample customers and a week of orders for demos
```
Demo accounts (created on first run): `admin@petpuja.in / admin123`, `rider@petpuja.in / rider123`.
Customers sign up themselves. **Before going live** set `ADMIN_PASSWORD`, `RIDER_PASSWORD` and `NODE_ENV=production`
(production mode also hides the demo passwords on the login screen).

## Try the whole flow (three browser windows, or one normal + two private windows)
1. **Customer**: add dishes, check out, drop a pin (or use GPS) and place the order.
2. **Admin** (Staff tab): accept the order. The customer's page updates by itself.
3. **Rider** (Staff tab): "Picked up", then "Share my live GPS" (on a phone) or "Simulate ride".
4. The customer sees the rider move on the map live, and can rate the order after delivery.

## Structure
| File | What it does |
|---|---|
| `server.js` | HTTP server, REST API, SQLite database, login and roles, live events, recommender |
| `public/index.html` | The whole front end (menu, cart, checkout, maps, admin and rider screens) |
| `chat.js` | The AI assistant (built-in language understanding + optional Claude mode) |
| `test.js`, `test-chat.js` | Automated tests: security, pricing, roles, hours, live tracking, recommender, chatbot |
| `seed-demo.js` | Sample data for demonstrations (`npm run demo`) |
| `SHOWCASE.md` | How to present the project without deploying it |
| `petpuja.db` | Created on first run. Delete it to reset all data |

## How the main parts work
* **Login and roles**: passwords hashed with scrypt, signed tokens (HMAC-SHA256, 7 days). The `customer / admin / rider` role is checked on the server for every protected route. Five failed logins lock that email for 15 minutes.
* **Server-side pricing**: the browser only sends dish ids and quantities. Prices, distance, delivery fee and total are recalculated on the server, so they cannot be tampered with.
* **Delivery fee**: `base` up to `freeKm`, then `perKm` for every extra km (rounded up), measured from the restaurant. Distance = straight line x 1.3. Admin > Settings changes every value, including the maximum distance.
* **Opening hours**: enforced on the server (India time). Admin can also pause orders.
* **Live tracking**: the rider's phone posts GPS to `/api/orders/:id/location`; the server pushes it only to that order's customer using Server-Sent Events (`/api/stream`).
* **Recommender**: `/api/recommend?q=` uses TF-IDF similarity plus rules for diet (veg / non-veg), budget ("under 250") and taste words. `/api/recommend/pairs` suggests "goes well with" from past orders.
* **Chat assistant** (`chat.js`, button at the bottom-right of every customer page): suggests dishes by taste, diet and budget, answers delivery-fee, opening-hour and payment questions from live settings, adds dishes to the cart ("add 2 butter naan"), shows the cart, and tells a logged-in customer where their order is. It works **offline with no API key**: rules + the TF-IDF recommender. Order data is only shown to the logged-in owner, and it never promises allergen safety.
  * **Optional Claude mode**: set `ANTHROPIC_API_KEY` (and optionally `CLAUDE_MODEL`, default `claude-haiku-4-5-20251001`). Claude then answers using tools (show dishes, add to cart, my orders). If the API is slow or fails, the built-in assistant answers instead. Tested against a stub server, not against the live API from this build environment. Chat messages are sent to Anthropic only in this mode.
* **Extras**: cancel (before cooking starts), order again, ratings and reviews, printable bill, admin search and date filter, new-order sound, average rating.

## API summary
`GET /api/bootstrap` · `POST /api/register` · `POST /api/login` · `GET /api/me` · `POST /api/orders` · `GET /api/orders/mine`
`POST /api/orders/:id/cancel|rating|location` · `PATCH /api/orders/:id/status` · `GET /api/admin/orders`
`POST /api/chat` · `POST|PUT|DELETE /api/dishes` · `PUT /api/settings` · `GET /api/recommend` · `GET /api/recommend/pairs` · `GET /api/stream`

## Deploying
Any host that runs Node 22+ and keeps a disk (Render, Railway, a VPS). Set `PORT`, `DB_PATH`, `ADMIN_PASSWORD`, `RIDER_PASSWORD`, `NODE_ENV=production`.
Use HTTPS: phone GPS only works on HTTPS or localhost.

## Not included (needs outside accounts or a decision)
* **Online payments**: Razorpay or Stripe need your own keys. Payment choices are cash, UPI or card *on delivery*.
* **SMS OTP, email verification, forgot-password**: need an SMS or email provider.
* **Street-level map and exact road distance**: the map is a built-in offline grid. Swap in Leaflet + OpenStreetMap and a routing API when online.
* **Real food photos**: upload them in Admin > Menu > Edit.

## Moving to Express + MongoDB (if your course requires MERN)
The API contract stays the same. Each `route(...)` in `server.js` becomes an `app.get/post/...`, each SQL table becomes a Mongoose model
(`User`, `Dish`, `Order`, `Settings`), and Server-Sent Events can become Socket.io. The front end only needs its `/api/stream` listener changed.
