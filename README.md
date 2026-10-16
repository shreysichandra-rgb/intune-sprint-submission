# InTune

A WhatsApp text companion for women navigating perimenopause. InTune keeps user-supplied notes, existing food/workout plans, doctor questions and agreed reminders. It organises information; it does not diagnose or provide medical or nutrition advice.

Live product: https://graceful-ptarmigan-19.convex.site/

New, previously unentitled users can send Join for one free 24-hour trial, starting on confirmed welcome delivery. Repeat Join does not restart it. Optional continuation is INR 99 once for seven days, starting on confirmed paid-welcome delivery, without automatic charging or renewal. Existing paid/coupon access is preserved; retrieval/correction/deletion remain after expiry. The landing page explains the same free 24-hour Join entry and optional INR 99 continuation.

## Local verification

Use Node.js 24 and the committed lockfile.

```sh
npm ci
npm test
npx tsc --noEmit -p convex/tsconfig.json
VITE_CONVEX_URL=https://graceful-ptarmigan-19.convex.cloud npm run build
```

Tests use fictional fixtures and mocked providers unless explicitly labelled as actual-provider tests. An optional provider test may be skipped. Test success is not proof of WhatsApp delivery on a real phone. Generated fictional reports go under ignored output/. A clean local build requires no production credentials, queries or deployment.

## Backend setup

The stack is Convex for functions, storage, database and static hosting; Razorpay for optional payments; OpenAI for bounded text interpretation. Use a separate development deployment and synthetic transport for tests. Never point a development fixture at production. Configure secrets privately in Convex. Do not commit environment values, exported customer tables, chats, private checkout links or payment evidence. Environment-variable names only are listed in docs/ENVIRONMENT-NAMES.txt; not every optional feature needs every variable. INTUNE_TRIAL_ENABLED controls trial entry. Price/access/confirmed-delivery and privacy rules are enforced server-side.

npm run dev starts the local frontend. The local lab/QA scripts require their separately provisioned localhost runtime and private operator configuration; they are not public customer dashboards. npm run deploy is an intentional production operation and is not part of submission verification. A Git push does not deploy.

## Source and publication status

This is a new, separate submission repository with clean local history. The original repository and its private history are retained separately and are not included here. No customer chats, evidence exports or environment values belong in this repository.

The runtime matches live reminder-repair source `635522fdf07a2109c4077baa5d855208117b1258`, released on 16 October 2026 with static release `5c7c4b4f-68b7-4f17-8ec6-30860e1c1a44`. This includes the enabled 24-hour trial, Hindi explanation support, original workout reminder continuation, and clock answers such as “6 pm is okay”. Backend provenance relies on the recorded CLI release and source comparison, not an independently server-attested Git hash.

The release passed 1,304 automated checks with one optional provider test skipped, backend types and build. All 38 public website files were unchanged and 21 existing access clocks were preserved. Actual-AI fictional reminder tests used simulated transport. The founder confirmed a fictional note could be saved, WhatsApp closed/reopened, and the note retrieved on an existing account; this is not proof of a new-user trial or timed reminder arrival. Real-phone timed reminder delivery remains unverified.

This separate clean repository is public with founder approval. Original private history is excluded. Publishing source does not deploy the app or submit the Sprint entry.
