/**
 * Phase 8 — Arabic-RTL strings for the operator portal +
 * admin operator surfaces.
 *
 * Mirrors the Phase 7 `empty-legs-ar.ts` discipline: every
 * user-visible Arabic string lives in one module so the
 * UI surface can be reviewed in isolation, and a future
 * language switch is a single file edit.
 */

export const operatorsAr = {
  // ------------------------------------------------------------
  // Status labels (signup_status enum)
  // ------------------------------------------------------------
  status: {
    pending: 'بانتظار المراجعة',
    approved: 'مفعّل',
    suspended: 'موقوف',
    rejected: 'مرفوض',
  },

  // ------------------------------------------------------------
  // Admin nav + page titles
  // ------------------------------------------------------------
  adminNav: 'المشغّلون',
  adminListTitle: 'سجلّ المشغّلين',
  adminListEmpty: 'لا يوجد مشغّلون مسجّلون بعد.',
  adminListEmptyForFilter: 'لا يوجد مشغّلون في هذه الفئة.',
  adminDetailTitle: 'تفاصيل المشغّل',
  adminDocumentsTitle: 'وثائق المشغّل',
  adminConvertTitle: 'تحويل سجلّ مشغّل Phase 7',

  // ------------------------------------------------------------
  // List filter chips
  // ------------------------------------------------------------
  filters: {
    all: 'الكل',
    pending: 'بانتظار المراجعة',
    approved: 'مفعّل',
    suspended: 'موقوف',
    rejected: 'مرفوض',
  },

  // ------------------------------------------------------------
  // Operator row + detail
  // ------------------------------------------------------------
  fields: {
    company_name: 'اسم الشركة',
    contact_email: 'البريد التشغيلي',
    contact_phone: 'الجوّال',
    auth_email: 'بريد تسجيل الدخول',
    signup_status: 'الحالة',
    created_at: 'تاريخ التسجيل',
    approved_at: 'تاريخ القبول',
    rejected_at: 'تاريخ الرفض',
    rejection_reason: 'سبب الرفض',
    suspended_at: 'تاريخ الإيقاف',
    suspension_reason: 'سبب الإيقاف',
    last_login_at: 'آخر دخول',
    commercial_registration: 'السجل التجاري',
    gaca_license: 'رخصة الطيران المدني',
    license_expiry: 'تاريخ انتهاء الرخصة',
  },

  // ------------------------------------------------------------
  // Action buttons (approve / reject / suspend / etc.)
  // ------------------------------------------------------------
  actions: {
    approve: 'قبول الطلب',
    reject: 'رفض الطلب',
    suspend: 'إيقاف الحساب',
    unsuspend: 'إعادة التفعيل',
    resetPassword: 'إعادة تعيين كلمة المرور',
    mintOtp: 'إنشاء رمز WhatsApp مؤقّت',
    setDocuments: 'تحديث الوثائق التنظيمية',
    uploadDocument: 'رفع وثيقة',
    convertStub: 'تحويل سجلّ المشغّل',
    confirm: 'تأكيد',
    cancel: 'إلغاء',
    save: 'حفظ',
  },

  // ------------------------------------------------------------
  // Form labels + placeholders
  // ------------------------------------------------------------
  forms: {
    rejectReasonLabel: 'سبب الرفض',
    rejectReasonPlaceholder: 'وضّح للمشغّل سبب الرفض (يُعرض في رسالة البريد).',
    suspendReasonLabel: 'سبب الإيقاف',
    suspendReasonPlaceholder: 'وضّح سبب الإيقاف (يُحفظ داخلياً ولا يُعرض للمشغّل تلقائياً).',
    newPasswordLabel: 'كلمة المرور الجديدة',
    newPasswordPlaceholder: '10 أحرف على الأقل، تحتوي حروفاً وأرقاماً',
    otpDestinationLabel: 'سيُرسَل الرمز عبر WhatsApp يدوياً من الإدارة',
    documentTypeLabel: 'نوع الوثيقة',
    documentFileLabel: 'الملف (PDF أو صورة)',
    documentTypes: {
      commercial_registration: 'السجل التجاري',
      gaca_license: 'رخصة الطيران المدني',
      license_expiry_proof: 'إثبات تاريخ انتهاء الرخصة',
    },
    targetOperatorLabel: 'المشغّل الهدف',
    targetOperatorPlaceholder: 'اختر مشغّلاً معتمداً لتحويل الرحلات إليه',
    legsToReassignLabel: 'الرحلات المرتبطة',
  },

  // ------------------------------------------------------------
  // Success + error toasts (Server Action results)
  // ------------------------------------------------------------
  toasts: {
    approved: 'تم قبول المشغّل وإرسال رابط الترحيب على البريد.',
    approvedEmailFailed:
      'تم قبول المشغّل لكن فشل إرسال بريد الترحيب. انسخ الرابط أدناه وأرسله يدوياً عبر WhatsApp:',
    rejected: 'تم رفض الطلب.',
    suspended: 'تم إيقاف الحساب وإلغاء جميع الجلسات النشطة.',
    unsuspended: 'تم إعادة تفعيل الحساب. سيحتاج المشغّل لتسجيل الدخول مجدداً.',
    documentsUpdated: 'تم تحديث الوثائق التنظيمية.',
    documentUploaded: 'تم رفع الوثيقة.',
    passwordReset: 'تم تحديث كلمة المرور وإلغاء الجلسات النشطة. وصل البريد الإلكتروني للمشغّل.',
    passwordResetEmailFailed:
      'تم تحديث كلمة المرور وإلغاء الجلسات لكن فشل إرسال البريد. انسخ كلمة المرور المؤقّتة أدناه وأرسلها يدوياً عبر WhatsApp:',
    otpMinted: 'تم إنشاء الرمز. أرسله للمشغّل عبر WhatsApp.',
    stubConverted: 'تم تحويل سجلّ المشغّل وإعادة ربط الرحلات.',
  },

  // ------------------------------------------------------------
  // Server-side error codes -> Arabic messages
  // ------------------------------------------------------------
  errors: {
    operator_not_found: 'لم يُعثر على المشغّل.',
    not_pending: 'الحالة الحالية لا تسمح بهذا الإجراء (يجب أن يكون في انتظار المراجعة).',
    not_approved: 'الحالة الحالية لا تسمح بالإيقاف (يجب أن يكون مفعّلاً).',
    not_suspended: 'الحالة الحالية لا تسمح بإعادة التفعيل (يجب أن يكون موقوفاً).',
    not_resettable: 'لا يمكن تعيين كلمة المرور في الحالة الحالية.',
    not_writable: 'لا يمكن تعديل الوثائق في الحالة الحالية.',
    not_otp_eligible: 'لا يمكن إنشاء رمز للمشغّل في الحالة الحالية.',
    reason_required: 'السبب مطلوب.',
    welcome_token_hash_invalid: 'تعذّر إنشاء رابط الترحيب — حدث خطأ داخلي.',
    welcome_token_expires_at_invalid: 'تعذّر إنشاء رابط الترحيب — حدث خطأ داخلي.',
    invalid_purpose: 'نوع الرمز غير صحيح.',
    code_hash_invalid: 'تعذّر إنشاء الرمز — حدث خطأ داخلي.',
    expires_at_invalid: 'انتهاء الصلاحية غير صحيح — حدث خطأ داخلي.',
    password_hash_malformed: 'كلمة المرور لا تستوفي الصياغة المطلوبة.',
    stub_not_found: 'لم يُعثر على سجلّ المشغّل المراد تحويله.',
    stub_already_archived: 'سجلّ المشغّل تمّ تحويله مسبقاً.',
    operator_not_writable: 'لا يمكن استلام التحويل في حالة المشغّل الحالية.',
    upload_failed: 'فشل رفع الملف. حاول مرة أخرى.',
    unknown: 'حدث خطأ غير متوقّع. حاول مرة أخرى أو راجع السجلّ.',
  },

  // ------------------------------------------------------------
  // Stub conversion preview
  // ------------------------------------------------------------
  conversion: {
    legsCount: (n: number) => `${n} رحلة سيُعاد ربطها بالمشغّل المختار.`,
    confirmPrompt:
      'سيتم نقل جميع الرحلات إلى المشغّل المختار وأرشفة سجلّ Phase 7. لا يمكن التراجع عن هذا الإجراء.',
    noLegs: 'لا توجد رحلات مرتبطة بهذا السجلّ.',
    // Stub-list discovery surface (Codex round 3 PR #41 P2 fix):
    // the Phase 7 stub list now exposes a "Convert" link per row
    // so admin can reach the Phase 8 convert page from the
    // approved-operator detail CTA AND from the stub list itself.
    rowConvertLink: 'تحويل إلى مشغّل',
    convertModeBanner: (operatorName: string) =>
      `اختر سجلّ Phase 7 لتحويل رحلاته إلى المشغّل: ${operatorName}.`,
    convertModeBannerNoName:
      'اختر سجلّ Phase 7 لتحويل رحلاته إلى المشغّل المحدّد في الرابط.',
  },
} as const;
