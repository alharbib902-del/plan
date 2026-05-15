/**
 * Phase 11 — Arabic-RTL strings for the cargo surface.
 *
 * Mirrors clientsAr (Phase 9) + emptyLegsAr (Phase 7) discipline:
 * every user-visible Arabic string lives in one module so the
 * UI surface can be reviewed in isolation.
 *
 * PR 1 ships the public form + admin intake strings;
 * PR 2 will add authed portal + offer/booking strings;
 * PR 3 will add ops / canary / distribution strings.
 */

export const cargoAr = {
  // ------------------------------------------------------------
  // Brand + nav
  // ------------------------------------------------------------
  brand: 'AERIS',
  navCargo: 'شحن خاص',

  // Surfaced on the admin canary page (PR 3 — 6th ChannelHealth card)
  canaryCargoEmailChannel: 'بريد العملاء — شحن (Resend)',

  // ------------------------------------------------------------
  // Public /cargo page
  // ------------------------------------------------------------
  publicPageTitle: 'خدمة الشحن المتخصص',
  publicPageSubtitle:
    'شحن الخيول والسيارات الفاخرة والبضائع الثمينة بأمان ودقة عبر شبكة Aeris.',
  publicPageHeroCta: 'احجز شحنتك الآن',

  // Cargo type labels
  cargoTypeLabel: 'نوع الشحنة',
  cargoTypes: {
    horse: 'خيول',
    luxury_car: 'سيارات فاخرة',
    valuables: 'بضائع ثمينة',
    other: 'أخرى',
  } as Record<string, string>,
  cargoTypeDescriptions: {
    horse: 'خيول سباق + خيول عربية. يتطلب شهادات بيطرية + CITES + إسطبلات مخصصة.',
    luxury_car: 'سيارات فاخرة وكلاسيكية. يتطلب تخليص جمركي + تأمين عالي.',
    valuables: 'مجوهرات + فن + أعمال معارض + إلكترونيات فخمة.',
    other: 'بضائع متخصصة لا تنطبق على الفئات السابقة.',
  } as Record<string, string>,

  // Customer fields
  customerNameLabel: 'الاسم الكامل',
  customerPhoneLabel: 'رقم الهاتف',
  customerEmailLabel: 'البريد الإلكتروني (اختياري)',

  // Shared shipment fields
  originIataLabel: 'مطار الانطلاق (IATA)',
  originFreeformLabel: 'مكان الانطلاق (نص حر)',
  destinationIataLabel: 'مطار الوصول (IATA)',
  destinationFreeformLabel: 'مكان الوصول (نص حر)',
  pickupDateLabel: 'تاريخ الاستلام',
  deliveryDateTargetLabel: 'تاريخ التسليم المُقترح (اختياري)',
  flexibilityDaysLabel: 'مرونة بالأيام (0-7)',
  estimatedValueLabel: 'القيمة التقديرية للشحنة (ريال)',
  insuranceRequiredLabel: 'أحتاج تأمين شامل',
  handlingNotesLabel: 'ملاحظات إضافية حول المناولة',

  // Horse-specific fields
  horseCountLabel: 'عدد الخيول',
  horseGroomRequiredLabel: 'أحتاج مرافقة سائس',
  horseCitesStatusLabel: 'حالة شهادات CITES',
  horseCitesStatusOptions: {
    ready: 'جاهزة',
    in_progress: 'قيد التحضير',
    help_needed: 'أحتاج مساعدة في الإجراءات',
  } as Record<string, string>,
  horseStallRequirementsLabel: 'متطلبات الإسطبلات',

  // Luxury car-specific fields
  carMakeLabel: 'الشركة المصنّعة',
  carModelLabel: 'الموديل',
  carYearLabel: 'سنة الصنع',
  carRunningConditionLabel: 'السيارة في حالة تشغيل',
  carEnclosedRequiredLabel: 'أحتاج حاوية مغلقة',

  // Valuables-specific fields
  valuablesDeclaredValueLabel: 'القيمة المُصرَّح بها (ريال)',
  valuablesSecurityLevelLabel: 'مستوى الأمان المطلوب',
  valuablesSecurityLevelOptions: {
    standard: 'عادي',
    high: 'عالي',
    armed_escort: 'مع مرافقة مسلحة',
  } as Record<string, string>,
  valuablesClimateControlledLabel: 'أحتاج تحكم بدرجة الحرارة',
  valuablesItemDescriptionLabel: 'وصف الأصناف',

  // Other-specific fields
  otherDescriptionLabel: 'وصف البضاعة',
  otherDimensionsLabel: 'الأبعاد (طول × عرض × ارتفاع، سم)',
  otherWeightLabel: 'الوزن (كجم)',
  otherSpecialHandlingLabel: 'متطلبات مناولة خاصة',

  // Form submit + states
  submitButton: 'إرسال طلب الشحن',
  submittingButton: 'جارٍ الإرسال…',
  submitSuccessTitle: 'تم استلام طلبك',
  submitSuccessMessage:
    'سنعود إليك خلال ساعة بعروض من شركاء Aeris للشحن. يمكنك متابعة الطلب عبر رقم المرجع التالي:',
  submitSuccessLoginCta:
    'لديك حساب Aeris؟ سجّل الدخول لمتابعة الطلب وعرض العروض في مكان واحد.',

  // Error contracts (mirrors §4.1 + §4.2 structured errors)
  errors: {
    flag_disabled: 'خدمة الشحن المتخصص غير متاحة حالياً.',
    ip_required: 'تعذّر تحديد الجلسة. حاول من شبكة أخرى.',
    cargo_type_required: 'اختر نوع الشحنة قبل الإرسال.',
    cargo_type_invalid: 'نوع شحنة غير معروف.',
    customer_name_required: 'الاسم مطلوب.',
    customer_name_invalid: 'الاسم لا يتعدى 120 حرفاً.',
    customer_phone_required: 'رقم الهاتف مطلوب.',
    customer_phone_invalid: 'رقم الهاتف لا يتعدى 20 حرفاً.',
    customer_email_invalid: 'البريد الإلكتروني لا يتعدى 120 حرفاً.',
    origin_required: 'حدد مكان الانطلاق.',
    origin_invalid: 'رمز IATA لا يتعدى 4 أحرف.',
    destination_required: 'حدد الوجهة.',
    destination_invalid: 'رمز IATA لا يتعدى 4 أحرف.',
    pickup_date_required: 'تاريخ الاستلام مطلوب.',
    estimated_value_required: 'القيمة التقديرية مطلوبة.',
    value_invalid: 'القيمة التقديرية يجب أن تكون موجبة.',
    date_invalid: 'تاريخ التسليم يجب أن يكون بعد تاريخ الاستلام.',
    validation_failed: 'البيانات غير صحيحة. راجع الحقول المعلَّمة.',
    malformed_input: 'إدخال غير صالح. تأكد من صيغة الأرقام والتواريخ.',
    server_error: 'خطأ غير متوقع. حاول لاحقاً أو تواصل مع الدعم.',
  } as Record<string, string>,

  // ------------------------------------------------------------
  // Admin pages
  // ------------------------------------------------------------
  adminQueueTitle: 'قائمة طلبات الشحن',
  adminQueueSubtitle: 'الطلبات المعلَّقة + الطلبات التي وصلتها عروض.',
  adminQueueEmpty: 'لا توجد طلبات شحن قيد المعالجة حالياً.',
  adminQueueTableNumber: 'رقم الطلب',
  adminQueueTableType: 'النوع',
  adminQueueTableRoute: 'المسار',
  adminQueueTablePickupDate: 'تاريخ الاستلام',
  adminQueueTableValue: 'القيمة',
  adminQueueTableStatus: 'الحالة',
  adminQueueTableActions: 'إجراءات',
  adminQueueViewDetails: 'عرض التفاصيل',

  adminDetailTitle: 'تفاصيل طلب الشحن',
  adminDetailBack: '← قائمة الطلبات',
  adminDetailSectionRequest: 'بيانات الطلب',
  adminDetailSectionOffers: 'العروض المُستلمة',
  adminDetailSectionCustomer: 'بيانات العميل',
  adminDetailSectionCategory: 'تفاصيل الفئة',
  adminDetailNoOffers: 'لم يصل أي عرض بعد.',
  adminDetailOfferOperator: 'المشغّل',
  adminDetailOfferTotalPrice: 'السعر الإجمالي',
  adminDetailOfferProposedDates: 'الفترة المقترحة',
  adminDetailOfferStatus: 'الحالة',
  adminDetailOfferNotes: 'ملاحظات المشغّل',

  // Status labels (cargo_request_status + cargo_offer_status)
  statusLabels: {
    pending: 'بانتظار العروض',
    offers_received: 'وصل عرض',
    accepted: 'مقبول',
    cancelled: 'ملغى',
    expired: 'منتهي',
    declined: 'مرفوض',
    withdrawn: 'مسحوب',
  } as Record<string, string>,

  // Aircraft capability matrix admin UI
  capabilitiesPageTitle: 'مصفوفة قدرات الطائرات للشحن',
  capabilitiesPageSubtitle:
    'حدّد لكل طائرة الفئات التي يمكنها شحنها. الطائرات غير المُسجَّلة لا تظهر في توزيع طلبات الشحن.',
  capabilitiesEmpty: 'لا توجد طائرات مسجّلة حالياً. أضف طائرات في الـ Admin أولاً.',
  capabilitiesTableAircraft: 'الطائرة',
  capabilitiesTableOperator: 'المشغّل',
  capabilitiesTableHorse: 'خيول',
  capabilitiesTableCar: 'سيارات',
  capabilitiesTableValuables: 'بضائع ثمينة',
  capabilitiesTableOther: 'أخرى',
  capabilitiesTableSeed: 'تفعيل',
  capabilitiesTableUpdate: 'تحديث',
  capabilitiesSeedSuccess: 'تم تحديث القدرات.',
} as const;
