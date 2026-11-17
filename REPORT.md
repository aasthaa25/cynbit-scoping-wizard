# Technical Report: Project Scoping Wizard for cynbit.in

## 1. Problem statement

The contact page is cynbit.in's main conversion point. Both "Start discovery" calls to action land there. I reviewed it as a prospective client and as a developer:

| Observation | Impact |
|---|---|
| Five-field form (name, email, company, industry, message) with no required markers, hints or error messages | Visitors can't tell what is needed, and bad emails or empty messages get through |
| No budget, timeline or service fields | The team must email back and forth before it can qualify a lead, which works against the promised "24 H" response |
| The FAQ mentions a "discovery call" but there is no way to book one | The highest-intent visitors get no next step |
| No visible confirmation, reference or "what happens next" | Visitors are unsure whether their message arrived |
| No visible spam protection | Low-quality leads reach the inbox |

**Goal:** turn the contact page into a short guided flow that captures a *qualified* lead, gives the visitor something useful straight away (an estimate and a booked call), and stays fast and accessible.

## 2. Solution

A five-step wizard:

1. **Project:** service (AI automation, custom software, marketing and SEO, cloud) and current stage.
2. **Scope:** budget range, desired start, and a free-text brief with a live character counter.
3. **Contact:** name, email, and optional company and phone, with an explicit consent checkbox linked to the privacy policy.
4. **Call:** pick a 30-minute discovery-call slot over the next five business days, or skip it.
5. **Review:** indicative effort estimate and suggested team, a full summary with per-row "Edit" links, then send.

On success the visitor gets a reference ID, an **Add to calendar** `.ics` file, and a clear "what happens next" list.

## 3. Technical stack and why

| Choice | Reason |
|---|---|
| **Vanilla HTML, CSS and ES modules** (no framework or build step) | It's a single focused flow, so there's no framework weight. The page loads instantly and drops into any existing stack. |
| **Native constraint validation + `:user-invalid`** | Uses the browser's own validation instead of a library. `:user-invalid` has been Baseline Widely available since 2023 and defers errors until the user has interacted. A JS fallback covers older browsers. |
| **One `<form>` per step** | "Continue" is a real submit button, so the browser validates only that step and focuses the first invalid field. Keyboard Enter works for free. |
| **Shared `lib/inquiry.js`** | The same module validates in the browser and on the server, so the two sets of rules can't drift apart. It also holds the estimate, slot and ICS logic. |
| **Vercel Function (`api/inquiry.js`)** with the Web-standard `Request`/`Response` signature | Serverless with no infrastructure to manage, and it's portable to Netlify, Cloudflare or Deno with minimal changes. |
| **Webhook delivery (`LEAD_WEBHOOK_URL`)** | Leads reach Slack, Discord or Zapier → Google Sheets/CRM without adding a database to a prototype. |
| **`node:test`** | Zero-dependency tests for the domain rules and the API contract. |

Modern platform features used (all with graceful fallbacks): `:has()` for card selection and group error states, `color-mix()`, `field-sizing: content`, View Transitions between steps (skipped when reduced motion is preferred), and `Intl.DateTimeFormat` for timezone-aware slots.

## 4. Implementation highlights

- **Accessibility:** a skip link, `fieldset`/`legend` for every choice group, required fields marked visually (with the asterisk hidden from screen readers, since `required` is announced), and error text that starts with an icon carrying an "Error" label. Each error is added to `aria-describedby` only while it is visible, `aria-invalid` stays in sync, there's one polite live region for announcements, focus moves to each new step's heading, and the progress bar uses `aria-current="step"`.
- **Timezone correctness:** slots are generated as 11:00, 13:00, 15:00 and 17:00 **IST** on business days, stored as UTC ISO strings, and displayed in the visitor's own timezone with its name shown.
- **Server hardening:**
  - checks the content type and caps the body at 10 KB
  - full re-validation, returning 422 with per-field errors that the UI maps back to the right step ("Fix it")
  - honeypot field (bots get a fake 201)
  - per-IP rate limit of 5 requests per 10 minutes
  - slot must be in the future and within 21 days
  - 405 for other methods
- **Resilience:** answers autosave to localStorage. If the API fails, the visitor gets a prefilled `mailto:` with their full brief, so no lead is lost.
- **Estimate model:** a base week range per service, multiplied by stage (an idea gets ×1.25 for discovery work, scaling ×1.15). It flags when the requested start is shorter than the minimum build. It is clearly labelled indicative, not a quote.

## 5. Results

- **Qualified leads:** every inquiry now arrives with service, stage, budget, timeline and a ≥30-character brief, all of which the old form lacked.
- **A next step for every visitor:** high-intent visitors leave with a booked call and a calendar invite instead of an open-ended wait.
- **Fewer bad submissions:** client and server validation, a honeypot and rate limiting.
- **Tests:** 10 automated tests pass (validation, estimate, IST slot generation, ICS format, and the API's 201/422/400/415/405/429 paths).
- **Manual QA:** full flow tested end to end in Chromium (validation states, step navigation, estimate warning, submit, `.ics` download), at 375 px mobile width and in dark mode. No console errors.
- **Weight:** about 25 KB of uncompressed HTML, CSS and JS with zero runtime dependencies.

## 6. Limitations and next steps

- Rate limiting is in-memory per function instance. Production would use Vercel KV or Upstash.
- Slots are fixed. The next step is real availability from Google Calendar or Cal.com, so booked slots disappear.
- Leads go to a webhook. A CRM integration (HubSpot or Zoho) and a confirmation email to the visitor (Resend) would close the loop.
- Add analytics events per step to measure drop-off and A/B test against the current form.
