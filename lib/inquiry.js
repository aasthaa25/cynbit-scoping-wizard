// Shared domain logic for the project scoping wizard.
// Imported by the browser (app.js) and by the serverless API (api/inquiry.js),
// so the client and the server validate and estimate with exactly the same rules.

export const SERVICES = {
  'ai-automation': { label: 'AI automation', weeks: [3, 6], team: 'AI engineer + backend developer' },
  'custom-software': { label: 'Custom software / web app', weeks: [6, 12], team: 'Full-stack pair + designer' },
  'marketing-seo': { label: 'Digital marketing & SEO', weeks: [4, 8], team: 'SEO strategist + content lead' },
  'cloud-infra': { label: 'Cloud infrastructure', weeks: [2, 5], team: 'Cloud / DevOps engineer' },
};

export const STAGES = {
  idea: { label: 'Just an idea', factor: 1.25 },
  existing: { label: 'Improving something that exists', factor: 1 },
  scaling: { label: 'Scaling a live product', factor: 1.15 },
};

export const BUDGETS = {
  'under-1l': 'Under ₹1 lakh',
  '1l-5l': '₹1 – 5 lakh',
  '5l-15l': '₹5 – 15 lakh',
  '15l-plus': '₹15 lakh +',
  unsure: 'Not sure yet',
};

export const TIMELINES = {
  asap: { label: 'As soon as possible', weeks: 4 },
  '1-3m': { label: 'Within 1 – 3 months', weeks: 12 },
  '3m-plus': { label: 'In 3+ months', weeks: Infinity },
  flexible: { label: 'Flexible', weeks: Infinity },
};

export const LIMITS = { name: 80, email: 254, company: 120, phone: 20, details: 2000, detailsMin: 30 };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;

/** Indicative effort range. Clearly an estimate, never a quote. */
export function estimate({ service, stage, timeline } = {}) {
  const s = SERVICES[service];
  if (!s) return null;
  const factor = STAGES[stage]?.factor ?? 1;
  const min = Math.max(1, Math.round(s.weeks[0] * factor));
  const max = Math.max(min + 1, Math.round(s.weeks[1] * factor));
  const target = TIMELINES[timeline]?.weeks ?? Infinity;
  return {
    minWeeks: min,
    maxWeeks: max,
    team: s.team,
    // A tight deadline is flagged so the team can talk about phasing on the call.
    tight: target < min,
  };
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Validate and normalise an inquiry. Returns { ok, errors, value }.
 * `errors` maps field name -> message, using the same wording as the UI.
 */
export function validateInquiry(input = {}) {
  const errors = {};
  const value = {
    service: str(input.service),
    stage: str(input.stage),
    budget: str(input.budget),
    timeline: str(input.timeline),
    details: str(input.details),
    name: str(input.name),
    email: str(input.email).toLowerCase(),
    company: str(input.company),
    phone: str(input.phone),
    consent: input.consent === true || input.consent === 'on' || input.consent === 'true',
    slot: str(input.slot),
  };

  if (!SERVICES[value.service]) errors.service = 'Choose the service you need.';
  if (!STAGES[value.stage]) errors.stage = 'Choose where your project is today.';
  if (!(value.budget in BUDGETS)) errors.budget = 'Choose a budget range, or "Not sure yet".';
  if (!TIMELINES[value.timeline]) errors.timeline = 'Choose a timeline.';
  if (value.details.length < LIMITS.detailsMin) {
    errors.details = `Describe the project in at least ${LIMITS.detailsMin} characters.`;
  } else if (value.details.length > LIMITS.details) {
    errors.details = `Keep the description under ${LIMITS.details} characters.`;
  }
  if (!value.name || value.name.length > LIMITS.name) errors.name = 'Enter your full name.';
  if (!EMAIL_RE.test(value.email) || value.email.length > LIMITS.email) {
    errors.email = 'Enter an email address in the format you@example.com.';
  }
  if (value.company.length > LIMITS.company) errors.company = 'Company name is too long.';
  if (value.phone && !PHONE_RE.test(value.phone)) {
    errors.phone = 'Enter a phone number with digits only, for example +91 98765 43210.';
  }
  if (!value.consent) errors.consent = 'Agree to be contacted about this inquiry.';

  if (value.slot) {
    const t = Date.parse(value.slot);
    const now = Date.now();
    // Slots must be in the future and within the next three weeks.
    if (Number.isNaN(t) || t < now || t > now + 21 * 864e5) errors.slot = 'Pick one of the available call times.';
  }

  return { ok: Object.keys(errors).length === 0, errors, value };
}

// ---- Discovery-call slots (always in IST, the team's timezone) ----

const IST_OFFSET_MIN = 330; // UTC+05:30
export const SLOT_HOURS_IST = [11, 13, 15, 17];

/** Next `days` business days (IST), each with its call slots as UTC ISO strings. */
export function upcomingSlots(days = 5, from = new Date()) {
  const istNow = new Date(from.getTime() + IST_OFFSET_MIN * 6e4);
  const result = [];
  let cursor = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());
  while (result.length < days) {
    cursor += 864e5; // start from tomorrow so the team has time to prepare
    const d = new Date(cursor);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const slots = SLOT_HOURS_IST.map((h) =>
      new Date(cursor + h * 36e5 - IST_OFFSET_MIN * 6e4).toISOString(),
    );
    result.push({ date: d.toISOString().slice(0, 10), slots });
  }
  return result;
}

// ---- Reference IDs and calendar invites ----

export function makeRef(now = new Date(), rand = Math.random) {
  const ymd = now.toISOString().slice(2, 10).replaceAll('-', '');
  const tail = Math.floor(rand() * 36 ** 4).toString(36).toUpperCase().padStart(4, '0');
  return `CYN-${ymd}-${tail}`;
}

const icsDate = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s) => s.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\r?\n/g, '\\n');

/** RFC 5545 calendar invite for the booked discovery call. */
export function buildIcs({ ref, slot, name, service }) {
  const start = new Date(slot);
  const end = new Date(start.getTime() + 30 * 6e4);
  const serviceLabel = SERVICES[service]?.label ?? 'your project';
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cynbit//Scoping Wizard//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ref}@cynbit.in`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(`Cynbit discovery call — ${serviceLabel}`)}`,
    `DESCRIPTION:${icsText(`Discovery call with ${name}. Reference ${ref}. Cynbit will email a meeting link before the call.`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
