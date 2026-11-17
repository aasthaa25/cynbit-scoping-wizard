# Cynbit Project Scoping Wizard

A guided replacement for the contact form on [cynbit.in/contact](https://cynbit.in/contact).
Visitors describe their project in four short steps, see an indicative effort estimate,
and book a 30-minute discovery call, all in about two minutes.

**Live demo:** https://cynbit-scoping-wizard.vercel.app
**Technical report:** [REPORT.md](REPORT.md)

## Features

- **Five-step flow:** service and stage → budget, timeline and brief → contact → call slot → review.
- **Indicative estimate** (weeks and suggested team), with a warning when the requested start is tighter than a typical build.
- **Discovery-call booking** across the next five business days in IST, shown in the visitor's own timezone, plus a downloadable `.ics` calendar invite.
- **Accessible validation:** errors appear only after interaction (`:user-invalid`), are written out in text and not shown by colour alone, are linked with `aria-describedby`, and are announced through a polite live region.
- **Draft autosave:** a refresh doesn't lose progress (localStorage).
- **Serverless API** (`/api/inquiry`) that reuses the browser's validation rules, plus a honeypot, per-IP rate limiting, webhook delivery (Slack, Discord, Zapier or Sheets), and a reference ID.
- **Mailto fallback** if the API is unreachable, so no lead is lost.
- Light and dark themes, responsive down to 320 px, and respects reduced-motion settings.

## Run locally

Requires Node.js 20+ and has no dependencies.

```bash
npm run dev     # http://localhost:3000
npm test        # 10 unit + API tests (node:test)
```

## Deploy (Vercel)

1. Push this repo to GitHub.
2. In Vercel, choose **Add New → Project** and import the repo. No build settings are needed: static files are served from the root and `api/inquiry.js` becomes a function.
3. Optional: set `LEAD_WEBHOOK_URL` (for example a Slack or Discord incoming webhook) so each inquiry is posted to the team.

## Structure

```
index.html          markup: one <form> per step
styles.css          design tokens, light/dark, validation states
wizard.js           wizard logic, slots, review, submit
lib/inquiry.js      shared rules: validation, estimate, slots, ICS (browser + server)
api/inquiry.js      Vercel Function: POST /api/inquiry
dev/server.js       zero-dependency local dev server (outside the root so Vercel doesn't treat it as the app)
vercel.json         pins the "Other" preset: static files + api/ functions
test/               node:test suite
```
