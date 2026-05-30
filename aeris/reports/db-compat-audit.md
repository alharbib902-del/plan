# تقرير فحص التوافق الصارم: التطبيق ↔ قاعدة البيانات الخارجية (Supabase)

**التاريخ:** 2026-05-30
**المشروع الخارجي:** `ugwxklkulptxrgqysxkn` (https://ugwxklkulptxrgqysxkn.supabase.co)
**الفرع:** `codex/admin-login-rate-limit`
**الطريقة:** فحص حيّ مباشر لقاعدة البيانات الخارجية عبر PostgREST (نفس الواجهة التي يستخدمها التطبيق عبر `supabase-js`) باستخدام `SUPABASE_SERVICE_ROLE_KEY` من `.env.local`.

---

## 1) الملخّص التنفيذي

| المحور | النتيجة |
|--------|---------|
| جداول التطبيق (43) موجودة في القاعدة الحيّة | ✅ 100% |
| دوال التطبيق RPC (63) موجودة في القاعدة الحيّة | ✅ 100% |
| تأكيدات الأعمدة/المعاملات/قيم enum (1,020 تأكيداً) | ✅ نجح 1,012 — ❌ فشل 8 |
| توافق `types/database.ts` مع الحيّة (الاتجاه الخطِر) | ✅ 0 عمود مفقود |
| انحراف المخطط (migrations ↔ الحيّة) | 🟡 6 جداول يتيمة في الحيّة بلا migration |

**الحُكم العام:** التوافق التشغيلي **سليم بدرجة عالية**. تم رصد **عطل وظيفي حقيقي واحد بخطورة عالية** (حجوزات المُشغّل)، و**انحراف schema متوسط** (جداول يتيمة)، إضافةً إلى ملاحظات حوكمة.

---

## 2) المنهجية والتغطية

تم بناء ثلاثة مدقّقات (في `aeris/scripts/`):
- `live-introspect.cjs` — يجلب المخطط الحيّ الكامل (72 جدول/عرض، 371 دالة) → `reports/live-schema*.json`.
- `audit-columns.cjs` — يطابق استخدام الكود الفعلي مقابل الحيّة.
- `audit-types.cjs` — يطابق `types/database.ts` مقابل الحيّة.

**أرقام التغطية المُثبتة:**
- 253 استدعاء `.from()` تم حلّه إلى 50 جدولاً حيّاً (شامل: bookings, clients, operators, trip_requests, empty_legs, cargo_*, medevac_*, privilege_*, reviews, support_*).
- **1,020 تأكيد توافق فردي:** 343 عمود مرشّح (`.eq/.order/...`) + 318 عمود `.select` + 231 معامل RPC عبر 81 دالة + 109 مفتاح كتابة (`insert/update/upsert`) + 19 قيمة enum.

---

## 3) النتائج

### 🔴 [عالٍ] عطل صامت: حجوزات المُشغّل تستعلم عن أعمدة غير موجودة

**الملف:** `lib/operators/portal-queries.ts:73` و `:98`

```js
.from('bookings')
.select('id, booking_number, status, total_price_sar, created_at, customer_name, customer_phone, operator_id')
```

الأعمدة `status`, `total_price_sar`, `customer_name`, `customer_phone` **غير موجودة** في جدول `bookings` الحيّ (47 عموداً). البدائل الصحيحة الموجودة فعلاً:

| المستخدَم (خاطئ) | الصحيح في الحيّة |
|---|---|
| `status` | `payment_status` (`pending\|paid\|refunded\|pending_offline`) و/أو `flight_status` (`confirmed\|boarding\|in_flight\|completed\|cancelled`) |
| `total_price_sar` | `total_amount` |
| `customer_name` | `customer_name_snapshot` |
| `customer_phone` | `customer_phone_snapshot` |

**الأثر:** PostgREST يُرجع خطأ 400 للاستعلام بأكمله، لكن الدالتين تبتلعان الخطأ في `try/catch` دفاعي وتُعيدان `[]`/`null`. النتيجة: **الدالتان مُستخدَمتان فعلاً** في:
- `app/operator/(authed)/bookings/page.tsx:32` → `listOperatorBookings` → قائمة حجوزات المُشغّل **فارغة دائماً**.
- `app/operator/(authed)/bookings/[id]/page.tsx:40` → `getOperatorBookingById` → صفحة التفاصيل **"غير موجود" دائماً**.

العطل غير مرئي (لا أخطاء ظاهرة)، لذا قد يمرّ دون ملاحظة. الواجهة (`page.tsx`) تعرض `b.customer_name` و`b.total_price_sar` فتظهر فارغة.

**الإصلاح المقترح:** تصحيح أسماء الأعمدة في السطرين 73 و98 + تحديث الواجهة `OperatorBookingPreview` (الأسطر 50-59) وعرض الحقول في الصفحتين.

---

### 🟡 [متوسط] انحراف schema: 6 جداول في الحيّة بلا migration في المستودع

الجداول التالية موجودة في القاعدة الخارجية الحيّة، لكن **لا يُنشئها أي ملف `*.sql`** في المستودع (لا في `supabase/migrations/` ولا في الجذر):

| الجدول | يستخدمه التطبيق؟ |
|---|---|
| `public_action_attempts` | لا |
| `admin_users` | لا |
| `admin_user_sessions` | لا |
| `admin_mfa_secrets` | لا |
| `admin_mfa_recovery_codes` | لا |
| `admin_mfa_challenge_attempts` | لا |

**ملاحظة:** مصادقة الأدمن الحالية تستخدم `admin_accounts` (من migration رقم `20260531000002_admin_accounts_2fa.sql`) و`admin_login_attempts`، وكلاهما متتبَّع بشكل صحيح. الجداول الستة أعلاه تبدو **بقايا/إرث** من تصميم سابق أو ميزة 2FA مُجهّزة جزئياً في القاعدة دون migration.

**الأثر:** لا يكسر التطبيق (غير مُستخدمة)، لكنه:
1. **خطر إعادة الإنتاج:** بيئة جديدة عبر `supabase db reset` لن تُنشئ هذه الجداول.
2. **حوكمة/أمان:** `admin_mfa_secrets` و`admin_users` قد تحوي أسراراً/بيانات اعتماد قديمة غير مُدارة.

**التوصية:** إمّا توليد migration رسمي لها (إن كانت مقصودة لميزة 2FA قادمة) أو إسقاطها (`DROP TABLE`) إن كانت إرثاً.

> **قرار المؤسّس (2026-05-30):** تُترك موثّقة فقط — لا حذف ولا migration حالياً. يُعاد النظر لاحقاً عند الحاجة.

---

### 🔵 [منخفض/حوكمة] `types/database.ts` متأخّر عمداً + سطح "loose" واسع

- ملف `types/database.ts` **مُصان يدوياً** ويغطّي 34 جدولاً فقط. 14 عموداً حيّاً غير مُغطّى فيه (مقصود وموثّق في `loose-query.ts`):
  - `bookings`: `cashback_redemption_sar`, `cashback_earned_sar`, `paid_at`, `is_covered`
  - `clients`: `privilege_tier`, `privilege_tier_assigned_at`, `privilege_tier_qualified_spend_12m_sar`, `privilege_below_threshold_since`, `tier_locked_until`, `cashback_balance_sar`, `two_factor_enabled`
  - `cargo_requests`: `founder_batch_alerted_at`
  - `cargo_offers`: `decline_reason`, `withdraw_reason`
- **141 استخداماً لمنفذ التجاوز غير المكتوب** (`createLooseClient` / `LooseRpcClient` / `as unknown as` / `as any`) عبر **64 ملفاً** (cargo, medevac, privilege, reviews, support, مصادقة العميل).
- **الأثر:** هذا السطح **لا يفحصه TypeScript وقت البناء** — أي خطأ مستقبلي في اسم عمود/معامل لن يُكتشف إلا وقت التشغيل (كما حدث في النتيجة العالية أعلاه). **التوصية:** إعادة توليد `types/database.ts` من القاعدة (`supabase gen types`) وتقليص استخدام العملاء الفضفاضين.

---

## 4) ما تم التحقق منه ونجح (مطمئن)

- ✅ كل جداول ودوال التطبيق موجودة في القاعدة الحيّة.
- ✅ 0 خطأ في معاملات الـRPC (231 تأكيداً عبر 81 دالة) — أسماء المعاملات (`p_*`) مطابقة تماماً.
- ✅ 0 خطأ في مفاتيح الكتابة (insert/update/upsert — 109 تأكيداً).
- ✅ 0 خطأ في أعمدة المرشّحات (343 تأكيداً).
- ✅ 0 خطأ في قيم الـenum (19 تأكيداً على القيم النصّية الحرفية).
- ✅ 0 عمود معرّف في `types/database.ts` وغائب عن الحيّة (الاتجاه الخطِر نظيف).
- ✅ كل جداول الـmigrations مطبّقة في الحيّة (لا migration غير مطبّق).

---

## 5) القيود

1. **PostgREST** يعكس عقد الـAPI لمخطط `public` (وهو بالضبط ما يستخدمه التطبيق)، لكنه **لا يعرض دوال الـtriggers ولا سياسات RLS ولا القيود (constraints)**. لذلك لم يُتحقّق مباشرةً من وجود دوال الـtriggers (تتطلب اتصال DB مباشر بكلمة مرور — غير متوفرة). الخطر منخفض لأن كل الكائنات التي يستدعيها التطبيق مؤكَّدة.
2. يُفترض أن **ذاكرة مخطط PostgREST محدّثة** (سلوك قياسي بعد تطبيق migrations).
3. 22 استدعاء `.from(variable)` ديناميكي (ثوابت مستوردة من ملف آخر) لم تُفحص بعينها، لكن جداولها كلها مُغطّاة عبر ملفات أخرى.

---

## 6) خطوات مقترحة (بالأولوية)

1. **(عالٍ)** إصلاح `lib/operators/portal-queries.ts` السطرين 73 و98 + الواجهتين — لإعادة تشغيل ميزة حجوزات المُشغّل.
2. **(متوسط)** البتّ في الجداول الستة اليتيمة: migration رسمي أو إسقاط.
3. **(منخفض)** إعادة توليد `types/database.ts` وتقليص سطح `loose` لاستعادة فحص وقت البناء.
