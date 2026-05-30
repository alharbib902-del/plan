/**
 * Phase 14 — Arabic-RTL strings for the client referral program
 * (`/me/referrals` + signup field + nav). Per the i18n discipline,
 * all user-visible Arabic lives here (no inline Arabic in JSX).
 *
 * Reward amounts are NOT baked in here — the page interpolates the
 * env-configured value alongside `clientsAr.currencySAR`.
 */

export const referralsAr = {
  nav: 'الإحالات',
  metaTitle: 'برنامج الإحالات',
  heading: 'ادعُ أصدقاءك واكسبوا معاً',

  intro:
    'شارك كودك مع أصدقائك. عند إتمام أوّل حجز مدفوع لمن يسجّل بكودك، تحصل أنت وهو على رصيد استرداد (كاش باك) يُخصم من حجوزاتكما القادمة.',

  // Reward callout — the page prepends/append the formatted amount.
  rewardCalloutLabel: 'مكافأة كل طرف عند أوّل حجز مدفوع',

  // "How it works" steps.
  howHeading: 'كيف يعمل؟',
  step1: 'شارك كودك أو رابط دعوتك مع صديق.',
  step2: 'صديقك ينشئ حساباً جديداً ويُدخل الكود عند التسجيل.',
  step3: 'عند أوّل حجز مدفوع له، تُضاف المكافأة لرصيد كاش باك كلٍّ منكما تلقائياً.',

  // Code + share block.
  yourCodeLabel: 'كود الإحالة الخاص بك',
  copyCode: 'نسخ الكود',
  copyLink: 'نسخ رابط الدعوة',
  copied: 'تم النسخ ✓',
  shareHint: 'أرسل هذا الرابط لأصدقائك — يملأ الكود تلقائياً عند التسجيل.',
  codeUnavailable: 'تعذّر توليد كودك حالياً. حدّث الصفحة لاحقاً.',

  // Summary tiles.
  summaryEarned: 'إجمالي ما كسبته',
  summaryRewarded: 'إحالات مكتملة',
  summaryPending: 'بانتظار أوّل حجز',

  // My referrals table.
  listHeading: 'إحالاتي',
  listEmpty: 'لا توجد إحالات بعد. شارك كودك لتبدأ بالكسب.',
  colDate: 'تاريخ التسجيل',
  colStatus: 'الحالة',
  colReward: 'مكافأتك',
  statusSignedUp: 'بانتظار أوّل حجز',
  statusRewarded: 'تمت المكافأة',
  rewardedOn: 'بتاريخ',

  // Feature gate.
  unavailable: 'برنامج الإحالات غير متاح حالياً.',
} as const;
