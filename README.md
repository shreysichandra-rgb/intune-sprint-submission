# InTune

A WhatsApp text companion for women navigating perimenopause. InTune keeps user-supplied notes, existing food/workout plans, doctor questions and agreed reminders. It organises information; it does not diagnose or provide medical or nutrition advice.

Live product: https://graceful-ptarmigan-19.convex.site/

New, previously unentitled users can send Join for one free24-hour trial, starting on confirmed welcome delivery. Repeat Join does not restart it. Optional continuation is INR99 once for seven days, starting on confirmed paid-welcome delivery, without automatic charging or renewal. Existing paid/coupon access is preserved; retrieval/correction/deletion remain after expiry. The landing page explains the same free24-hour Join entry and optional INR99 continuation.

## Local verification

Use Node.js24 and the committed lockfile.

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

This local candidate is based on recorded live backend commit1beed3605d92c9da428ddfc00cee6dda2da01653 and static release613314eb-0249-4056-a8f0-fc06dd05ccc1. Backend provenance comes from the recorded release archive/CLI, not a server-attested Git hash. Public landing sources were recovered byte-for-byte from the live site; only their offline packaging script differs from the historical release workflow. No runtime backend change is proposed.

This branch retains its existing ancestry. Removing private review/output documents at the branch tip does not remove historical copies. History/media provenance review remains a publication blocker until the accompanying private audit is cleared. Do not push or make the repository public based on this README alone.
