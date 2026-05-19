/**
 * Phase 13 PR 1 — Arabic strings for Aeris Privilege.
 * RTL-first. All client-visible copy + admin labels.
 */

import type { ClientPrivilegeTier, LoyaltyLedgerEventType, PrivilegeTierChangeReason } from '@/lib/privilege/types';

export const privilegeAr = {
  // Brand
  programName: 'Aeris Privilege',
  programSubtitle: 'برنامج ولاء أنيق لعملاء Aeris',

  // Tier names
  tier: {
    silver: 'فضي',
    gold: 'ذهبي',
    platinum: 'بلاتيني',
    diamond: 'ماسي',
  } as Record<ClientPrivilegeTier, string>,

  // Admin nav
  adminNavPrivilege: 'الولاء',
  adminDetailTitle: 'تفاصيل مستوى العميل',
  adminForceTitle: 'تعديل المستوى يدوياً',

  // Detail page sections
  sectionCurrentTier: 'المستوى الحالي',
  sectionBalance: 'رصيد الاسترداد',
  sectionSpendWindow: 'الإنفاق المؤهَّل (آخر 12 شهر)',
  sectionLock: 'قفل المستوى',
  sectionGrace: 'فترة سماح الهبوط',
  sectionTwoFactor: 'المصادقة الثنائية',
  sectionRecentLedger: 'آخر معاملات الرصيد',
  sectionRecentChanges: 'آخر تغييرات المستوى',

  // Field labels
  fieldClient: 'العميل',
  fieldEmail: 'البريد الإلكتروني',
  fieldPhone: 'الهاتف',
  fieldAssignedAt: 'تاريخ الإسناد',
  fieldLockedUntil: 'القفل حتى',
  fieldBelowSince: 'بدأت الحاجة للهبوط',
  fieldNoLock: 'لا يوجد قفل',
  fieldNoGrace: 'لا يوجد سماح نشط',
  fieldEnabled: 'مفعّل',
  fieldDisabled: 'غير مفعّل',

  // Ledger event types
  ledgerEvent: {
    earn: 'استرداد مكتسب',
    redeem: 'استرداد مستخدم',
    adjust: 'تعديل إداري',
    expire: 'انتهاء صلاحية',
    refund_back: 'استرجاع بعد إلغاء',
    diamond_shield_granted: 'منح Shield ماسي مجاناً',
    diamond_shield_skipped_paying_paid_plan: 'تخطي Shield (يدفع بالفعل)',
    diamond_shield_revoked_on_downgrade: 'إلغاء Shield (هبوط)',
  } as Record<LoyaltyLedgerEventType, string>,

  // Tier change reasons
  changeReason: {
    signup_default: 'افتراضي عند التسجيل',
    auto_upgrade: 'ترقية تلقائية',
    auto_downgrade: 'هبوط تلقائي',
    admin_force: 'تعديل إداري',
    admin_lock_expired: 'انتهاء قفل إداري',
    data_correction: 'تصحيح بيانات',
  } as Record<PrivilegeTierChangeReason, string>,

  // Force form
  forceFormHeader: 'تعديل مستوى العميل',
  forceFormDescription:
    'استخدم هذا فقط لحسابات استراتيجية. كل تعديل يُسجَّل في audit_logs + privilege_tier_change_log.',
  fieldNewTier: 'المستوى الجديد',
  fieldReason: 'سبب التعديل (10-500 حرف)',
  fieldLockUntil: 'قفل حتى (اختياري، YYYY-MM-DD)',
  fieldLockUntilHelper:
    'إذا تم التعيين، يمنع الهبوط التلقائي حتى التاريخ المحدد.',
  submitForce: 'تطبيق التعديل',
  submitting: 'جارٍ التطبيق...',

  // Result messages
  forceSuccess: 'تم تطبيق التعديل ✓',
  forceNoOp: 'لا تغيير — العميل بالفعل في هذا المستوى',
  errorClientNotFound: 'العميل غير موجود',
  errorReasonTooShort: 'السبب يجب أن يكون 10 أحرف على الأقل',
  errorLockUntilPast: 'تاريخ القفل يجب أن يكون في المستقبل',
  errorSessionInvalid: 'انتهت جلسة الإدارة، أعد تسجيل الدخول',

  // Public /privilege marketing page
  publicTitle: 'برنامج Aeris Privilege',
  publicSubtitle: 'كلما طرت أكثر، حصلت على أكثر',

  // KPI labels
  kpiCashbackPct: 'نسبة الاسترداد',
  kpiAnnualSpend: 'الحد الأدنى السنوي',
  kpiEmptyLegsWindow: 'نافذة Empty Legs',

  // Notes
  noteIndependentSilver: 'يبدأ كل عميل من المستوى الفضي تلقائياً',
  noteUpgradeImmediate: 'الترقية فورية عند بلوغ الحد',
  noteDowngradeGrace: 'الهبوط بعد 90 يوماً من عدم الوصول للحد',
  noteCashbackExpiry: 'صلاحية الاسترداد 24 شهر',
} as const;
