---
name: shineos
version: 1.0.0
description: ShineOS Mobile Detailing business integration. Handles customer booking requests, pricing questions, and scheduling via WhatsApp and iMessage. Routes messages to the ShineOS dashboard and auto-responds intelligently.
author: ShineOS
tags: [business, detailing, booking, scheduling]
platforms: [whatsapp, imessage, telegram, sms]
env:
  SHINEOS_WEBHOOK_URL: required
  SHINEOS_API_KEY: required
---

# ShineOS Skill

This skill connects your mobile detailing business to any messaging platform via OpenClaw.

## What it does

- Automatically responds to customer inquiries about pricing, availability, and services
- Converts booking requests into real bookings in your ShineOS dashboard
- Sends booking confirmations, reminders, and invoice summaries
- Alerts you (the owner) when a new booking comes in or a customer needs attention
- Handles Uber driver and nurse-specific queries with tailored responses

## Business Context

**Business:** ShineOS Mobile Detailing  
**Operators:** Two technicians — owner + George  
**Speciality:** Uber/Lyft drivers and nurses (come-to-you service)  
**Location:** Canada  
**Brand:** Pink & white, premium, friendly

## Service Menu (for auto-responses)

| Service | Price | Duration |
|---|---|---|
| Basic Interior Vacuum | $70 | 45 min |
| Exterior Wash + Dry | $90 | 1 hour |
| Full Interior Detail | $130 | 2–2.5 hrs |
| Full Interior + Exterior | $180 | 3 hrs |
| Uber/Lyft Driver Package | $110 | 2 hrs |
| Nurse Parking Lot Special | $140 | 2 hrs |
| Monthly Maintenance Plan | $250/mo | 2x/month |
| Odour Elimination (add-on) | +$50 | +30 min |
| Pet Hair Removal (add-on) | +$60 | +45 min |

## Trigger phrases the skill responds to

- "How much", "price", "cost", "rates" → pricing response
- "Book", "schedule", "appointment", "available" → booking flow
- "Where", "location", "come to me", "parking lot" → location/mobile explanation
- "Uber", "Lyft", "rideshare", "driver" → Uber package pitch
- "Nurse", "hospital", "work parking" → nurse package pitch
- "Monthly", "regular", "subscription" → monthly plan pitch
- "Cancel", "reschedule" → reschedule flow

## Webhook Events Sent to ShineOS

All events POST to `SHINEOS_WEBHOOK_URL` with header `x-shineos-key: SHINEOS_API_KEY`

```json
{ "event": "new_message",    "from": "+1...", "platform": "whatsapp", "body": "...", "timestamp": 123 }
{ "event": "booking_request","from": "+1...", "name": "...", "service": "...", "date": "...", "time": "..." }
{ "event": "reply_sent",     "to": "+1...",  "body": "...", "timestamp": 123 }
```
