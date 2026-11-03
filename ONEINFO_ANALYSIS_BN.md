# Oneinfo System — কী কী তৈরি করা হয়েছে: বাংলা বিশ্লেষণ

**বিশ্লেষণের তারিখ:** ৩ নভেম্বর ২০২৬, বাংলাদেশ সময়

**রিপোজিটরি:** [fksifat/oneinfo_system](https://github.com/fksifat/oneinfo_system)

**পর্যালোচিত branch:** `main`

**পর্যালোচিত commit:** `ba2e31b13345dd7ded13a1b7689e82efef7f14dd` (`1st commit`, ২ নভেম্বর ২০২৬)

**লোকাল ফোল্ডার:** `/Users/nazmulhossain/Documents/ChatGPT/OneInfo`

> এই রিপোর্ট README-এর দাবি, প্রকৃত source code, database migration, পরীক্ষার কোড এবং সঙ্গে দেওয়া technical specification মিলিয়ে লেখা। “কোড আছে” এবং “চালিয়ে সফলভাবে যাচাই করা হয়েছে”—দুটি আলাদা বিষয়। যেসব পরীক্ষা চালানো যায়নি, সেগুলো নিচে স্পষ্ট করা হয়েছে। অ্যাপ্লিকেশনের কোড পরিবর্তন করা হয়নি।

## ১. সরাসরি মূল্যায়ন

এখানে **Oneinfo-এর QR/NFC business card তৈরি ও পরিচালনার প্রাথমিক ব্যবস্থা** বানানো হয়েছে। এর সঙ্গে ক্লায়েন্টের digital profile তৈরি ও প্রকাশের সুবিধা আছে। আলাদা একটি বিক্রির ওয়েবসাইটের static package-ও রাখা হয়েছে।

সবচেয়ে বেশি কাজ হয়েছে কার্ডের production workflow-তে: batch তৈরি → প্রতিটি কার্ডের আলাদা স্থায়ী URL → QR তৈরি → NFC লেখা ও read-back → QC → বিক্রিযোগ্য inventory → profile assignment।

তবে এটি এখনো সম্পূর্ণ বাণিজ্যিক SaaS বা production-ready ecommerce ব্যবস্থা নয়। Customer login, নিজের account থেকে profile পরিচালনা, payment, বাস্তব order processing, one-time activation, offline recovery এবং পূর্ণ print workflow বাকি। README-ও একে production launch-এর বদলে একটি foundation হিসেবে চিহ্নিত করেছে।

## ২. কোন অংশে কী বানানো হয়েছে

| অংশ | কাজ | বর্তমান সীমা |
|---|---|---|
| `apps/api` | Fastify backend; batch, card, job, profile, station, QC ও audit API | PostgreSQL প্রয়োজন; production authentication অসম্পূর্ণ |
| `apps/production-console` | অপারেটরের QR/NFC/QC workstation UI | Browser app; desktop installer বা offline queue নেই |
| `apps/control-center` | Admin dashboard, profile editor, card/inventory ও station তালিকা | Customer dashboard নয়; profile edit করতে super admin লাগে |
| `apps/android-nfc-bridge` | Android ফোন দিয়ে NFC পড়া, লেখা ও যাচাই | Android Studio/SDK, USB debugging ও NFC ফোন প্রয়োজন |
| `apps/desktop-nfc-bridge` | PC/SC USB reader দিয়ে NFC write/read-back | Python `pyscard` ও উপযুক্ত reader/tag প্রয়োজন |
| `packages/contracts` | Frontend/backend-এর shared TypeScript types ও Zod validation | OpenAPI বা generated API client নেই |
| `scripts` | API smoke test ও Android USB tunnel script | Smoke test আসল NFC hardware ব্যবহার করে না |
| `sites` | বিক্রির ওয়েবসাইটের static bundle ও storefront gitlink | Source checkout অসম্পূর্ণ; order/payment backend নেই |

**প্রযুক্তি:** Node.js, TypeScript, npm workspaces, Fastify, PostgreSQL 17, Drizzle ORM, Zod, JWT, React, Vite, `qrcode`, Kotlin/Android এবং Python PC/SC। PostgreSQL-এর Docker Compose configuration আছে।

## ৩. কার্ড উৎপাদনের কাজ

### ৩.১ Batch ও কার্ড তৈরি

- Admin batch code, product variant ও quantity দিয়ে production batch তৈরি করতে পারে।
- একবারে ১–১,০০০ কার্ড নেওয়ার validation আছে।
- প্রতিটি কার্ডের UUID, random public slug এবং canonical public URL তৈরি হয়।
- একই কার্ডের জন্য QR generation, NFC encoding ও quality control—তিনটি আলাদা job হয়।
- Batch, card, jobs ও creation events একটি database transaction-এ তৈরি হয়।
- Card slug, canonical URL এবং card/job-type জোড়ার unique constraint আছে।

**উৎস:** `apps/api/src/routes/batches.ts`, `apps/api/src/db/schema.ts`, `packages/contracts/src/index.ts`।

### ৩.২ Job queue ও claim

- Station নিজের assigned jobs ও unassigned queued jobs দেখতে পারে।
- QR, NFC এবং QC job আলাদা করে UI-তে দেখানো হয়।
- Job claim করার update-এ status ও station condition আছে; ফলে সাধারণ প্রতিযোগী claim ঠেকানোর ভিত্তি আছে।
- Claim-এর সঙ্গে operator, station, idempotency key এবং ১৫ মিনিটের lease expiry সংরক্ষণ হয়।
- NFC ব্যর্থ হলে job `RETRYABLE_FAILURE` হয়।
- একই idempotency key পুনরায় পাঠালে আগের result ফেরত দেওয়ার ব্যবস্থা আছে।

**সীমা:** Lease expiry লেখা হলেও renewal/recovery কার্যকর করা হয়নি। Result endpoint-এ job-এর বর্তমান status ও expiry যথেষ্ট যাচাই হয় না। UI প্রতিবার নতুন idempotency key বানায়; network timeout-এর পরে একই submission নির্ভরযোগ্যভাবে পুনরায় পাঠানোর durable ব্যবস্থা নেই।

**উৎস:** `apps/api/src/routes/jobs.ts`, `apps/production-console/src/App.tsx`।

### ৩.৩ QR তৈরি

- Server-এর canonical URL দিয়ে browser-এ QR preview তৈরি হয়।
- বর্তমান UI-তে PNG, ৩২০×৩২০ pixel, error correction `H` এবং margin `4` ব্যবহৃত হয়।
- PNG blob-এর SHA-256 checksum বের করা হয়।
- API-তে filename/storage key, checksum, dimensions ও generator version সংরক্ষণ হয়।
- QR generated status এবং card event রেকর্ড হয়।

**যা হয়নি:** PNG-এর স্থায়ী upload/storage/download workflow, SVG generation, bulk print-ready PDF sheet, CSV manifest, automated QR decode check এবং reprint history। Schema-তে `SVG`/`PDF` গ্রহণ করা মানেই সেই export তৈরি করা হয়েছে—এমন নয়। বর্তমান “Verify and record QR” কাজটি QR decode করে যাচাই করে না।

**উৎস:** `apps/production-console/src/App.tsx:211`, `apps/production-console/src/App.tsx:225`, `apps/api/src/routes/jobs.ts:120`।

### ৩.৪ NFC device pairing ও লেখা

দুই ধরনের hardware path তৈরি করা হয়েছে:

1. **Android ফোন:** USB দিয়ে কম্পিউটারে যুক্ত করে `adb reverse` tunnel; companion app API থেকে task নেয়, NDEF URI লেখে এবং পুনরায় পড়ে URL মেলায়।
2. **USB NFC reader:** Node bridge Python helper চালায়; PC/SC command দিয়ে Type 2 tag-এ NDEF URI লিখে read-back নেয়। কোড ACR122U-ধরনের reader ব্যবহারের উদ্দেশ্যে লেখা।

Pairing code পাঁচ মিনিটের, write session তিন মিনিটের এবং read session দুই মিনিটের। এগুলো API process-এর memory-তে থাকে; restart হলে হারায়।

- Android path-এ tag writable কি না এবং capacity যথেষ্ট কি না পরীক্ষা আছে।
- Write/read-back mismatch ও অন্যান্য ব্যর্থতার category আছে।
- Production console expected/read-back URL-এর hash তুলনা করে success/failure পাঠায়।
- প্রতিটি submitted NFC attempt আলাদা row হিসেবে থাকে; আগের failure update করে মুছে দেওয়া হয় না।
- Tag স্থায়ীভাবে lock করার কাজ নেই।

**সীমা:** Hardware compatibility এই পর্যালোচনায় প্রমাণিত নয়। Desktop helper-এ tag capacity/lock যাচাই Android path-এর মতো সম্পূর্ণ নয়। Desktop bridge শুধু write task poll করে; আলাদা read-inspection task-এর বাস্তব handler Android app-এ আছে।

**উৎস:** `apps/api/src/routes/local-nfc.ts`, `apps/production-console/src/nfc.ts`, `apps/desktop-nfc-bridge/src/index.mjs`, `apps/desktop-nfc-bridge/src/write_ndef.py`, `apps/android-nfc-bridge/app/src/main/java/com/oneinfo/nfcbridge/MainActivity.kt`।

### ৩.৫ NFC tag inspection

Android bridge দিয়ে tag না বদলে নিচের তথ্য দেখানোর ব্যবস্থা আছে:

- UID ও technologies;
- NDEF formatted কি না, type ও writable state;
- Capacity ও message size;
- URI/text records, record ID ও raw payload hex;
- Raw device result।

**উৎস:** Production console-এর `NfcInspector`, Android app-এর `readTag()` ও `recordJson()`।

### ৩.৬ QC ও inventory

- QC submit করতে `SUPER_ADMIN` বা `QUALITY_INSPECTOR` role লাগে।
- QR status `GENERATED` এবং NFC status `WRITTEN` না হলে QC pass প্রত্যাখ্যান হয়।
- Pass হলে card `QC_PASSED` ও inventory `SALEABLE` হয়।
- Fail হলে card `QUARANTINED` ও inventory `NOT_READY` হয়।
- QC result, inspector, reason/evidence reference, card event ও audit log থাকে।

**সীমা:** QR scan, visual inspection ও NFC evidence-এর আলাদা বাধ্যতামূলক checklist নেই; UI-তে মূলত pass/fail button। Reservation, order allocation, dispatch, delivery, return ও inventory movement ledger নেই। Batch status নিজে থেকে `COMPLETED` করার logic-ও দেখা যায়নি।

**উৎস:** `apps/api/src/routes/jobs.ts:217`, `apps/api/src/domain/workflow.ts`, `apps/production-console/src/App.tsx:292`।

## ৪. Admin panel ও digital profile

### ৪.১ Control center

Admin UI-তে আছে:

- Profile, card, batch, station, queued job, QR artifact ও NFC attempt-এর summary;
- Inventory status অনুযায়ী সংখ্যা;
- Client profile search, create, edit ও draft/publish;
- Cards & inventory, batches ও audit history তালিকা;
- Station status, last-seen ও revoke button;
- Production console খোলার link।

Dashboard-এর “Active stations” metric বাস্তবে সব registered station গোনে; revoked station বাদ দেওয়ার filter নেই। “API connected” indicator-ও live health probe-এর ফল নয়।

### ৪.২ Profile editor

Profile model/API-তে নাম, headline, company, bio, phone, email, website, avatar URL, theme, published state ও সর্বোচ্চ ১২টি custom link সমর্থিত। Theme তিনটি: `MIDNIGHT`, `IVORY`, `MINT`।

UI-তে profile preview, link add/remove এবং publish toggle আছে। Avatar URL API/model-এ আছে, কিন্তু বর্তমান editor-এ avatar upload বা URL input নেই। এটি admin-managed profile ব্যবস্থা; customer signup বা নিজের account থেকে edit করার ব্যবস্থা নেই।

### ৪.৩ Public profile ও card assignment

- `?profile=<slug>` দিয়ে public profile UI খোলে।
- নাম, পরিচয়, bio, call/email, website, custom links ও copy-link দেখা যায়।
- Published profile slug এবং card slug দিয়ে JSON API-তে profile resolve করা যায়।
- QC-passed card profile-এ assign করলে lifecycle `ACTIVATED` হয়; event/audit তৈরি হয়।

**গুরুত্বপূর্ণ সীমা:**

1. Profile assignment API আছে, কিন্তু control-center UI-তে card assign করার control নেই।
2. “Save contact details” button আসলে `mailto:` খোলে; `.vcf` contact download তৈরি হয়নি।
3. Customer-এর one-time activation secret বা self-activation flow নেই।
4. একই card আগে কারও profile-এ দেওয়া আছে কি না, reassignment-এর সময় যথেষ্ট রক্ষাকবচ নেই; assignment history-এর আলাদা table-ও নেই।
5. Encoded canonical `/c/<cardSlug>` URL খোলার public HTML route/deployment wiring এই source-এ নেই। JSON resolver থাকলেও physical tap/scan থেকে public profile page পর্যন্ত পুরো পথ শেষ হয়নি।

**উৎস:** `apps/control-center/src/App.tsx`, `apps/api/src/routes/profiles.ts:120`, `apps/api/src/config.ts`।

## ৫. বিক্রির ওয়েবসাইটে কী আছে

`sites/oneinfo-storefront-package.zip` নামের package-এর ভেতরে static HTML, CSS, JavaScript ও favicon আছে।

- Hero, how-it-works, card collection, digital-profile preview, comparison, team section ও FAQ;
- Essential, Signature ও Metal—তিনটি পণ্যের proposed price;
- Add-to-cart, cart drawer, quantity/subtotal এবং remove-item;
- Tap-experience demo;
- Order details ও team enquiry form;
- Mobile navigation এবং কিছু reveal animation;
- Cart, order draft ও team request browser `localStorage`-এ রাখা।

**বাস্তব ব্যবসায়িক অবস্থা:** কোনো order server-এ পাঠানো হয় না; payment, order database, email/CRM integration বা fulfilment নেই। UI-তেই local draft ও unconfirmed launch pricing-এর কথা লেখা আছে। এই দামকে final business pricing ধরা যাবে না।

**Repository packaging-এর দুটি সমস্যা:**

- `sites/oneinfo-storefront` একটি gitlink হিসেবে commit করা, কিন্তু `.gitmodules` mapping নেই। `git submodule status` ব্যর্থ হয়; বর্তমান checkout-এ source directory খালি। ফলে storefront source স্বাভাবিকভাবে পুনরুদ্ধারযোগ্য নয়।
- `.zip` extension দেওয়া ফাইলটি আসলে gzip-compressed tar archive। ZIP reader দিয়ে খুললে ব্যর্থ হয়; `tarfile` দিয়ে এর contents যাচাই করা হয়েছে।

## ৬. Database ও নিরাপত্তার যে ভিত্তি আছে

মোট **১২টি application table** পাওয়া গেছে:

| Table | উদ্দেশ্য |
|---|---|
| `operators` | Staff/operator পরিচয় ও role |
| `production_stations` | Station metadata ও credential hash |
| `customer_profiles` | Client-এর public profile |
| `profile_links` | Profile-এর অতিরিক্ত links |
| `card_batches` | Production batch |
| `cards` | Card identity, URL ও বিভিন্ন status |
| `production_jobs` | QR/NFC/QC job ও claim |
| `qr_artifacts` | QR metadata ও checksum |
| `nfc_encoding_attempts` | NFC attempt history |
| `quality_checks` | QC result ও evidence reference |
| `card_events` | Card-এর পরিবর্তনের ইতিহাস |
| `audit_logs` | Administrative/security-sensitive কাজের log |

দুটি SQL migration আছে। Foreign keys, indexes এবং কয়েকটি গুরুত্বপূর্ণ unique constraint দেওয়া হয়েছে।

নিরাপত্তার বর্তমান ভিত্তি:

- Operator JWT-এর মেয়াদ ৩০ মিনিট; issuer/audience verification আছে।
- Station credential database-এ hash হিসেবে রাখা হয়।
- Station revoke করলে station-authenticated API পরবর্তী request প্রত্যাখ্যান করে।
- পাঁচটি role সংজ্ঞায়িত; কিছু endpoint-এ explicit role restriction আছে।
- Request body Zod দিয়ে validate করা হয়।
- Production mode-এ development token issuance বন্ধ হয়।
- Default development secret ও example public domain production config-এ প্রত্যাখ্যান করার check আছে।
- API default-এ localhost-এ bind হয়; CORS-এর origin তালিকা আছে।
- Error response-এ request ID থাকে; server error-এর বিস্তারিত client-এ সরাসরি ফেরানো হয় না।

এসব থাকলেও নিচের authorization ও workflow সীমাবদ্ধতাগুলো সমাধান ছাড়া production readiness দাবি করা যায় না।

## ৭. গুরুত্বপূর্ণ সমস্যা ও অসম্পূর্ণতা

এগুলো source inspection-ভিত্তিক findings; production exploit বা hardware failure ঘটিয়ে দেখা হয়নি।

| গুরুত্ব | কী পাওয়া গেছে | কেন গুরুত্বপূর্ণ | Source |
|---|---|---|---|
| উচ্চ | NFC result API `SUCCEEDED` নিলে expected/read-back hash সমান কি না বা canonical URL-এর hash কি না যাচাই করে না | পরিবর্তিত client সরাসরি API-তে success জমা দিয়ে NFC status `WRITTEN` করতে পারে; UI-এর check একা যথেষ্ট নয় | `packages/contracts/src/index.ts:67`, `apps/api/src/routes/jobs.ts:161` |
| উচ্চ | Job list/claim, QR ও NFC submission-এ role-specific allowlist নেই | Station key ও বৈধ auditor/অনুপযুক্ত role-এর token পেলেও production mutation আটকানোর explicit role gate নেই; QC-তে gate আছে | `apps/api/src/routes/jobs.ts:23`, `apps/api/src/routes/jobs.ts:73` |
| উচ্চ | QR/NFC/QC result endpoint station assignment ও job type দেখলেও `CLAIMED` status, lease validity ও lifecycle transition যথেষ্ট enforce করে না | নতুন key দিয়ে completed job-এ result আবার জমা দিয়ে পুরোনো state বদলে দেওয়া সম্ভব হওয়ার পথ আছে | `apps/api/src/routes/jobs.ts:28`, `apps/api/src/routes/jobs.ts:120`, `apps/api/src/routes/jobs.ts:217` |
| উচ্চ | Public card resolver শুধু profile published কি না দেখে; card lifecycle/status filter নেই | ভবিষ্যতে suspended/retired card ব্যবহৃত হলেও শুধু lifecycle বদলানো public access বন্ধ করবে না | `apps/api/src/routes/profiles.ts:38` |
| উচ্চ | Real identity provider, customer login ও activation secret flow নেই | Development admin দিয়ে demo চলে; নিরাপদ customer ownership ও production login শেষ হয়নি | `apps/api/src/auth.ts`, `apps/api/src/routes/dev.ts`, `apps/api/src/routes/profiles.ts:120` |
| মাঝারি | NFC device token দিয়ে task/result endpoint station revocation পুনরায় যাচাই করে না | Station revoke হলেও আগের device token দিয়ে pending bridge কাজ চলতে পারে; station-authenticated final submission অবশ্য বন্ধ হয় | `apps/api/src/routes/local-nfc.ts:68`, `apps/api/src/routes/admin.ts:67` |
| মাঝারি | QR file কেবল browser preview-তে; API metadata নেয় | Reload-এর পরে আসল printable artifact পাওয়ার নিশ্চয়তা নেই; storage key কোনো upload-এর প্রমাণ নয় | `apps/production-console/src/App.tsx:225`, `apps/api/src/routes/jobs.ts:120` |
| মাঝারি | Idempotency lookup শুধু key-ভিত্তিক; concurrent insert conflict handling ও job/payload binding নেই | Retry ও concurrent submission-এর আচরণ আরও শক্ত করতে হবে; unique constraint একা সম্পূর্ণ replay protocol নয় | `apps/api/src/routes/jobs.ts:127`, `apps/api/src/routes/jobs.ts:168` |
| মাঝারি | Job lease recovery, durable offline queue, pagination ও full lifecycle orchestration নেই | Restart/outage বা বড় batch-এ কাজ আটকে যাওয়া ও অসম্পূর্ণ তালিকা দেখার ঝুঁকি থাকে | `apps/api/src/routes/jobs.ts:63`, `apps/api/src/routes/jobs.ts:78` |
| মাঝারি | `.env` ব্যবহার নিয়ে setup gap | API config শুধু `process.env` পড়ে; scripts-এ dotenv/`--env-file` নেই। `.env` কপি করলেই API/Drizzle config load হবে ধরে নেওয়া যাবে না | `apps/api/src/config.ts:25`, `apps/api/package.json`, `apps/api/drizzle.config.ts` |

অতিরিক্তভাবে, operator token যাচাইয়ের সময় database-এর `active` flag বা সর্বশেষ role পুনরায় দেখা হয় না। Browser `localStorage`-এ token ও station key থাকে; secure credential-store integration নেই। Pairing endpoint-এ rate limiting নেই। Public API-তে পুরো profile/card row ফেরানো হয়; public response-এর জন্য field allowlist বিবেচনা করা দরকার।

## ৮. Specification-এর সঙ্গে কাজের তুলনা

সঙ্গে দেওয়া `Oneinfo_QR_NFC_Production_System_Technical_Specification.docx`-এ cloud-first shared backend, local production app, online customer services ও offline queue-এর পরিকল্পনা ছিল। বর্তমান README production-management অংশকে local-only করেছে। এই architecture পরিবর্তনের operational সিদ্ধান্ত নিশ্চিত করা প্রয়োজন: backend শুধু workstation-এ থাকলে public profile data বাইরে কীভাবে পাওয়া যাবে, তার hosting/sync পথ এখনো অসম্পূর্ণ।

| Specification-এর চাহিদা | কোডের বর্তমান অবস্থা |
|---|---|
| Server-owned card identity ও canonical URL | বাস্তবায়িত |
| Batch, job, attempt, QC ও audit data | মূল ভিত্তি বাস্তবায়িত |
| PNG/SVG/PDF print sheets ও manifest | PNG browser preview ও metadata আছে; বাকি নেই |
| Physical NFC write/read-back | Android ও PC/SC implementation আছে; hardware যাচাই বাকি |
| Server-enforced verification ও lifecycle | আংশিক; উপরের validation gap আছে |
| Durable SQLite queue ও offline reconciliation | নেই |
| Tauri desktop package, signed release/update | নেই |
| Customer dashboard ও নিজের profile edit | নেই; admin editor আছে |
| One-time activation secret ও ownership | নেই; admin assignment-এ activate হয় |
| Inventory reservation/fulfilment/history | শুধু QC-ভিত্তিক saleable state ও তালিকা |
| Pagination, lease renewal, stale-job recovery | নেই |
| OpenAPI ও generated client | নেই |
| Payment/order processing | নেই; storefront local draft রাখে |
| Security, hardware, load, backup/restore, offline tests | এই coverage repository-তে পাওয়া যায়নি |

## ৯. এই পর্যালোচনায় যাচাই

Node.js `v26.7.0` ও npm `11.19.0` দিয়ে যাচাই করা হয়েছে। Repository Node.js `>=22.12` চায়; সর্বনিম্ন supported Node version আলাদা করে পরীক্ষা করা হয়নি।

| পরীক্ষা | ফল |
|---|---|
| Dependency installation | সফল; download-এর সময় অনুপস্থিত macOS native packageগুলো সংগ্রহ করার পর offline `npm ci` দিয়ে lockfile অনুযায়ী dependencies পুনঃস্থাপন করা হয়েছে |
| Installed version বনাম lockfile check | উপস্থিত packageগুলোর version mismatch পাওয়া যায়নি |
| `npm run typecheck` | সফল; contracts, API, production console ও control center |
| `npm test` | সফল; ১টি test file, ৪টি test পাস |
| `npm run build` | সফল; contracts/API compile ও দুই React app-এর production bundle তৈরি |
| Fastify `app.inject()` দিয়ে API check | `/health` → ২০০; token ছাড়া admin overview ও production jobs → ৪০১ |
| JavaScript/shell/Python syntax ও archive check | সফল; নিচে বিস্তারিত |
| Database migration ও API smoke test | চালানো হয়নি |
| Android APK build ও physical NFC/QR test | চালানো হয়নি |

Build/test-এর প্রথম চেষ্টা native dependency না থাকায় ব্যর্থ হয়েছিল; সেই environment সমস্যা সমাধানের পরে উপরের সফল ফল পাওয়া গেছে। `package.json`, `package-lock.json` ও tracked application source অপরিবর্তিত আছে।

নিশ্চিতভাবে পর্যবেক্ষণ করা হয়েছে:

- GitHub থেকে `origin/main` fetch ও local `main` checkout সম্পন্ন; commit উপরে লেখা আছে।
- JavaScript bridge ও smoke script-এর `node --check` সফল।
- Android USB script-এর `bash -n` সফল।
- Python helper-এর AST syntax check সফল।
- `NfcAttemptSchema.safeParse()`-এ আলাদা expected/read-back hash দিয়ে `SUCCEEDED` পাঠিয়ে acceptance নিশ্চিত হয়েছে; server-side verification gap-এর schema অংশটি সরাসরি reproduce করা হয়েছে। Database-এ কোনো attempt লেখা হয়নি।
- Storefront archive-এর HTML/CSS/JS উপস্থিতি যাচাই সফল; archive format mismatch নিশ্চিত।
- Storefront submodule mapping অনুপস্থিত; `git submodule status` ব্যর্থ।

**চালানো হয়নি:** PostgreSQL migration ও API smoke test; এখানে Docker/PostgreSQL command পাওয়া যায়নি। Android build/hardware test-ও হয়নি; Gradle/ADB command পাওয়া যায়নি। Browser UI, physical QR scan, USB reader, NFC tag, payment বা live deployment যাচাই করা হয়নি।

Health/auth checks in-process API injection দিয়ে করা; listening server, database connectivity বা deployed service-এর প্রমাণ নয়।

Repository-তে চারটি workflow unit test আছে। এগুলো ছোট helper পরীক্ষা করে; API permission, SQL transaction বা NFC hardware পরীক্ষা নয়। `canClaimJob()` helper test করা হলেও actual claim route নিজস্ব SQL condition ব্যবহার করে। Smoke script আছে, কিন্তু সেটিও QR metadata ও NFC success সরাসরি API-তে জমা দেয়—সত্যিকারের QR decode বা physical write করে না।

## ১০. পরবর্তী কাজের বাস্তব অগ্রাধিকার

1. **প্রথমে backend correctness:** canonical URL/read-back verification server-এ নেওয়া; role gate, job state, lease, lifecycle এবং retry checks ঠিক করা।
2. **Public profile চালু করার পূর্ণ পথ:** আসল domain, `/c/<slug>` page/resolver routing, published data-এর hosting এবং inactive-card blocking।
3. **Authentication ও ownership:** বাস্তব staff/customer login, profile ownership, one-time activation ও reassignment policy।
4. **উৎপাদনের উপযোগী QR/NFC:** স্থায়ী artifact storage, download/SVG/PDF/manifest এবং নির্বাচিত reader/tag/printer-এ পরীক্ষা।
5. **Operational reliability:** job recovery, durable retry queue, pagination, backup/restore ও integration/security tests।
6. **বিক্রির workflow:** storefront source ঠিকভাবে version করা; real order API, approved pricing, payment ও fulfilment যুক্ত করা।

## ১১. ব্যবসার ভাষায় সিদ্ধান্ত

Developer **কার্ড তৈরির মূল backend, workstation UI, admin panel, basic profile system এবং NFC bridge-এর উল্লেখযোগ্য প্রাথমিক কাজ করেছেন**। বিক্রির ওয়েবসাইটের visual draft-ও আছে।

এটি দিয়ে পরবর্তী development ও নিয়ন্ত্রিত demonstration এগোনোর ভিত্তি পাওয়া যায়। তবে “customer টাকা দিয়ে কিনবে → card প্রস্তুত হবে → নিজে activate করবে → tap/scan করলে live profile খুলবে”—এই সম্পূর্ণ বাণিজ্যিক যাত্রা এখনো শেষ হয়নি। কাজের সুনির্দিষ্ট সীমা: **production workflow-এর ভিত্তি তৈরি, commercial launch-এর গুরুত্বপূর্ণ সংযোগ ও যাচাই বাকি।**

### মূল source references

- [README ও ঘোষিত সীমা](https://github.com/fksifat/oneinfo_system/blob/ba2e31b13345dd7ded13a1b7689e82efef7f14dd/README.md)
- [Database schema](https://github.com/fksifat/oneinfo_system/blob/ba2e31b13345dd7ded13a1b7689e82efef7f14dd/apps/api/src/db/schema.ts)
- [Production job API](https://github.com/fksifat/oneinfo_system/blob/ba2e31b13345dd7ded13a1b7689e82efef7f14dd/apps/api/src/routes/jobs.ts)
- [Profile ও assignment API](https://github.com/fksifat/oneinfo_system/blob/ba2e31b13345dd7ded13a1b7689e82efef7f14dd/apps/api/src/routes/profiles.ts)
- [NFC bridge API](https://github.com/fksifat/oneinfo_system/blob/ba2e31b13345dd7ded13a1b7689e82efef7f14dd/apps/api/src/routes/local-nfc.ts)
- [Production console](https://github.com/fksifat/oneinfo_system/blob/ba2e31b13345dd7ded13a1b7689e82efef7f14dd/apps/production-console/src/App.tsx)
- [Control center ও public profile UI](https://github.com/fksifat/oneinfo_system/blob/ba2e31b13345dd7ded13a1b7689e82efef7f14dd/apps/control-center/src/App.tsx)
- [Shared validation](https://github.com/fksifat/oneinfo_system/blob/ba2e31b13345dd7ded13a1b7689e82efef7f14dd/packages/contracts/src/index.ts)

## ১২. পরবর্তী local run — ৩ নভেম্বর ২০২৬

ব্যবহারকারীর “run koro” নির্দেশের পরে system চালানো হয়েছে। প্রথম পর্যালোচনায় PostgreSQL command PATH-এ পাওয়া যায়নি; পরে `/opt/homebrew/opt/postgresql@16/bin`-এ ইনস্টল করা PostgreSQL 16.15 পাওয়া গেছে।

- `/private/tmp/oneinfo-runtime/postgres`-এ আলাদা নতুন local database cluster তৈরি করা হয়েছে; আগের কোনো database পরিবর্তন করা হয়নি। এটি temporary development data, স্থায়ী deployment নয়।
- Localhost port `55432`-এ PostgreSQL চালু করে repository-এর দুইটি migration সফলভাবে প্রয়োগ করা হয়েছে। Docker ব্যবহার করা হয়নি; Compose-এর PostgreSQL 17 এই run-এ পরীক্ষা হয়নি।
- API: `http://127.0.0.1:3001/health` → HTTP ২০০।
- Production console: `http://127.0.0.1:5173/` → HTTP ২০০।
- Admin panel: `http://127.0.0.1:5174/` → HTTP ২০০।
- Storefront static preview: `http://127.0.0.1:5175/` → HTTP ২০০।
- Development login এবং PostgreSQL-backed admin overview সফলভাবে পরীক্ষা করা হয়েছে; browser-এ admin dashboard-ও খুলেছে। নতুন database-এ card/profile/batch data খালি আছে।
- Runtime credentials private file permissions-সহ temporary runtime directory-তে আছে; application source বা Git-এ যোগ করা হয়নি।

এই পরবর্তী run-এ migration ও database-backed login যাচাই হয়েছে। Full production smoke script, physical NFC/QR test এবং live deployment এখনো যাচাই করা হয়নি।
