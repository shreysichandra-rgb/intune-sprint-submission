# InTune

A WhatsApp text companion for women navigating perimenopause. InTune keeps user-supplied notes, existing food/workout plans, doctor questions and agreed reminders. It organises information; it does not diagnose or provide medical or nutrition advice.

Live product: https://graceful-ptarmigan-19.convex.site/

New, previously unentitled users can send Join for one free 24-hour trial, starting on confirmed welcome delivery. Repeat Join does not restart it. Optional continuation is INR 99 once for seven days, starting on confirmed paid-welcome delivery, without automatic charging or renewal. Existing paid/coupon access is preserved; retrieval/correction/deletion remain after expiry. The landing page explains the same free 24-hour Join entry and optional INR 99 continuation.

## Local verification

Use Node.js 24 and the committed lockfile.

```sh
npm ci
npm test -- --maxWorkers=2
npx tsc --noEmit -p convex/tsconfig.json
VITE_CONVEX_URL=https://graceful-ptarmigan-19.convex.cloud npm run build
```

Tests use fictional fixtures and mocked providers unless explicitly labelled as actual-provider tests. An optional provider test may be skipped. Test success is not proof of WhatsApp delivery on a real phone. Generated fictional reports go under ignored output/. A clean local build requires no production credentials, queries or deployment.

## Backend setup

The stack is Convex for functions, storage, database and static hosting; Razorpay for optional payments; OpenAI for bounded text interpretation. Use a separate development deployment and synthetic transport for tests. Never point a development fixture at production. Configure secrets privately in Convex. Do not commit environment values, exported customer tables, chats, private checkout links or payment evidence. Environment-variable names only are listed in docs/ENVIRONMENT-NAMES.txt; not every optional feature needs every variable. INTUNE_TRIAL_ENABLED controls trial entry. Price/access/confirmed-delivery and privacy rules are enforced server-side.

npm run dev starts the local frontend. The local lab/QA scripts require their separately provisioned localhost runtime and private operator configuration; they are not public customer dashboards. npm run deploy is an intentional production operation and is not part of submission verification. A Git push does not deploy.

## Source and publication status

This is a new, separate submission repository with clean local history. The original repository and its private history are retained separately and are not included here. No customer chats, evidence exports or environment values belong in this repository.

The runtime matches recorded released source `08fcee93a38f8f4955d88395d7017e90bfdac848`, released on 17 October 2026 at 16:01 IST with static release `30c3bc94-64e5-4854-9fbe-32e2259b614d`. It includes the enabled 24-hour trial and the prior reminder/language repairs, plus a narrow recovery for a literal clock answer to one owned, already-dated pending reminder when model interpretation and format repair both fail schema checks. Ordinary access, safety, independent validation, coverage and duplicate protections remain. Provider/quota failures do not trigger this recovery. Backend provenance relies on recorded deployment evidence and exact source comparison, not a server-attested Git hash.

Release verification: 1,378 aggregate automated tests passed with one optional provider test skipped; backend types/build passed. All 22 pre-existing access clocks and all 38 website files were unchanged. New recovery tests use fictional data and simulated provider responses. The exact historical exception and a successful real-phone retry on this latest release are not established. Fresh-checkout verification for this publication is recorded separately. Public source updates do not deploy the app.

On 17 October the founder used an existing account to request a fictional packing-list reminder for 1:30 PM IST. The supplied time was preserved without a repeat timing question; read-only backend evidence showed exactly one active matching one-time reminder. The founder then explicitly confirmed arrival at 1:30 PM. This is founder-reported existing-account phone evidence, not a new-user trial proof or an independently inspected phone recording. An earlier fictional note save, close/reopen and retrieval was also founder-confirmed. Founder/test accounts are excluded from participant and revenue counts. No private conversation or participant identifiers are included here.

This separate clean repository is public with founder approval. Original private history is excluded. Publishing source does not deploy the app or submit the Sprint entry.
