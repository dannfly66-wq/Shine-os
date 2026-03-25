/**
 * ShineOS OpenClaw Skill
 * Handles incoming customer messages on WhatsApp / iMessage / Telegram
 * and connects them to the ShineOS dashboard + Shine AI.
 *
 * Install: copy this folder into your OpenClaw skills directory
 * or run: clawhub install ./shineos-skill
 */

import Anthropic from "@anthropic-ai/sdk";
import fetch from "node-fetch";

// ── CONFIG ────────────────────────────────────────────────────────
const WEBHOOK_URL = process.env.SHINEOS_WEBHOOK_URL || "http://localhost:3099/webhook";
const API_KEY     = process.env.SHINEOS_API_KEY     || "shineos-local";
const ANTH_KEY    = process.env.ANTHROPIC_API_KEY   || "";

const client = ANTH_KEY ? new Anthropic({ apiKey: ANTH_KEY }) : null;

// ── BUSINESS KNOWLEDGE ────────────────────────────────────────────
const BUSINESS_SYSTEM_PROMPT = `You are Shine AI, the friendly customer-facing assistant for ShineOS Mobile Detailing.

BUSINESS:
- Mobile car detailing — we come to YOU. No need to drive anywhere.
- Specialising in Uber/Lyft drivers and nurses (we come to your parking lot while you work!)
- Operated by two friendly technicians
- Based in Canada

SERVICES & PRICING:
- Basic Interior Vacuum: $70 (45 min)
- Exterior Wash + Dry: $90 (1 hr)
- Full Interior Detail: $130 (2–2.5 hrs)
- Full Interior + Exterior: $180 (3 hrs) ← MOST POPULAR
- Uber/Lyft Driver Package: $110 (2 hrs) — perfect for ride-share drivers
- Nurse Parking Lot Special: $140 (2 hrs) — we come to your hospital parking lot
- Monthly Maintenance Plan: $250/month (2 cleans/month) ← BEST VALUE
- Add-ons: Odour Elimination +$50, Pet Hair Removal +$60, Wax/Sealant +$100

HOW TO BOOK:
Customers reply with: name, preferred date/time, address or workplace, and service.
We confirm within 30 minutes.

TONE:
- Warm, friendly, professional
- Use ✨ and 🌸 occasionally — it fits our pink brand
- Keep responses concise — this is a text message, not an essay
- Always end with a clear call to action

IMPORTANT:
- If someone wants to book, collect: their name, preferred date, time, service, and location
- If unsure about availability, say "We'll confirm within 30 minutes"
- Never promise a specific time slot — say "we'll check and confirm"
- Payment: Cash, E-transfer, or Credit Card (Square)`;

// ── CONVERSATION MEMORY (per phone number) ────────────────────────
const conversations = new Map(); // phone → [{role, content}]

function getHistory(phone) {
  if (!conversations.has(phone)) conversations.set(phone, []);
  return conversations.get(phone);
}

function addToHistory(phone, role, content) {
  const hist = getHistory(phone);
  hist.push({ role, content });
  // Keep last 10 turns per customer
  if (hist.length > 10) hist.splice(0, hist.length - 10);
}

// ── INTENT DETECTION ─────────────────────────────────────────────
function detectIntent(text) {
  const t = text.toLowerCase();
  if (/\b(price|cost|how much|rate|charge|fee)\b/.test(t)) return "pricing";
  if (/\b(book|schedule|appointment|available|when|slot)\b/.test(t)) return "booking";
  if (/\b(cancel|reschedule|change|move)\b/.test(t)) return "reschedule";
  if (/\b(uber|lyft|rideshare|driver)\b/.test(t)) return "uber";
  if (/\b(nurse|hospital|parking|work)\b/.test(t)) return "nurse";
  if (/\b(monthly|regular|subscription|plan)\b/.test(t)) return "monthly";
  if (/\b(where|location|address|come to|travel)\b/.test(t)) return "location";
  if (/\b(hi|hello|hey|good morning|good afternoon|yo)\b/.test(t)) return "greeting";
  return "general";
}

// ── QUICK REPLIES (no AI call needed) ─────────────────────────────
const QUICK_REPLIES = {
  greeting: `Hey! 🌸 Welcome to ShineOS Mobile Detailing!\n\nWe come TO YOU — your driveway, workplace, or parking lot. No need to drive anywhere!\n\nReply with:\n• PRICES — to see our menu\n• BOOK — to make an appointment\n• INFO — to learn more\n\nHow can we help? ✨`,

  pricing: `✨ Our Services & Pricing:\n\n💎 Full Interior + Exterior — $180 (most popular!)\n🧹 Full Interior Detail — $130\n🚿 Exterior Wash + Dry — $90\n🚗 Basic Vacuum & Wipe — $70\n\n🚙 Uber/Lyft Driver Package — $110\n🏥 Nurse Parking Lot Special — $140\n📅 Monthly Plan (2x/month) — $250\n\nAdd-ons: Odour +$50 | Pet Hair +$60\n\nTo book, just reply with your name, preferred date/time, and service! 🌸`,

  location: `We come to YOU! 🚗✨\n\nWe can come to:\n• Your home or driveway\n• Your workplace parking lot\n• Hospital parking (nurses love this!)\n• Uber/Lyft pickup zones\n\nJust let us know your address when booking and we'll be there! 🌸`,

  uber: `Hey! We LOVE working with Uber/Lyft drivers 🚗\n\nOur **Uber/Lyft Driver Package** is $110 and includes:\n• Full interior deep clean\n• Odour treatment\n• Window clean\n• ~2 hours\n\nA clean car = better ratings = more money! 💰\n\nWant to book? Reply with your name, preferred date and time, and your location ✨`,

  nurse: `Thank you for everything you do! 🏥🌸\n\nOur **Nurse Parking Lot Special** is $140 — we come to your hospital or clinic parking lot WHILE YOU'RE AT WORK.\n\nYou come out to a spotless car after your shift 😍\n\nFull interior detail, 2 hours, $140.\n\nTo book, reply with:\n• Your name\n• Hospital/workplace name\n• Preferred date & shift end time\n\nWe'll take it from there! ✨`,

  monthly: `Our Monthly Plan is the best deal we offer! 💅\n\n**$250/month** = 2 full details per month\n• Save $110 vs paying per visit\n• Priority booking\n• Same techs every time (we learn your car!)\n\nPerfect for nurses, Uber drivers, or anyone who wants a permanently clean car 🌸\n\nInterested? Reply YES and we'll get you set up!`,
};

// ── AI RESPONSE (for complex/general queries) ─────────────────────
async function getAIResponse(phone, message) {
  if (!client) {
    return "Thanks for reaching out! We'll get back to you shortly. To book, just send us your name, preferred date/time, and service. 🌸";
  }

  addToHistory(phone, "user", message);

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001", // fast + cheap for customer messages
      max_tokens: 300,
      system: BUSINESS_SYSTEM_PROMPT,
      messages: getHistory(phone),
    });

    const reply = response.content[0]?.text || "Thanks for your message! We'll be in touch shortly. 🌸";
    addToHistory(phone, "assistant", reply);
    return reply;
  } catch (e) {
    console.error("AI error:", e.message);
    return "Thanks for your message! We'll get back to you very soon. To book, reply with your name, preferred date/time, and service. ✨";
  }
}

// ── BOOKING EXTRACTION ────────────────────────────────────────────
function extractBookingInfo(text) {
  // Simple regex extraction — AI handles the complex cases
  const dateMatch  = text.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[\/\-]\d{1,2})\b/i);
  const timeMatch  = text.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  const nameMatch  = text.match(/(?:my name is|i'm|i am|it's)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  const serviceMatch = text.match(/\b(interior|exterior|uber|nurse|basic|monthly|full|wash|vacuum|detail)\b/i);

  return {
    date:    dateMatch?.[1]    || null,
    time:    timeMatch?.[1]    || null,
    name:    nameMatch?.[1]    || null,
    service: serviceMatch?.[1] || null,
  };
}

// ── SEND TO SHINEOS DASHBOARD ─────────────────────────────────────
async function notifyShineOS(event) {
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-shineos-key": API_KEY,
      },
      body: JSON.stringify({ ...event, timestamp: Date.now() }),
    });
  } catch (e) {
    console.warn("ShineOS webhook failed (dashboard may be offline):", e.message);
  }
}

// ── MAIN MESSAGE HANDLER ──────────────────────────────────────────
/**
 * Called by OpenClaw when a message arrives on any connected channel.
 *
 * @param {object} ctx - OpenClaw message context
 * @param {string} ctx.from     - sender phone/handle
 * @param {string} ctx.body     - message text
 * @param {string} ctx.platform - "whatsapp" | "imessage" | "telegram" etc
 * @param {string} ctx.name     - sender display name (if available)
 * @returns {string} reply text
 */
export async function handleMessage(ctx) {
  const { from, body, platform, name } = ctx;
  const text = (body || "").trim();

  // Log to ShineOS dashboard
  await notifyShineOS({
    event:    "new_message",
    from,
    platform,
    name:     name || from,
    body:     text,
  });

  if (!text) return null; // ignore empty messages

  const intent = detectIntent(text);

  // Quick reply if we have one
  if (QUICK_REPLIES[intent]) {
    const reply = QUICK_REPLIES[intent];
    await notifyShineOS({ event: "reply_sent", to: from, platform, body: reply });
    return reply;
  }

  // Check if this looks like a booking confirmation (has name + date + service)
  const booking = extractBookingInfo(text);
  const isBookingRequest = (booking.date || booking.time) && text.toLowerCase().includes("book");

  if (isBookingRequest || intent === "booking") {
    // Notify dashboard of potential booking
    await notifyShineOS({
      event:   "booking_request",
      from,
      platform,
      name:    booking.name || name || from,
      service: booking.service,
      date:    booking.date,
      time:    booking.time,
      rawText: text,
    });

    // If we have enough info, confirm
    if (booking.date && (booking.name || name)) {
      const reply = `Thanks ${booking.name || name}! 🌸\n\nWe've received your booking request:\n📅 ${booking.date}${booking.time ? " at " + booking.time : ""}\n✨ ${booking.service || "Full Detail"}\n\nWe'll confirm your appointment within 30 minutes!\n\nPayment options: Cash, E-transfer, or Credit Card ✨`;
      await notifyShineOS({ event: "reply_sent", to: from, platform, body: reply });
      return reply;
    }

    // Need more info — ask
    const reply = `We'd love to book you in! 🌸\n\nJust need a few details:\n1. Your name\n2. Preferred date\n3. Preferred time\n4. Your address or workplace\n5. Service (or reply PRICES to see the menu)\n\nWe'll confirm within 30 minutes! ✨`;
    await notifyShineOS({ event: "reply_sent", to: from, platform, body: reply });
    return reply;
  }

  // Fall through to AI for everything else
  const aiReply = await getAIResponse(from, text);
  await notifyShineOS({ event: "reply_sent", to: from, platform, body: aiReply });
  return aiReply;
}

// ── OPENCLAW SKILL EXPORT ─────────────────────────────────────────
export default {
  name: "shineos",
  description: "ShineOS Mobile Detailing — customer messaging integration",
  triggers: ["*"], // handle all inbound messages on configured channels

  async onMessage(ctx) {
    return handleMessage(ctx);
  },

  // Proactive: send reminders (called by OpenClaw cron if configured)
  async onCron(ctx) {
    // This fires at 8am daily — you can add reminder logic here
    console.log("[ShineOS] Daily cron — reminder logic goes here");
  },
};
