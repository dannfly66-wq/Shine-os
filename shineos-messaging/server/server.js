/**
 * ShineOS Messaging Bridge Server
 * ================================
 * Receives webhook events from OpenClaw (customer messages via WhatsApp/iMessage)
 * and makes them available to the ShineOS dashboard via a simple API.
 *
 * Run: node server.js
 * Or:  npm start
 *
 * Then in OpenClaw skill, set:
 *   SHINEOS_WEBHOOK_URL=http://localhost:3099/webhook
 *   SHINEOS_API_KEY=your-secret-key
 */

import express from "express";
import cors    from "cors";
import crypto  from "crypto";

const app  = express();
const PORT = process.env.PORT || 3099;
const KEY  = process.env.SHINEOS_API_KEY || "shineos-local";

app.use(express.json());
app.use(cors({ origin: "*" })); // allow ShineOS dashboard to connect

// ── IN-MEMORY STORE (replace with SQLite for production) ──────────
const store = {
  messages:  [],   // all inbound/outbound messages
  bookings:  [],   // pending booking requests
  customers: {},   // phone → customer info
};

// ── AUTH MIDDLEWARE ───────────────────────────────────────────────
function auth(req, res, next) {
  const key = req.headers["x-shineos-key"];
  if (key !== KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ── WEBHOOK: receive events from OpenClaw skill ───────────────────
app.post("/webhook", auth, (req, res) => {
  const event = req.body;
  if (!event?.event) return res.status(400).json({ error: "Missing event" });

  const id = crypto.randomUUID();

  switch (event.event) {
    case "new_message":
      store.messages.unshift({
        id, type: "inbound",
        from:     event.from,
        name:     event.name || event.from,
        platform: event.platform || "whatsapp",
        body:     event.body,
        ts:       event.timestamp || Date.now(),
        read:     false,
      });
      // Upsert customer record
      if (!store.customers[event.from]) {
        store.customers[event.from] = { phone: event.from, name: event.name || event.from, platform: event.platform, firstSeen: Date.now() };
      }
      console.log(`[MSG] ${event.platform} from ${event.from}: ${event.body?.substring(0, 60)}`);
      break;

    case "reply_sent":
      store.messages.unshift({
        id, type: "outbound",
        to:       event.to,
        platform: event.platform || "whatsapp",
        body:     event.body,
        ts:       event.timestamp || Date.now(),
      });
      break;

    case "booking_request":
      store.bookings.unshift({
        id,
        from:    event.from,
        name:    event.name || event.from,
        service: event.service,
        date:    event.date,
        time:    event.time,
        raw:     event.rawText,
        ts:      event.timestamp || Date.now(),
        status:  "pending",
        platform: event.platform || "whatsapp",
      });
      console.log(`[BOOKING REQUEST] from ${event.from}: ${event.service} on ${event.date}`);
      break;

    default:
      console.log(`[EVENT] ${event.event}`, JSON.stringify(event).substring(0, 120));
  }

  // Keep stores trimmed
  if (store.messages.length > 500) store.messages.length = 500;
  if (store.bookings.length > 200) store.bookings.length = 200;

  res.json({ ok: true, id });
});

// ── API: ShineOS dashboard polls these ───────────────────────────

// Get all messages (paginated)
app.get("/api/messages", auth, (req, res) => {
  const limit  = parseInt(req.query.limit)  || 50;
  const offset = parseInt(req.query.offset) || 0;
  res.json({
    messages: store.messages.slice(offset, offset + limit),
    total:    store.messages.length,
    unread:   store.messages.filter(m => m.type === "inbound" && !m.read).length,
  });
});

// Mark message as read
app.patch("/api/messages/:id/read", auth, (req, res) => {
  const msg = store.messages.find(m => m.id === req.params.id);
  if (msg) msg.read = true;
  res.json({ ok: true });
});

// Get pending booking requests
app.get("/api/bookings/pending", auth, (req, res) => {
  res.json({ bookings: store.bookings.filter(b => b.status === "pending") });
});

// Confirm a booking request
app.post("/api/bookings/:id/confirm", auth, (req, res) => {
  const b = store.bookings.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: "Not found" });
  b.status = "confirmed";
  console.log(`[BOOKING CONFIRMED] ${b.name} — ${b.service} on ${b.date}`);
  res.json({ ok: true, booking: b });
});

// Send a reply message (posts back to OpenClaw's outbound API)
app.post("/api/reply", auth, async (req, res) => {
  const { to, body, platform } = req.body;
  if (!to || !body) return res.status(400).json({ error: "Missing to/body" });

  // Log as outbound
  store.messages.unshift({
    id: crypto.randomUUID(),
    type: "outbound", to, platform, body, ts: Date.now(),
  });

  // In production: POST to OpenClaw's send API
  // await fetch(`http://localhost:${OPENCLAW_PORT}/send`, { method:"POST", body: JSON.stringify({to,body,platform}) })

  console.log(`[REPLY] to ${to}: ${body.substring(0, 60)}`);
  res.json({ ok: true });
});

// Stats for dashboard
app.get("/api/stats", auth, (req, res) => {
  res.json({
    totalMessages:   store.messages.length,
    unread:          store.messages.filter(m => m.type === "inbound" && !m.read).length,
    pendingBookings: store.bookings.filter(b => b.status === "pending").length,
    totalCustomers:  Object.keys(store.customers).length,
    platforms:       [...new Set(store.messages.map(m => m.platform || "whatsapp"))],
  });
});

// Health check
app.get("/health", (req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.listen(PORT, () => {
  console.log(`\n🌸 ShineOS Bridge Server running on port ${PORT}`);
  console.log(`   Webhook:  http://localhost:${PORT}/webhook`);
  console.log(`   API:      http://localhost:${PORT}/api/...`);
  console.log(`   API Key:  ${KEY}`);
  console.log(`\n   Set in OpenClaw skill:`);
  console.log(`   SHINEOS_WEBHOOK_URL=http://localhost:${PORT}/webhook`);
  console.log(`   SHINEOS_API_KEY=${KEY}\n`);
});
