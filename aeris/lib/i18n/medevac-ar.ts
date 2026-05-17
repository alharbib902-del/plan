/**
 * Phase 12 PR 1 — Arabic copy for the medevac surface.
 * Centralised so the i18n migration (future Phase) can swap
 * the source without rewriting components.
 */

export const medevacAr = {
  // Nav / page chrome
  navMedevac: 'الإخلاء الطبي',
  publicPageTitle: 'طلب رحلة إخلاء طبي',
  publicPageSubtitle:
    'لحالات النقل الطبي المستقر بين المدن أو إلى مرافق متخصصة. الحالات الحرجة أو المتوسطة تتطلب تسجيل حساب عميل أولاً.',
  publicSeverityLockNote:
    'هذا النموذج العام مخصص فقط للحالات المستقرة. للحالات الحرجة (وقت استجابة 1 ساعة) أو المتوسطة (4 ساعات) — رجاءً سجّل حساباً وادخل من بوابة العميل.',

  // Field labels
  patientName: 'اسم المريض',
  patientAge: 'عمر المريض (سنوات)',
  contactName: 'اسم جهة الاتصال',
  contactPhone: 'رقم الهاتف',
  contactEmail: 'البريد الإلكتروني (اختياري)',
  conditionSeverity: 'درجة الحالة',
  serviceLevel: 'مستوى الخدمة الطبية',
  fromLocation: 'مكان الانطلاق',
  fromIata: 'رمز مطار الانطلاق (IATA — اختياري)',
  toHospitalName: 'المستشفى المُستقبِل',
  toHospitalContactPhone: 'هاتف المستشفى (اختياري)',
  toHospitalAddress: 'عنوان المستشفى (اختياري)',
  toIata: 'رمز مطار الوصول (IATA — اختياري)',
  insuranceProvider: 'شركة التأمين (اختياري)',
  insuranceClaimRef: 'مرجع المطالبة (اختياري)',
  estimatedValue: 'القيمة التقديرية (ريال سعودي)',

  // Severity values
  severityStable: 'مستقر',
  severityModerate: 'متوسط',
  severityCritical: 'حرج',

  // Service level values
  serviceBmt: 'النقل الطبي الأساسي (BMT)',
  serviceAls: 'دعم الحياة المتقدم (ALS)',
  serviceCct: 'الرعاية الحرجة (CCT)',
  serviceRepat: 'الإعادة عبر الحدود',

  // Buttons + status
  submit: 'إرسال طلب الإخلاء الطبي',
  submitting: 'جاري الإرسال…',

  // Success / error states
  successHeading: 'تم استلام طلبك',
  successBody:
    'سيتم إشعار المشغلين الطبيين المعتمدين خلال 24 ساعة كحد أقصى. سنتواصل معك على الرقم المُسجَّل بمجرد توفر العروض.',
  successReferencePrefix: 'رقم الطلب:',

  errorGeneric: 'حدث خطأ غير متوقع. حاول مرة أخرى أو تواصل مع الدعم.',
  errorFlagDisabled: 'هذه الخدمة غير متاحة حالياً.',
  errorSeverityRequiresAccount:
    'الحالات الحرجة والمتوسطة تتطلب تسجيل حساب عميل (سجّل أولاً ثم أدخل من بوابة العميل).',
  errorIpRequired: 'تعذّر تحديد موقعك. تأكد من الاتصال وحاول مرة أخرى.',
  errorValidationFailed: 'بعض الحقول غير صحيحة. راجع الأخطاء أدناه.',
  errorServerError: 'حدث خطأ في الخادم. حاول لاحقاً.',

  // Admin queue
  adminQueueTitle: 'قائمة طلبات الإخلاء الطبي',
  adminQueueEmpty: 'لا توجد طلبات إخلاء طبي حالياً.',
  adminColMev: 'رقم الطلب',
  adminColSeverity: 'الحالة',
  adminColService: 'مستوى الخدمة',
  adminColRoute: 'المسار',
  adminColStatus: 'حالة الطلب',
  adminColValue: 'القيمة (ريال)',
  adminColCreated: 'تاريخ الإنشاء',
  adminViewDetail: 'تفاصيل',

  // Admin detail
  adminDetailTitle: 'تفاصيل طلب الإخلاء الطبي',
  adminDetailPiiNotice:
    'هذه الصفحة تعرض بيانات تعريفية للمريض. كل قراءة تُسجَّل في سجل المراجعة (admin_pii_read) مع بصمة جلستك.',
  adminDetailNotFound: 'لم يتم العثور على طلب الإخلاء الطبي.',

  // Cert matrix
  certMatrixTitle: 'مصفوفة شهادات الإخلاء الطبي للطائرات',
  certMatrixSubtitle:
    'إدارة الشهادات الطبية لكل طائرة. الطائرات بدون شهادة سارية لا تظهر في توزيع العروض.',
} as const;

export type MedevacAr = typeof medevacAr;
