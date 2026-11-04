# Oneinfo Database Audit

**তারিখ:** ৪ নভেম্বর ২০২৬ (Asia/Dhaka)
**ধরন:** read-only audit
**পরিধি:** লোকাল PostgreSQL, API connectivity/health, Drizzle schema/migrations, এবং DB-নির্ভর route/query।
**কোড বা database-এ কোনো পরিবর্তন করা হয়নি।**

## সংক্ষিপ্ত উত্তর: database খুলছে না কেন?

এই মুহূর্তে PostgreSQL process চলছে, কিন্তু Oneinfo API চলছে না বা `3001` port-এ listen করছে না। `GET http://127.0.0.1:3001/health`-এ connection refused এসেছে। ফলে admin/control-center-এর database-নির্ভর page API-তে পৌঁছাতে পারছে না।

এছাড়া connection configuration-এ অসামঞ্জস্যের প্রমাণ আছে:

- `55432` port-এ একটি PostgreSQL 16.15 server চলছে। এর data directory `/private/tmp/oneinfo-runtime/postgres`।
- এই DB-তে local Unix socket দিয়ে read-only query করা গেছে; ৮টি Drizzle migration আছে। DB-র আকার প্রায় ৮.৫ MB; পাওয়া row count: ২টি product, ১টি order, ২৫টি audit log, ০টি card ও ০টি job।
- একই server-এ repository-র default TCP connection URL দিয়ে চেষ্টা করলে password authentication ব্যর্থ হয়েছে। অর্থাৎ সক্রিয় server-এর TCP auth আর app-এর effective `DATABASE_URL` এক নয়, অথবা API-তে অন্য URL দরকার। কোনো password/secret রিপোর্টে রাখা হয়নি।
- `compose.yaml`-এ আরেকটি পথ আছে: Docker PostgreSQL 17, একই host port `55432`-এ। ফলে Docker চালালে existing PostgreSQL 16 server-এর সঙ্গে port conflict হতে পারে; একই port-এর দুটি DB-কে গুলিয়ে ফেলার ঝুঁকিও আছে।

**সবচেয়ে সম্ভাব্য তাৎক্ষণিক কারণ:** API বন্ধ এবং app-এর DB connection settings সক্রিয় PostgreSQL instance-এর সঙ্গে মেলেনি। এটা database file নষ্ট হওয়ার প্রমাণ নয়।

## Must fix — আগে এগুলো

### 1. একটিমাত্র database instance বেছে connection ঠিক করতে হবে

**সমস্যা:** লোকাল PostgreSQL 16 চলছে, Compose-এ PostgreSQL 17-ও `55432` ব্যবহার করতে চায়। বর্তমান TCP password mismatch থাকায় API ওই চলমান DB-তে login করতে পারছে না। ভুল instance-এ API চালালে data আলাদা/খালি দেখাতে পারে।

**করণীয়:** আগে ঠিক করতে হবে development-এর জন্য `/private/tmp/oneinfo-runtime/postgres`-এর DB-টাই চলবে, নাকি Compose volume-এর PostgreSQL। তারপর সেই instance অনুযায়ী `DATABASE_URL`, username/password ও port একসঙ্গে মেলাতে হবে। Compose চালানোর আগে `55432` port কার দখলে তা যাচাই করতে হবে। এখনই নতুন DB initialize, `db:push`, migration rerun বা volume reset করা উচিত নয়।

**ঝুঁকি:** `/private/tmp/oneinfo-runtime/postgres` temporary path। এখানে রাখা data production-এর স্থায়ী backup নয়; temp cleanup বা machine maintenance-এ হারাতে পারে। এই instance-কে production DB ভাবা যাবে না।

### 2. API চালু এবং DB readiness আলাদা করে যাচাই করতে হবে

**সমস্যা:** বর্তমানে `3001`-এ API listener পাওয়া যায়নি। আরও একটি কোড-সমস্যা হলো `/health` শুধু `{status:"ok"}` ফেরায়; PostgreSQL-এ query করে না। API চালু থাকলেও DB বন্ধ/ভুল credential হলে health check ভুলভাবে healthy দেখাতে পারে।

**করণীয়:** সঠিক `DATABASE_URL` দিয়ে API চালু করে admin page খোলার আগে API health এবং DB readiness দুটো যাচাই করতে হবে। Health response-এ DB query fail হলে `503` দিতে হবে, এবং DB error log করতে হবে—credential বা customer data নয়।

## Should fix — ধীর হওয়ার সম্ভাব্য কারণ

### 1. Admin overview প্রতিবার বড় table গুনছে

`/api/v1/admin/overview` একসাথে সাতটি `COUNT(*)` চালায়, তারপর inventory status-এর জন্য cards table আবার group করে গোনে। QR artifacts ও NFC attempts-এর মতো history table বড় হলে প্রতিটি dashboard load-এ পুরো index/table scan লাগতে পারে। `Promise.all` সময় বাঁচাতে পারে, কিন্তু মোট DB কাজ কমায় না।

**করণীয়:** আগে query timing মাপতে হবে। এরপরই প্রয়োজনমতো cache/summary counter বা dashboard refresh interval যোগ করা যায়। ছোট বর্তমান data-তে এখনই cache বানানোর প্রমাণ নেই।

### 2. ১,০০০ কার্ডের batch তৈরি sequential query চালায়

Batch quantity সর্বোচ্চ ১,০০০। route-টি প্রতিটি কার্ডের জন্য card row, ৩টি job row-এর একটি bulk insert, এবং event row—এই ৩টি statement আলাদা `await` করে চালায়। সর্বোচ্চ batch-এ প্রায় ৩,০০০ sequential DB statement একই transaction-এ হয়। বড় batch অনেক ধীর হতে পারে এবং transaction/connection দীর্ঘক্ষণ ধরে রাখে।

**করণীয়:** row data আগে তৈরি করে cards/jobs/events bulk insert করতে হবে; প্রয়োজনে সীমিত chunk-এ, কিন্তু একই transaction ও uniqueness/error handling বজায় রেখে।

### 3. কিছু admin list-এর sort কলামে index নেই

Cards, batches, stations ও audit logs `createdAt DESC` অনুযায়ী সাজায়। Schema-তে এই চারটি `createdAt` sort-এর index নেই; audit log-এ শুধু target type/id index আছে। Data বাড়লে sort ও `LIMIT`-এর আগের scan ব্যয়বহুল হতে পারে।

**করণীয়:** production সদৃশ data-তে `EXPLAIN (ANALYZE, BUFFERS)` দেখে যেসব query সত্যি ধীর, শুধু সেগুলোর জন্য index migration তৈরি করতে হবে। অন্ধভাবে সব index যোগ করলে write ও storage খরচ বাড়ে।

### 4. Batch details endpoint সব card একবারে ফেরায়

`GET /api/v1/production/batches/:batchId` ওই batch-এর সব card limit/pagination ছাড়া ফেরায়। ১,০০০-card batch হলে বড় response ও UI render সময় বাড়তে পারে।

**করণীয়:** cursor/limit pagination যোগ করতে হবে; batch summary আলাদা ছোট response-এ রাখা যায়।

### 5. Pool/slow-query পর্যবেক্ষণ সীমিত

DB pool-এ `max: 10` আছে, কিন্তু connect timeout, pool error listener, query duration logging/slow-query threshold app code-এ set করা নেই। PostgreSQL unavailable হলে request অপেক্ষা করতে পারে; কোন SQL ধীর তা নির্দিষ্ট করা কঠিন।

**করণীয়:** উপযুক্ত connection timeout, pool error log এবং request/query duration metrics যোগ করতে হবে। Pool size বাড়ানো একা সমাধান নয়; এতে DB-র ওপর চাপ আরও বাড়তে পারে।

## বর্তমান schema ও সূচক সম্পর্কে

- Job queue, station/status, card batch/profile, card events, product catalog এবং orders-এর জন্য কিছু উপযোগী index আগে থেকেই আছে। তাই সব query-ই index-হীন—এমন নয়।
- Store orders-এ `(created_at, id)` index আছে; orders API cursor pagination-ও ব্যবহার করে।
- Drizzle migration ledger-এ ৮টি migration দেখা গেছে। এই audit-এ migration চালানো হয়নি।
- বর্তমান row count খুব ছোট; তাই “database নিজেই ধীর” বলে সিদ্ধান্ত দেওয়ার মতো evidence নেই। সবচেয়ে শক্ত প্রমাণ হলো API অনুপস্থিত ও active DB-র TCP credential/config mismatch।

## কীভাবে যাচাই করা হয়েছে

- `127.0.0.1:3001/health`: connection refused.
- PostgreSQL listener: `127.0.0.1:55432`-এ process পাওয়া গেছে; `pg_isready` elevated read-only check-এ accepting connections।
- Local socket দিয়ে read-only metadata/aggregate query: PostgreSQL 16.15, DB size প্রায় ৮.৫ MB, migration count ৮, অল্প row count।
- Default TCP URL দিয়ে login: password authentication failed.
- Source code-এ pool config, health route, admin aggregation, batch creation/query, schema index ও migration configuration পর্যালোচনা।

### Source references

- `apps/api/src/config.ts:8-10` — default database URL, API port ও host.
- `apps/api/src/db/client.ts:6-10` — PostgreSQL pool configuration.
- `apps/api/src/app.ts:25` — DB query ছাড়া liveness health response.
- `apps/api/src/routes/admin.ts:21-34,47-88` — overview aggregates ও sorted admin lists.
- `apps/api/src/routes/batches.ts:21-73` — sequential batch writes এবং unbounded batch-card read.
- `apps/api/src/db/schema.ts:124-158,257-271,307-328` — batch/card/audit/order indexes.
- `compose.yaml:2-16` — Compose PostgreSQL version, port mapping, healthcheck.

## Verdict

**এখনই প্রথম কাজ performance tuning নয়:** আগে Oneinfo API-কে intended PostgreSQL instance-এ authenticated connection দিতে হবে এবং API listener চালু করতে হবে। এরপর production-সদৃশ data দিয়ে query timings সংগ্রহ করে overview counts, batch creation ও admin sort/index optimizations ক্রমানুসারে করতে হবে। বিদ্যমান DB volume/data মুছে নতুন করে শুরু করা এই audit-এর সুপারিশ নয়।

## যা এই audit-এ করা হয়নি

- API/DB config পরিবর্তন, API start, migration, write query, database backup/restore বা data modification করা হয়নি।
- Full API request replay, production load test, execution-plan benchmark, backup/restore verification এবং database log inspection করা হয়নি। তাই প্রকৃত user-facing latency-এর সুনির্দিষ্ট millisecond root cause এখনো মাপা হয়নি।

## Follow-up: প্রথম সমস্যা ঠিক ও যাচাই

**৪ নভেম্বর ২০২৬:** লোকাল runtime-এর private `app.env` ব্যবহার করে API `127.0.0.1:3001`-এ চালু করা হয়েছে। এটি repository-র default DB password নয়; তাই আগের default-credential test ব্যর্থ হলেও আসল runtime configuration দিয়ে সংযোগ ঠিক হয়েছে। কোনো schema, row বা DB setting পরিবর্তন করা হয়নি।

যাচাই:

- `/health`: HTTP 200, প্রায় 7 ms.
- `/api/v1/products/public` (DB read): HTTP 200, প্রায় 44 ms; ২টি published product ফেরত দিয়েছে।
- Admin overview: HTTP 200, প্রায় 21 ms.
- Profiles, cards, batches, stations ও audit-log read endpoint: সব HTTP 200, প্রায় 1–3 ms করে। বিদ্যমান dev operator ব্যবহার হয়েছে; নতুন operator বানানো হয়নি।

এই মাপে **database-backed admin endpoints slow নয়**। একই startup-এ browser-এর media proxy request-গুলো (`/api/v1/product-media/drive/...`) প্রায় 1.7–2.4 সেকেন্ড নিয়েছে। সুতরাং page-এ অপেক্ষা থাকলে সেটি remote Google Drive media fetch-এও হতে পারে; Drive-এর বাইরের network/cache behavior এই check-এ আলাদা করে যাচাই হয়নি।

**এখনকার অবস্থা:** API process চালু আছে, তাই admin app-এর database page endpoint-গুলো খুলতে পারার কথা। এই process বন্ধ হলে API-ও বন্ধ হবে; startup persistence/service manager সেটআপ এই ধাপে করা হয়নি।
