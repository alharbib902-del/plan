# ✅ اليوم الأول — قائمة المهام

## 🎯 الهدف: جاهزية كاملة للانطلاق في اليوم 2

---

## 🕐 الجدول الزمني المقترح لليوم 1

### 🌅 الصباح (8:00 - 12:30) — البنية التحتية

#### ⏰ 8:00 - 9:00 — تسجيل الحسابات (1 ساعة)
- [ ] **GitHub** — https://github.com (إن لم يكن موجود)
  - إنشاء repository جديد باسم `aeris` (private)
- [ ] **Vercel** — https://vercel.com/signup
  - Sign up with GitHub
- [ ] **Supabase** — https://supabase.com
  - إنشاء مشروع جديد
  - احفظ: Project URL + anon key + service_role key
  - المنطقة: **Frankfurt** أو **Singapore** (الأقرب للسعودية)
  - كلمة مرور قاعدة البيانات: **احفظها في مكان آمن**
- [ ] **Resend** — https://resend.com
  - اشتراك Pro ($20/شهر) للبريد
- [ ] **Unifonic** — https://unifonic.com
  - حساب للـ SMS (للتحقق من OTP)
- [ ] **Sentry** — https://sentry.io
  - مشروع Next.js جديد

#### ⏰ 9:00 - 10:00 — شراء الدومين والمتطلبات القانونية
- [ ] شراء **aeris.sa** من [saudinic.sa](https://saudinic.sa)
  - تكلفة: ~200 ريال/سنة
  - قد يستغرق 24-48 ساعة للتفعيل
- [ ] تسجيل الشركة (إن لم يكن مكتمل):
  - السجل التجاري عبر [absher.sa](https://absher.sa)
  - شهادة VAT من [zatca.gov.sa](https://zatca.gov.sa)
- [ ] بدء طلب **HyperPay**:
  - https://hyperpay.com/apply
  - يحتاج السجل التجاري + شهادة VAT
  - قد يستغرق 5-10 أيام عمل

#### ⏰ 10:00 - 12:30 — تركيب البيئة التقنية
- [ ] تثبيت Node.js 20+ من [nodejs.org](https://nodejs.org)
- [ ] التحقق: `node --version` و `npm --version`
- [ ] تثبيت VS Code (أو IDE المفضل)
- [ ] Git config:
  ```bash
  git config --global user.name "Your Name"
  git config --global user.email "your@email.com"
  ```

---

### 🍽️ الظهر (12:30 - 13:30) — استراحة غداء وصلاة

---

### ☀️ العصر (13:30 - 17:00) — المشروع الفعلي

#### ⏰ 13:30 - 14:30 — تهيئة المشروع
- [ ] Navigate to project:
  ```bash
  cd D:/Plan/aeris
  ```
- [ ] تثبيت Dependencies:
  ```bash
  npm install
  ```
- [ ] **ملاحظة:** قد تظهر أخطاء لو لم يكن `tailwindcss-rtl` متوفر — جرب:
  ```bash
  npm install --save-dev tailwindcss-rtl
  ```

#### ⏰ 14:30 - 15:30 — إعداد Supabase
- [ ] افتح Supabase Dashboard
- [ ] اذهب لـ **SQL Editor**
- [ ] افتح ملف `supabase/migrations/20260422000001_initial_schema.sql`
- [ ] انسخ المحتوى كاملاً
- [ ] الصق في SQL Editor
- [ ] اضغط **Run**
- [ ] تحقق من نجاح التنفيذ — يجب أن ترى 19 جدول في Table Editor

#### ⏰ 15:30 - 16:30 — ربط البيئة
- [ ] انسخ `.env.example` إلى `.env.local`
- [ ] املأ المتغيرات:
  - `NEXT_PUBLIC_SUPABASE_URL` (من Supabase dashboard)
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `RESEND_API_KEY`
  - `NEXT_PUBLIC_WHATSAPP_NUMBER=966558048004`
  - باقي المفاتيح لاحقاً
- [ ] تشغيل الخادم:
  ```bash
  npm run dev
  ```
- [ ] افتح http://localhost:3000
- [ ] **يجب أن ترى صفحة Aeris الأولى** 🎉

#### ⏰ 16:30 - 17:00 — ربط Git و Vercel
- [ ] Initialize git:
  ```bash
  git init
  git add .
  git commit -m "Initial commit: Aeris MVP foundation"
  ```
- [ ] إنشاء repo على GitHub
- [ ] Push:
  ```bash
  git remote add origin https://github.com/YOUR_USERNAME/aeris.git
  git branch -M main
  git push -u origin main
  ```
- [ ] في Vercel:
  - Import GitHub repository
  - أضف environment variables من `.env.local`
  - Deploy

---

### 🌃 المساء (17:00 - 23:00) — البناء الفعلي يبدأ

#### ⏰ 17:00 - 20:00 — مع Claude Code (3 ساعات)
- [ ] افتح Claude Code في المشروع
- [ ] تحقق من قراءة CLAUDE.md
- [ ] جرب أوامر Claude Code:
  ```
  "اقرأ CLAUDE.md وأعطني ملخص عن المشروع"
  "تحقق من أن كل الملفات صحيحة"
  "ما التالي في اليوم 2؟"
  ```

#### ⏰ 20:00 - 21:00 — عشاء

#### ⏰ 21:00 - 23:00 — Business Development
- [ ] ابحث عن معلومات اتصال 5 مشغلين:
  - NasJet
  - Sky Prime
  - SaudiGulf Private
  - Al Jaber Aviation
  - Royal Jet
- [ ] أعد رسالة WhatsApp تعريفية
- [ ] أرسل لأول 2-3 مشغلين (إن أمكن)

---

## 📊 نهاية اليوم 1 — الإنجازات المتوقعة

### ✅ كل هذا يجب أن يكون جاهزاً:
1. **حسابات جاهزة:** GitHub, Vercel, Supabase, Resend, Unifonic, Sentry
2. **دومين مسجل:** aeris.sa (قد يكون قيد التفعيل)
3. **HyperPay طلب مرسل:** في الانتظار
4. **مشروع Next.js شغال:** على localhost
5. **قاعدة بيانات كاملة:** 19 جدول + seed data + RLS
6. **الموقع مرفوع على Vercel:** على `aeris.vercel.app`
7. **Claude Code يعمل:** مع CLAUDE.md محدث
8. **3-5 مشغلين مُتواصل معهم:** (bonus)

### 🎯 الشعور المتوقع:
- إنجاز كبير — أنت بنيت **أسس منصة كاملة** في يوم واحد
- قد يكون هناك تعب — هذا طبيعي
- **لا تنم متأخراً!** تحتاج 6+ ساعات نوم

---

## ⚠️ مشاكل محتملة وحلولها

| المشكلة | الحل |
|---|---|
| `npm install` يفشل | احذف `node_modules` و `package-lock.json` وأعد المحاولة |
| Supabase migration يفشل | شغل الملف على أجزاء (ENUM أولاً، ثم جدول جدول) |
| Vercel deploy يفشل | تأكد من إضافة **كل** environment variables |
| Dominant colors غير صحيحة | تأكد من تثبيت `tailwindcss-rtl` plugin |
| RTL لا يعمل | تحقق من `<html dir="rtl">` في `app/layout.tsx` |

---

## 📞 إن احتجت مساعدة

1. **Claude Code:** اسأل مباشرة — هو يعرف المشروع
2. **Supabase Discord:** https://discord.supabase.com
3. **Vercel Discord:** https://vercel.com/discord
4. **Next.js Discord:** https://nextjs.org/discord

---

## 🌙 قبل النوم

- [ ] استعرض ما أنجزت اليوم — فخور بنفسك!
- [ ] راجع قائمة اليوم 2 في `CLAUDE.md`
- [ ] ضع الجوال جانباً
- [ ] نم جيداً — غداً يوم طويل آخر 💪

---

**بالتوفيق! أنت بدأت رحلة الـ 60 يوم الأعظم. 🚀✈️**
