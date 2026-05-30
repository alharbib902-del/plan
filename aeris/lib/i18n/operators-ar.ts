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
  // Phase 8 PR 2c Codex round 4 P2 fix: notification-alert
  // banner surfaced on the operators list page when the
  // singleton operator_notification_alert_status row is
  // not 'healthy'.
  alertBanner: {
    config_missing:
      'إعدادات إرسال البريد ناقصة (RESEND_API_KEY / RESEND_FROM_EMAIL). لن يتلقى المشغّلون رسائل الترحيب أو إعادة تعيين كلمة المرور حتى يتم ضبطها.',
    send_failed:
      'فشل إرسال آخر بريد إلى مشغّل. تحقّق من سجلّات Resend وأعد المحاولة.',
    lastFailureLabel: 'آخر فشل:',
    // Phase 8.1 — wasender WhatsApp channel banners. Stack
    // independently below the email banner; both can fire at
    // the same time (e.g. trial expired + Resend outage).
    whatsapp: {
      config_missing:
        'إعدادات WhatsApp ناقصة (WASENDER_API_KEY). لن تصل رسائل الترحيب أو إعادة تعيين كلمة المرور عبر WhatsApp حتى يتم ضبطها.',
      send_failed:
        'فشل إرسال آخر رسالة WhatsApp عبر wasenderapi.com. تحقّق من حالة الجلسة + الترخيص وأعد المحاولة.',
      rate_limited:
        'تم تجاوز حدّ wasender المؤقّت (رسالة واحدة/دقيقة في الـ trial). إعادة المحاولة تلقائية بعد دقيقة من آخر إرسال.',
    },
  },
  adminDetailTitle: 'تفاصيل المشغّل',
  adminDocumentsTitle: 'وثائق المشغّل',
  adminConvertTitle: 'تحويل سجلّ مشغّل Phase 7',

  // ------------------------------------------------------------
  // Phase 8 PR 2e — admin canary readout
  // ------------------------------------------------------------
  canary: {
    title: 'لوحة الصحّة التشغيلية للمشغّلين',
    subtitle:
      'مؤشّرات سريعة لحالة Phase 8: حركة التسجيل، صحّة الإشعارات، عدّاد محاولات التسجيل، وحالة مهام التنظيف الدورية.',
    backLink: 'العودة لقائمة المشغّلين',
    navLabel: 'لوحة الصحّة',

    // Velocity card
    velocityTitle: 'حركة التسجيل + توزيع الحالات',
    signupsLast24h: 'تسجيلات آخر 24 ساعة',
    signupsLast7d: 'تسجيلات آخر 7 أيام',

    // Notification health
    notificationsTitle: 'صحّة قنوات الإشعار',
    notificationsUnknown:
      'تعذّر قراءة سجلّ حالة الإشعارات. تحقّق من اتصال قاعدة البيانات.',
    emailChannel: 'البريد (Resend)',
    whatsappChannel: 'واتساب (wasender)',
    statusLabels: {
      healthy: 'سليم',
      config_missing: 'إعدادات ناقصة',
      send_failed: 'فشل الإرسال',
      rate_limited: 'مُقيَّد بالحدّ',
    } as Record<string, string>,
    lastFailureLabel: 'آخر فشل:',
    atLabel: 'في:',

    // Attempt mix
    attemptMixTitle: 'محاولات التسجيل (آخر 24 ساعة)',
    attemptMixSubtitle: 'إجمالي المحاولات في النافذة: {total}',
    attemptSuccess: 'ناجحة',
    attemptDuplicate: 'بريد مكرَّر',
    attemptRateLimited: 'مُقيَّدة بحدّ المعدّل',
    attemptValidationFailed: 'فشل التحقق',

    // Cron health
    cronTitle: 'حالة مهام التنظيف الدورية',
    cronSubtitle:
      'كلّ مهمّة تكتب صفّاً في operator_cron_tick_history بعد كلّ تشغيل. الحالة "متأخّرة" إن مرّ وقت أطول من ضعف الفاصل المتوقَّع.',
    cronJobLabel: 'المهمّة',
    cronLastRunLabel: 'آخر تشغيل',
    cronDeletedCountLabel: 'صفوف محذوفة',
    cronStatusLabel: 'الحالة',
    cronStatusHealthy: 'سليمة',
    cronStatusStale: 'متأخّرة',
    cronStatusError: 'فشل',
    cronStatusUnknown: 'لم تُشغَّل بعد',
    cronNeverRan: 'لم تُشغَّل بعد',

    // Relative time formatting. The page formatter
    // assembles "<prefix> <N> <unit>", e.g. "منذ 5 دقيقة".
    justNow: 'الآن',
    relativePrefix: 'منذ',
    minutesUnit: 'دقيقة',
    hoursUnit: 'ساعة',
    daysUnit: 'يوم',
  },

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

  // ============================================================
  // Phase 8 PR 2c — operator portal strings
  // ============================================================
  portal: {
    nav: {
      dashboard: 'لوحة التحكم',
      legs: 'الرحلات الفارغة',
      fleet: 'أسطولي',
      bookings: 'الحجوزات',
      profile: 'الملف الشخصي',
      earnings: 'الأرباح',
      logout: 'تسجيل الخروج',
    },
    signup: {
      title: 'إنشاء حساب مشغّل جديد',
      subtitle: 'أكمل البيانات أدناه ليُراجع طلبك فريق Aeris.',
      labels: {
        email: 'البريد الإلكتروني للدخول',
        password: 'كلمة المرور',
        company_name: 'اسم الشركة',
        contact_email: 'بريد التواصل التشغيلي',
        contact_phone: 'رقم الجوّال',
        notes: 'ملاحظات (اختياري)',
      },
      passwordHint: '10 أحرف على الأقل، تحتوي حروفاً وأرقاماً.',
      contactEmailHint: 'يمكن أن يختلف عن بريد الدخول.',
      submit: 'إنشاء الحساب',
      pendingMessage: 'تمّ استلام طلبك. سنُراسلك على البريد فور قبول الحساب.',
      rateLimitedHeading: 'وصلت إلى الحدّ اليومي',
      rateLimitedBody: 'تمّ استلام عدة طلبات تسجيل من شبكتك خلال آخر 24 ساعة. حاول مرة أخرى لاحقاً.',
    },
    login: {
      title: 'تسجيل دخول المشغّل',
      labels: {
        email: 'البريد الإلكتروني',
        password: 'كلمة المرور',
        rememberMe: 'تذكّرني (30 يوماً)',
      },
      submit: 'تسجيل الدخول',
      forgotPassword: 'نسيت كلمة المرور؟',
      otpFallback: 'تسجيل الدخول برمز WhatsApp',
      signupCta: 'مشغّل جديد؟ سجّل الآن',
    },
    otp: {
      title: 'تسجيل الدخول برمز WhatsApp',
      subtitle: 'أدخل البريد الإلكتروني والرمز المؤقّت الذي أرسلته الإدارة عبر WhatsApp.',
      labels: {
        email: 'البريد الإلكتروني للحساب',
        code: 'الرمز المؤقّت (6 أرقام)',
      },
      submit: 'دخول',
    },
    forgotPassword: {
      title: 'استعادة كلمة المرور',
      subtitle: 'اكتب بريد الحساب وسنُرسل رابط إعادة التعيين خلال دقائق.',
      label: 'البريد الإلكتروني',
      submit: 'إرسال رابط الاستعادة',
      successMessage: 'إذا كان البريد مسجّلاً لدينا، ستجد رابط الاستعادة في صندوق الوارد خلال دقائق.',
    },
    resetPassword: {
      title: 'تعيين كلمة مرور جديدة',
      labels: {
        new_password: 'كلمة المرور الجديدة',
        confirm_password: 'تأكيد كلمة المرور',
      },
      submit: 'حفظ كلمة المرور',
      successMessage: 'تمّ تحديث كلمة المرور. يمكنك تسجيل الدخول الآن.',
    },
    welcome: {
      title: 'تفعيل حسابك',
      subtitle: 'جارٍ التحقق من رابط الترحيب وتسجيل الدخول التلقائي…',
      successMessage: 'مرحباً بك في Aeris. سيُحوَّل المتصفح إلى لوحة التحكم.',
    },
    dashboard: {
      title: 'لوحة التحكم',
      welcomeLine: (name: string) => `أهلاً بك، ${name}`,
      cards: {
        activeLegs: 'رحلات معروضة',
        reservedLegs: 'رحلات محجوزة',
        soldLegs: 'رحلات مباعة',
      },
      empty: 'لا توجد رحلات معروضة بعد. اضغط "إضافة رحلة فارغة" لتبدأ.',
      addLeg: 'إضافة رحلة فارغة',
    },
    bookings: {
      title: 'الحجوزات',
      empty: 'لا توجد حجوزات حالياً.',
    },
    profile: {
      title: 'الملف الشخصي',
      sectionBasic: 'البيانات الأساسية',
      sectionAuth: 'الدخول والأمان',
      sectionDocuments: 'الوثائق التنظيمية',
      labels: {
        company_name: 'اسم الشركة',
        contact_email: 'بريد التواصل التشغيلي',
        contact_phone: 'رقم الجوّال',
        auth_email: 'بريد الدخول (ثابت)',
      },
      authEmailHint: 'لا يمكن تعديل بريد الدخول من هنا. تواصل مع الإدارة عند الحاجة.',
      submit: 'حفظ التعديلات',
      updateSuccess: 'تمّ حفظ التعديلات.',
      passwordCta: 'تغيير كلمة المرور',
      documentsCta: 'عرض الوثائق المرفوعة',
    },
    password: {
      title: 'تغيير كلمة المرور',
      labels: {
        current_password: 'كلمة المرور الحالية',
        new_password: 'كلمة المرور الجديدة',
        confirm_password: 'تأكيد كلمة المرور الجديدة',
      },
      mustChangeNotice: 'لتفعيل حسابك بشكل كامل، اختر كلمة مرور دائمة الآن.',
      submit: 'تحديث كلمة المرور',
      successMessage: 'تمّ تحديث كلمة المرور. سيتم استخدامها في الدخول التالي.',
    },
    documents: {
      title: 'الوثائق التنظيمية',
      empty: 'لم تُرفع وثائق بعد. تواصل مع الإدارة لرفع السجل التجاري ورخصة الطيران.',
      view: 'عرض',
    },
    earnings: {
      title: 'الأرباح',
      placeholder: 'قريباً — يتم حالياً ربط نظام المدفوعات والفوترة بالمشغّلين.',
    },
    fleet: {
      title: 'إدارة الأسطول',
      subtitle:
        'أضف طائراتك وحدّث بياناتها. الطائرة المتقاعدة تبقى في السجلّ ولا تُحذف.',
      empty: 'لا توجد طائرات مسجّلة بعد. أضف أول طائرة لتبدأ.',
      addAircraft: 'إضافة طائرة',
      addTitle: 'طائرة جديدة',
      editTitle: 'تعديل الطائرة',
      cancel: 'إلغاء',
      save: 'حفظ',
      saving: 'جارٍ الحفظ...',
      edit: 'تعديل',
      retire: 'تقاعد',
      retireConfirm: 'تأكيد التقاعد؟',
      retiring: 'جارٍ...',
      createdSuccess: 'تمت إضافة الطائرة.',
      updatedSuccess: 'تم تحديث بيانات الطائرة.',
      retiredSuccess: 'تم تقاعد الطائرة.',
      registrationImmutableHint: 'لا يمكن تغيير رقم التسجيل بعد الإضافة.',
      labels: {
        registration: 'رقم التسجيل',
        manufacturer: 'الصانع',
        model: 'الموديل',
        category: 'الفئة',
        year: 'سنة الصنع (اختياري)',
        max_passengers: 'أقصى عدد ركّاب',
        max_range_km: 'أقصى مدى (كم، اختياري)',
        base_hourly_rate: 'السعر بالساعة (ريال)',
        is_cargo_capable: 'مؤهّلة للشحن',
        is_medevac_capable: 'مؤهّلة للإخلاء الطبي',
        status: 'الحالة التشغيلية',
      },
      categories: {
        light: 'خفيفة',
        mid: 'متوسطة',
        super_mid: 'متوسطة كبيرة',
        heavy: 'ثقيلة',
        long_range: 'بعيدة المدى',
      },
      statuses: {
        active: 'نشطة',
        maintenance: 'صيانة',
        retired: 'متقاعدة',
      },
      col: {
        registration: 'التسجيل',
        model: 'الطراز',
        category: 'الفئة',
        pax: 'الركّاب',
        rate: 'السعر/ساعة',
        capabilities: 'القدرات',
        status: 'الحالة',
        actions: 'إجراءات',
      },
      capCargo: 'شحن',
      capMedevac: 'إخلاء طبي',
      capNone: '—',
    },
    errors: {
      invalid_credentials: 'البريد أو كلمة المرور غير صحيحة.',
      signup_pending: 'حسابك لا يزال قيد المراجعة. سنُراسلك فور القبول.',
      signup_rejected: 'تمّ رفض حسابك. تواصل مع الإدارة لمعرفة التفاصيل.',
      account_suspended: 'الحساب موقوف حالياً. تواصل مع الإدارة لإعادة التفعيل.',
      account_not_approved: 'الحساب غير مفعّل. تواصل مع الإدارة.',
      session_expired: 'انتهت الجلسة. سجّل الدخول مرة أخرى.',
      must_change_password_first:
        'يجب اختيار كلمة مرور دائمة قبل إجراء أي تعديل آخر.',
      passwords_mismatch: 'كلمتا المرور غير متطابقتين.',
      current_password_wrong: 'كلمة المرور الحالية غير صحيحة.',
      token_not_found: 'الرابط غير صحيح أو منتهي الصلاحية.',
      token_already_used: 'تمّ استخدام هذا الرابط مسبقاً.',
      token_expired: 'انتهت صلاحية الرابط. اطلب رابطاً جديداً.',
      welcome_already_used: 'تمّ استخدام رابط الترحيب مسبقاً. سجّل الدخول مباشرة.',
      welcome_expired: 'انتهت صلاحية رابط الترحيب. تواصل مع الإدارة.',
      otp_no_active: 'لا يوجد رمز نشط. اطلب رمزاً جديداً من الإدارة.',
      otp_mismatch: 'الرمز غير صحيح.',
      otp_expired: 'انتهت صلاحية الرمز. اطلب رمزاً جديداً.',
      otp_locked: 'تمّ قفل الرمز بسبب عدد المحاولات. اطلب رمزاً جديداً من الإدارة.',
      ip_required: 'تعذّر تحديد عنوان IP. حاول من اتصال آخر.',
      email_invalid: 'البريد غير صالح.',
      email_in_use: 'البريد مسجّل مسبقاً. سجّل دخولك أو اطلب استعادة كلمة المرور.',
      rate_limited: 'وصلت إلى الحدّ اليومي. حاول مرة أخرى لاحقاً.',
      password_hash_malformed: 'كلمة المرور لا تستوفي الصياغة المطلوبة.',
      company_name_invalid: 'اسم الشركة غير صالح.',
      contact_email_invalid: 'بريد التواصل غير صالح.',
      contact_phone_invalid: 'رقم الجوّال غير صالح.',
      validation_failed: 'يرجى مراجعة الحقول وتصحيح الأخطاء.',
      server_error: 'حدث خطأ في الخادم. حاول مرة أخرى لاحقاً.',
      registration_invalid: 'رقم التسجيل مطلوب (حتى 20 خانة).',
      registration_taken: 'رقم التسجيل مستخدم مسبقاً لطائرة أخرى.',
      manufacturer_required: 'الصانع مطلوب.',
      model_required: 'الموديل مطلوب.',
      category_invalid: 'الفئة غير صالحة.',
      max_passengers_invalid: 'عدد الركّاب يجب أن يكون رقماً أكبر من صفر.',
      base_hourly_rate_invalid: 'السعر بالساعة يجب أن يكون أكبر من صفر.',
      year_invalid: 'سنة الصنع غير صالحة.',
      max_range_invalid: 'المدى الأقصى غير صالح.',
      status_invalid: 'الحالة غير صالحة.',
      invalid_number_format: 'صيغة رقمية غير صالحة في أحد الحقول.',
      not_found_or_not_owned: 'الطائرة غير موجودة أو لا تخصّ حسابك.',
      unknown: 'حدث خطأ غير متوقّع. حاول مرة أخرى أو راجع السجلّ.',
    },
  },
} as const;
