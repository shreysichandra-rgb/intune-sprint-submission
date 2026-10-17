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

The runtime matches recorded released source `8f4dfdce21edf6c290e4f5a89b8edd6720f02da3`, released on 17 October 2026 at 04:53 IST with static release `ba66e557-48dd-4a86-b1e9-fe2cc696ba98`. This includes the enabled 24-hour trial, Hindi explanation support, reminder continuation, clear retry wording when welcome activation changes an in-flight account, and matching explicit dates such as “today, 16 October 2026”. Backend provenance relies on recorded deployment evidence and source comparison, not a server-attested Git hash.

Release verification: 1,324 automated tests passed with one optional provider test skipped, backend types/build passed, 22 prior access records/clocks and all 38 public website files unchanged. Actual-AI fictional reminder tests used simulated WhatsApp transport. The founder confirmed fictional note save/close/reopen/retrieval on an existing account. Fresh timed-reminder arrival remains to be checked with the founder; simulated tests are not phone proof.

Current-message language support is included: ordinary English now explicitly selects English throughout interpretation/review/reply generation instead of allowing older Hindi context to choose reply wording. Explicit Hindi/Hinglish requests remain supported. Fictional actual-AI Hindi-to-English reminder tests passed with synthetic transport; fresh real-phone language/reminder arrival remains unverified.

This separate clean repository is public with founder approval. Original private history is excluded. Publishing source does not deploy the app or submit the Sprint entry.
