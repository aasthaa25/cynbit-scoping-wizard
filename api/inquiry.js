// POST /api/inquiry — Vercel Function (Web-standard Request/Response signature).
// Validates the inquiry with the same rules as the browser, rejects bots,
// rate-limits per IP, forwards the lead to a webhook, and returns a reference
// ID plus a calendar invite for the booked discovery call.

import { validateInquiry, estimate, makeRef, buildIcs, SERVICES, BUDGETS, TIMELINES, STAGES } from '../lib/inquiry.js';

const MAX_BODY_BYTES = 10_000;
const RATE_LIMIT = 5; // requests
const RATE_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map(); // best-effort, per warm instance

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

function rateLimited(ip, now = Date.now()) {
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

export function _resetRateLimit() { hits.clear(); }

async function forwardLead(lead) {
  const url = process.env.LEAD_WEBHOOK_URL;
  if (!url) return 'skipped';
  // Slack/Discord-friendly text plus the structured lead for Sheets/Zapier/Make.
  const text = [
    `New inquiry ${lead.ref}: ${SERVICES[lead.service].label} (${STAGES[lead.stage].label})`,
    `Budget: ${BUDGETS[lead.budget]} · Timeline: ${TIMELINES[lead.timeline].label}`,
    `Estimate: ${lead.estimate.minWeeks}–${lead.estimate.maxWeeks} weeks`,
    `From: ${lead.name} <${lead.email}>${lead.company ? `, ${lead.company}` : ''}`,
    `Call: ${lead.slot || 'none booked'}`,
    '',
    lead.details,
  ].join('\n');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, content: text, lead }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
  return 'sent';
}

export async function POST(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return json(415, { error: 'Send the inquiry as JSON.' });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'The inquiry is too large.' });

  let input;
  try { input = JSON.parse(raw); } catch { return json(400, { error: 'The inquiry is not valid JSON.' }); }
  if (!input || typeof input !== 'object') return json(400, { error: 'The inquiry is empty.' });

  const ip = (request.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
  if (rateLimited(ip)) return json(429, { error: 'Too many inquiries from this network. Try again in a few minutes.' });

  // Honeypot: real people never see this field. Pretend success so bots learn nothing.
  if (typeof input.website === 'string' && input.website.trim() !== '') {
    return json(201, { ref: makeRef(), ics: null });
  }

  const { ok, errors, value } = validateInquiry(input);
  if (!ok) return json(422, { error: 'Some answers need fixing.', errors });

  const ref = makeRef();
  const lead = { ref, ...value, estimate: estimate(value), receivedAt: new Date().toISOString() };

  let delivery;
  try {
    delivery = await forwardLead(lead);
  } catch (err) {
    console.error('Lead forwarding failed', ref, err.message);
    return json(502, { error: 'We could not record your inquiry right now. Please try again or email us.' });
  }
  console.log('inquiry', ref, value.service, value.budget, delivery);

  return json(201, {
    ref,
    estimate: lead.estimate,
    ics: value.slot ? buildIcs({ ref, slot: value.slot, name: value.name, service: value.service }) : null,
  });
}

// Any other method gets a clear 405.
const notAllowed = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });
export { notAllowed as GET, notAllowed as PUT, notAllowed as DELETE };
