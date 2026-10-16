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

The runtime combines recorded live backend source `1beed36` and Hindi explanation repair `01c4975`, plus landing-page wording matching the enabled free 24-hour trial. It was released to the existing host on 16 October 2026, static release `fbf2f64d-7898-4ca5-938e-7d2d1785b893`. Backend provenance relies on the recorded CLI release, not an independently server-attested Git hash.

Verification: 1,280 automated tests passed, one optional provider test skipped; fresh install, type checks and build passed. All 38 public files matched the build after release, and 21 pre-existing access clocks were unchanged. Fictional actual-AI Hinglish food saving was checked before release. Real-phone Hindi response and the final save/reopen/retrieve check remain unverified.

Publication is awaiting founder approval. A local source snapshot or deployment does not imply GitHub is public or that Sprint submission has occurred.
