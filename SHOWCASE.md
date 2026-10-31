# Showing PetPuja without deploying it

Everything runs on your own laptop. No internet is needed (fonts fall back to system fonts; the chatbot's built-in mode is offline).

## 1. Prepare (the day before)
1. Install Node 22.5+ (`node -v`). Unzip the project.
2. `npm test` once: all tests should pass (good to show live).
3. Start fresh: delete `petpuja.db`, then `npm run demo` (fills sample customers, a week of orders and ratings), then `npm start`.
4. Open `http://localhost:3000`. In Admin > Settings set the opening hours to the same start and end time (24 hours) so orders work at any time of day, and press "Use my current location" for the restaurant.
5. Record a 3 to 5 minute screen video of the full flow as a backup, and take screenshots.

## 2. Set up three windows
| Window | Log in as |
|---|---|
| Normal window | Customer (sign up or `priya@example.com` / `demo1234`) |
| Private window 1 | Staff tab: `admin@petpuja.in` / `admin123` |
| Private window 2 | Staff tab: `rider@petpuja.in` / `rider123` |
Each window keeps its own login, so all three roles can be shown side by side. Put them on one screen or switch with Alt+Tab.

## 3. Five-minute demo script
1. **Home (30 s)**: Veg tab is the default, switch to Non-veg, show category chips.
2. **Chatbot (60 s)**: open "Ask us". Type "spicy non veg under 250", then "add the first one", then "delivery charges for 8 km".
3. **Order (60 s)**: Checkout, drop a pin on the map, show the distance-based fee, place the order.
4. **Kitchen (45 s)**: in the admin window the order appears with a beep. Show the exact location box and press "Accept & start cooking".
5. **Rider + live tracking (90 s)**: rider window: "Picked up", then "Simulate ride (demo)". Switch to the customer window: the scooter moves on the map. Ask the chatbot "where is my order?".
6. **Finish (30 s)**: "Mark delivered", rate the order, open the bill, show the admin Overview with the new rating.

## 4. Showing it on a phone, still without deploying
* Same Wi-Fi: find your laptop's IP (`ipconfig` on Windows, `ifconfig` on Mac/Linux) and open `http://YOUR-IP:3000` on the phone. Allow Node through the firewall if asked.
* A phone blocks GPS on plain `http://` addresses. Use the map pin for the customer, and the "Simulate ride" button for the rider.
* No Wi-Fi? Turn on the phone's hotspot and connect the laptop to it.

## 5. What to prepare for questions
* **"Is the chatbot really AI?"** Built-in mode is natural-language rules plus TF-IDF text similarity (a classic information-retrieval technique) and runs offline. It becomes a large language model (Claude) only if an API key is set. Say which mode you are showing.
* **"Why Node and SQLite, not Express and MongoDB?"** Zero dependencies means it runs anywhere with one command. The README explains how each part maps to Express and Mongoose.
* **"Is it secure?"** Passwords are hashed (scrypt), roles are checked on the server, prices are recalculated on the server, login attempts are limited. Say honestly what is not done: online payments, SMS OTP, HTTPS (needed when deployed).
* **"What would you add next?"** Razorpay payments, OTP login, real map tiles (Leaflet), push notifications.

## 6. Checklist for the day
- [ ] Laptop charged, charger packed
- [ ] `npm start` running before you walk in
- [ ] Three windows logged in, browser zoom at 100%
- [ ] Backup video and the PDF wireframes on a USB stick or phone
- [ ] Printed wireframes (PDF pages 4 to 16) for the table
