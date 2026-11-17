import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateInquiry, estimate, upcomingSlots, buildIcs, makeRef } from '../lib/inquiry.js';
import { POST, GET, _resetRateLimit } from '../api/inquiry.js';

const slot = upcomingSlots(1)[0].slots[0];
const valid = {
  service: 'ai-automation', stage: 'existing', budget: '1l-5l', timeline: '1-3m',
  details: 'Automate our invoice processing with an AI agent that reads PDFs.',
  name: 'Test User', email: 'Test@Example.com', company: 'Acme', phone: '+91 98765 43210',
  consent: true, slot,
};

const post = (body, headers = {}) => POST(new Request('http://x/api/inquiry', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': headers.ip || '1.1.1.1' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}));

beforeEach(() => _resetRateLimit());

test('valid inquiry passes and is normalised', () => {
  const r = validateInquiry(valid);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.email, 'test@example.com');
});

test('missing and malformed fields are reported', () => {
  const r = validateInquiry({ ...valid, service: 'nope', email: 'a@b', details: 'short', consent: false, phone: 'abc' });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['consent', 'details', 'email', 'phone', 'service']);
});

test('past or far-future slots are rejected', () => {
  assert.ok(validateInquiry({ ...valid, slot: '2020-01-01T05:30:00.000Z' }).errors.slot);
  assert.ok(validateInquiry({ ...valid, slot: new Date(Date.now() + 60 * 864e5).toISOString() }).errors.slot);
  assert.equal(validateInquiry({ ...valid, slot: '' }).ok, true);
});

test('estimate scales with stage and flags tight timelines', () => {
  assert.deepEqual(estimate({ service: 'custom-software', stage: 'existing', timeline: '1-3m' }),
    { minWeeks: 6, maxWeeks: 12, team: 'Full-stack pair + designer', tight: false });
  assert.equal(estimate({ service: 'custom-software', stage: 'idea', timeline: 'asap' }).tight, true);
  assert.equal(estimate({ service: 'x' }), null);
});

test('slots are business days in IST, from tomorrow', () => {
  // Friday 2026-11-20 10:00 IST
  const days = upcomingSlots(3, new Date('2026-11-20T04:30:00Z'));
  assert.deepEqual(days.map((d) => d.date), ['2026-11-23', '2026-11-24', '2026-11-25']);
  assert.equal(days[0].slots[0], '2026-11-23T05:30:00.000Z'); // 11:00 IST
});

test('ics invite is well-formed', () => {
  const ics = buildIcs({ ref: 'CYN-1', slot: '2026-11-23T05:30:00.000Z', name: 'A, B', service: 'cloud-infra' });
  assert.match(ics, /DTSTART:20261123T053000Z\r\n/);
  assert.match(ics, /DTEND:20261123T060000Z\r\n/);
  assert.match(ics, /A\\, B/);
  assert.match(makeRef(), /^CYN-\d{6}-[0-9A-Z]{4}$/);
});

test('API: valid inquiry returns 201 with ref and invite', async () => {
  const res = await post(valid);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.match(body.ref, /^CYN-/);
  assert.match(body.ics, /BEGIN:VCALENDAR/);
  assert.equal(body.estimate.minWeeks, 3);
});

test('API: invalid inquiry returns 422 with field errors', async () => {
  const res = await post({ ...valid, email: 'bad' });
  assert.equal(res.status, 422);
  assert.ok((await res.json()).errors.email);
});

test('API: honeypot gets a fake success, bad JSON and wrong type are rejected', async () => {
  assert.equal((await post({ ...valid, website: 'http://spam' })).status, 201);
  assert.equal((await post('{not json')).status, 400);
  const res = await POST(new Request('http://x', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' }));
  assert.equal(res.status, 415);
  assert.equal(GET().status, 405);
});

test('API: rate limits after 5 requests per IP', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await post(valid, { ip: '9.9.9.9' })).status, 201);
  assert.equal((await post(valid, { ip: '9.9.9.9' })).status, 429);
  assert.equal((await post(valid, { ip: '8.8.8.8' })).status, 201);
});
