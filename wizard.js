import {
  SERVICES, STAGES, BUDGETS, TIMELINES, LIMITS,
  estimate, upcomingSlots, buildIcs,
} from './lib/inquiry.js';

const API_URL = '/api/inquiry';
const DRAFT_KEY = 'cynbit-scoping-draft-v1';
const TOTAL_STEPS = 5;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = { step: 1, data: {} };

// ---------- Rendering option cards from the shared constants ----------

function renderCards(groupId, name, options, errorText) {
  const group = document.getElementById(groupId);
  const wrap = document.createElement('div');
  wrap.className = 'options';
  const errorId = `${name}-error`;
  Object.entries(options).forEach(([value, opt]) => {
    const label = document.createElement('label');
    label.className = 'card';
    const input = document.createElement('input');
    Object.assign(input, { type: 'radio', name, value, required: true });
    input.dataset.error = errorId;
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = typeof opt === 'string' ? opt : opt.label;
    label.append(input, title);
    if (opt.team) {
      const desc = document.createElement('span');
      desc.className = 'desc';
      desc.textContent = `Typically ${opt.weeks[0]}–${opt.weeks[1]} weeks`;
      label.append(desc);
    }
    wrap.append(label);
  });
  const err = document.createElement('div');
  err.className = 'error-msg';
  err.id = errorId;
  err.innerHTML = '<span role="img" aria-label="Error">⚠</span> ';
  err.append(errorText);
  group.append(wrap, err);
}

renderCards('service-group', 'service', SERVICES, 'Choose the service you need.');
renderCards('stage-group', 'stage', STAGES, 'Choose where your project is today.');
renderCards('budget-group', 'budget', BUDGETS, 'Choose a budget range, or "Not sure yet".');
renderCards('timeline-group', 'timeline', TIMELINES, 'Choose a timeline.');

// ---------- Discovery-call slots ----------

const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
$('#tz-name').textContent = userTz.replace(/_/g, ' ');
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

function renderSlots() {
  const host = $('#slot-days');
  host.replaceChildren();
  for (const day of upcomingSlots(5)) {
    const fs = document.createElement('fieldset');
    fs.className = 'slot-day cards';
    const legend = document.createElement('legend');
    legend.textContent = dayFmt.format(new Date(day.slots[0]));
    const opts = document.createElement('div');
    opts.className = 'options';
    for (const iso of day.slots) {
      const label = document.createElement('label');
      label.className = 'card';
      const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'slot', value: iso });
      const title = Object.assign(document.createElement('span'), { className: 'title', textContent: timeFmt.format(new Date(iso)) });
      label.append(input, title);
      opts.append(label);
    }
    fs.append(legend, opts);
    host.append(fs);
  }
}
renderSlots();

// ---------- Validation helpers (modern-web-guidance: validate-input-after-interaction) ----------

const linkError = (el, shown) => {
  const errorId = el.dataset.error;
  if (!errorId) return;
  const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== errorId);
  if (shown) ids.push(errorId);
  if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
  else el.removeAttribute('aria-describedby');
};

const supportsUserInvalid = CSS.supports('selector(:user-invalid)');
const isUserInvalid = (el) => (supportsUserInvalid ? el.matches(':user-invalid') : el.classList.contains('user-invalid-fallback'));

const announcer = document.createElement('div');
announcer.setAttribute('aria-live', 'polite');
announcer.className = 'visually-hidden';
document.body.append(announcer);
let announceTimer;
const announce = (text) => {
  clearTimeout(announceTimer);
  announcer.textContent = '';
  announceTimer = setTimeout(() => { announcer.textContent = text; }, 400);
};

const syncAria = (el) => {
  if (!el.matches?.('input, select, textarea') || el.closest('.hp')) return;
  const invalid = isUserInvalid(el);
  el.setAttribute('aria-invalid', String(invalid));
  linkError(el, invalid);
};

// Fallback for browsers without :user-invalid: mark a field after blur or a failed continue.
const touched = new WeakSet();
const fallbackUpdate = (el) => {
  if (supportsUserInvalid || !el.validity) return;
  el.classList.toggle('user-invalid-fallback', !el.validity.valid);
};

$$('input, textarea').forEach((el) => syncAria(el));
document.addEventListener('blur', (e) => {
  if (!e.target.matches?.('input, textarea')) return;
  touched.add(e.target);
  fallbackUpdate(e.target);
  syncAria(e.target);
  if (isUserInvalid(e.target) && e.target.dataset.error) {
    const msg = document.getElementById(e.target.dataset.error);
    if (msg) announce(msg.textContent.replace('⚠', 'Error:').trim());
  }
}, true);
document.addEventListener('input', (e) => {
  if (touched.has(e.target)) fallbackUpdate(e.target);
  // A radio group's error clears for every radio in the group at once.
  const group = e.target.type === 'radio' ? $$(`input[name="${e.target.name}"]`) : [e.target];
  group.forEach((el) => { fallbackUpdate(el); syncAria(el); });
  saveDraft();
});
document.addEventListener('invalid', (e) => {
  touched.add(e.target);
  fallbackUpdate(e.target);
  // Wait a frame: :user-invalid only matches once the browser finishes the submit attempt.
  requestAnimationFrame(() => syncAria(e.target));
}, true);

// Live character counter for the description.
const details = $('#details');
const counter = $('#details-count');
const updateCount = () => { counter.textContent = `${details.value.length} / ${LIMITS.details}`; };
details.addEventListener('input', updateCount);

// ---------- Draft persistence (per-browser convenience only) ----------

function collect() {
  const data = {};
  for (const form of $$('form.step')) {
    for (const [k, v] of new FormData(form)) data[k] = typeof v === 'string' ? v : '';
  }
  data.consent = $('#consent').checked;
  return data;
}

function saveDraft() {
  try {
    const { website, ...rest } = collect();
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ step: state.step, data: rest }));
  } catch { /* storage unavailable: the form still works */ }
}

function restoreDraft() {
  let draft;
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { draft = null; }
  if (!draft?.data) return 1;
  for (const [k, v] of Object.entries(draft.data)) {
    const els = $$(`[name="${CSS.escape(k)}"]`);
    els.forEach((el) => {
      if (el.type === 'radio') el.checked = el.value === v;
      else if (el.type === 'checkbox') el.checked = Boolean(v);
      else el.value = v;
    });
  }
  updateCount();
  // Never resume past the review step, and re-validate earlier steps on the way.
  return Math.min(Math.max(1, draft.step || 1), TOTAL_STEPS);
}

function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }

// ---------- Step navigation ----------

function showStep(n, { focus = true } = {}) {
  const apply = () => {
    state.step = n;
    $$('.step').forEach((s) => { s.hidden = Number(s.dataset.step) !== n; });
    $$('.progress li').forEach((li) => {
      const s = Number(li.dataset.step);
      li.classList.toggle('complete', s < n);
      if (s === n) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    $('.progress').hidden = n > TOTAL_STEPS;
    $('.required-note').hidden = n >= 4;
    if (n === 5) renderReview();
    if (focus) $(`.step[data-step="${n}"] h2`)?.focus();
    saveDraft();
  };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !reduce && focus) document.startViewTransition(apply);
  else apply();
}

for (const form of $$('form.step')) {
  const n = Number(form.dataset.step);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (n < TOTAL_STEPS) showStep(n + 1);
    else send();
  });
}
$$('[data-back]').forEach((btn) => btn.addEventListener('click', () => showStep(state.step - 1)));
$('#skip-call').addEventListener('click', () => {
  $$('input[name="slot"]').forEach((r) => { r.checked = false; });
  showStep(5);
});

// ---------- Review ----------

const SECTIONS = [
  ['Service', (d) => SERVICES[d.service]?.label, 1],
  ['Stage', (d) => STAGES[d.stage]?.label, 1],
  ['Budget', (d) => BUDGETS[d.budget], 2],
  ['Timeline', (d) => TIMELINES[d.timeline]?.label, 2],
  ['Project', (d) => d.details, 2],
  ['Name', (d) => d.name, 3],
  ['Email', (d) => d.email, 3],
  ['Company', (d) => d.company || '—', 3],
  ['Phone', (d) => d.phone || '—', 3],
  ['Discovery call', (d) => (d.slot ? fullFmt.format(new Date(d.slot)) : 'No call booked, reply by email'), 4],
];

function renderReview() {
  const d = collect();
  state.data = d;
  const est = estimate(d);
  $('#estimate-range').textContent = est ? `${est.minWeeks}–${est.maxWeeks} weeks` : '—';
  $('#estimate-team').textContent = est ? `Suggested team: ${est.team}` : '';
  const warn = $('#estimate-warning');
  warn.hidden = !est?.tight;
  warn.textContent = est?.tight ? 'Your start date is tighter than a typical build. We can plan a phased first release on the call.' : '';

  const dl = $('#summary');
  dl.replaceChildren();
  for (const [label, get, step] of SECTIONS) {
    const dt = Object.assign(document.createElement('dt'), { textContent: label });
    const dd = Object.assign(document.createElement('dd'), { textContent: get(d) ?? '—' });
    const edit = Object.assign(document.createElement('button'), { type: 'button', className: 'edit', textContent: 'Edit' });
    edit.setAttribute('aria-label', `Edit ${label.toLowerCase()}`);
    edit.addEventListener('click', () => showStep(step));
    const cell = document.createElement('dd');
    cell.append(edit);
    dl.append(dt, dd, cell);
  }
  $('#send-status').hidden = true;
}

// ---------- Submit ----------

async function send() {
  const btn = $('#send-btn');
  if (btn.getAttribute('aria-busy') === 'true') return;
  const status = $('#send-status');
  status.hidden = true;
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = 'Sending…';
  const payload = { ...collect() };

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 422 && body.errors) {
        const first = Object.keys(body.errors)[0];
        const step = stepForField(first);
        throw Object.assign(new Error(body.errors[first]), { step });
      }
      throw new Error(body.error || `The server returned an error (${res.status}).`);
    }
    showDone(payload, body);
  } catch (err) {
    const mail = mailtoFallback(payload);
    status.replaceChildren(
      document.createTextNode(`We couldn't send your inquiry: ${err.message} `),
    );
    if (err.step) {
      const fix = Object.assign(document.createElement('button'), { type: 'button', className: 'edit', textContent: 'Fix it' });
      fix.addEventListener('click', () => showStep(err.step));
      status.append(fix);
    } else {
      const a = Object.assign(document.createElement('a'), { href: mail, textContent: 'Send it by email instead' });
      status.append(a, document.createTextNode('. Your answers are saved in this browser.'));
    }
    status.hidden = false;
  } finally {
    btn.removeAttribute('aria-busy');
    btn.textContent = 'Send inquiry';
  }
}

function stepForField(field) {
  if (['service', 'stage'].includes(field)) return 1;
  if (['budget', 'timeline', 'details'].includes(field)) return 2;
  if (field === 'slot') return 4;
  return 3;
}

function mailtoFallback(d) {
  const lines = SECTIONS.map(([label, get]) => `${label}: ${get(d) ?? '—'}`);
  const subject = `Project inquiry: ${SERVICES[d.service]?.label ?? 'New project'}`;
  return `mailto:opportunities@cynbit.in?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

let icsUrl;
function showDone(d, res) {
  $('#done-name').textContent = d.name.split(' ')[0];
  $('#done-ref').textContent = res.ref;
  const call = $('#done-call');
  call.replaceChildren();
  if (d.slot) {
    const p = Object.assign(document.createElement('p'), { textContent: `Your discovery call: ${fullFmt.format(new Date(d.slot))}.` });
    if (icsUrl) URL.revokeObjectURL(icsUrl);
    const ics = res.ics || buildIcs({ ref: res.ref, slot: d.slot, name: d.name, service: d.service });
    icsUrl = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const a = Object.assign(document.createElement('a'), { href: icsUrl, download: `cynbit-discovery-${res.ref}.ics`, className: 'calendar-link', textContent: 'Add to calendar' });
    call.append(p, a);
    $('#next-call-step').textContent = 'We email you a meeting link before your call.';
  } else {
    $('#next-call-step').textContent = 'We reply by email to set up a call at a time that suits you.';
  }
  clearDraft();
  showStep(6);
}

$('#start-over').addEventListener('click', () => {
  $$('form.step').forEach((f) => f.reset());
  updateCount();
  renderSlots();
  showStep(1);
});

// ---------- Boot ----------

const resumeAt = restoreDraft();
// Only resume a step whose earlier steps are still valid.
let start = 1;
for (let s = 1; s < resumeAt; s++) {
  // validity.valid reads the state without firing 'invalid' events (which would flag fields).
  const valid = [...$(`#step-${s}`).elements].every((el) => !el.validity || el.validity.valid);
  if (!valid) break;
  start = s + 1;
}
showStep(start, { focus: false });
