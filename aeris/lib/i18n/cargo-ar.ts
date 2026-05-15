/**
 * Phase 11 — Arabic-RTL strings for the cargo surface.
 *
 * Mirrors clientsAr (Phase 9) + emptyLegsAr (Phase 7) discipline:
 * every user-visible Arabic string lives in one module so the
 * UI surface can be reviewed in isolation.
 *
 * PR 1 ships the public form + admin intake strings;
 * PR 2 adds authed portal + operator portal + offer/booking strings;
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

  // ============================================================
  // PR 2 — Client portal (/me/cargo-requests)
  // ============================================================
  meListPageTitle: 'طلبات الشحن الخاصة بك',
  meListPageSubtitle: 'تابع طلبات الشحن النشطة + العروض المُستلَمة.',
  meListEmpty: 'لا توجد لديك طلبات شحن بعد.',
  meListNewRequestCta: 'طلب شحن جديد',
  meListTableNumber: 'رقم الطلب',
  meListTableType: 'النوع',
  meListTableRoute: 'المسار',
  meListTablePickup: 'تاريخ الاستلام',
  meListTableStatus: 'الحالة',
  meListTableActions: 'إجراءات',
  meListViewDetails: 'عرض',

  meNewPageTitle: 'طلب شحن جديد',
  meNewPageSubtitle: 'املأ تفاصيل الشحنة وسنرسل لك عروض من المشغّلين.',
  meNewBackToList: '← قائمة طلباتي',

  meDetailPageTitle: 'تفاصيل طلب الشحن',
  meDetailBackToList: '← قائمة طلباتي',
  meDetailSectionRequest: 'بيانات الطلب',
  meDetailSectionOffers: 'العروض المُستلمة',
  meDetailSectionCategory: 'تفاصيل الفئة',
  meDetailNoOffers: 'لم يصل أي عرض بعد. سنخبرك عند وصول أول عرض.',
  meDetailOfferOperator: 'المشغّل',
  meDetailOfferAircraft: 'الطائرة',
  meDetailOfferTotalPrice: 'السعر الإجمالي',
  meDetailOfferBasePrice: 'السعر الأساسي',
  meDetailOfferInsurance: 'تأمين',
  meDetailOfferCustoms: 'تخليص جمركي',
  meDetailOfferProposedDates: 'الفترة المقترحة',
  meDetailOfferExpiresAt: 'صلاحية العرض',
  meDetailOfferStatus: 'الحالة',
  meDetailOfferNotes: 'ملاحظات المشغّل',
  meDetailOfferAcceptCta: 'قبول العرض',
  meDetailOfferDeclineCta: 'رفض',
  meDetailRequestCancelCta: 'إلغاء الطلب',
  meDetailReasonLabel: 'سبب (اختياري)',
  meDetailReasonPlaceholder: 'اذكر سبباً مختصراً (لا يتعدى 500 حرف)',
  meDetailConfirmAcceptTitle: 'تأكيد قبول العرض',
  meDetailConfirmAcceptBody:
    'بقبولك، سيُنشأ حجز جديد ويُرفض باقي العروض على هذا الطلب.',
  meDetailConfirmAcceptYes: 'نعم، اقبل',
  meDetailConfirmAcceptNo: 'تراجع',
  meDetailConfirmDeclineTitle: 'تأكيد رفض العرض',
  meDetailConfirmDeclineYes: 'نعم، ارفض',
  meDetailConfirmCancelTitle: 'تأكيد إلغاء الطلب',
  meDetailConfirmCancelBody:
    'سيُلغى الطلب نهائياً وتُرفض جميع العروض المعلَّقة عليه.',
  meDetailConfirmCancelYes: 'نعم، ألغِ الطلب',

  // ============================================================
  // PR 2 — Operator portal (/operator/cargo)
  // ============================================================
  operatorListPageTitle: 'طلبات الشحن المتاحة',
  operatorListPageSubtitle: 'الطلبات التي يمكنك تقديم عروض عليها.',
  operatorListEmpty: 'لا توجد طلبات شحن متاحة حالياً.',
  operatorListTableNumber: 'رقم الطلب',
  operatorListTableType: 'النوع',
  operatorListTableRoute: 'المسار',
  operatorListTablePickup: 'تاريخ الاستلام',
  operatorListTableValue: 'القيمة المُقدَّرة',
  operatorListSubmitOfferCta: 'تقديم عرض',
  operatorListMyOffersCta: 'عروضي المُقدَّمة',

  operatorOfferPageTitle: 'تقديم عرض شحن',
  operatorOfferBack: '← قائمة الطلبات',
  operatorOfferAircraftLabel: 'الطائرة',
  operatorOfferAircraftEmpty:
    'لا توجد طائرات مسجَّلة لهذا النوع من الشحن. تواصل مع فريق Aeris.',
  operatorOfferAircraftSnapshotLabel: 'وصف الطائرة (اختياري)',
  operatorOfferBasePriceLabel: 'السعر الأساسي (ريال)',
  operatorOfferInsurancePriceLabel: 'سعر التأمين (ريال، اختياري)',
  operatorOfferCustomsPriceLabel: 'سعر التخليص الجمركي (ريال، اختياري)',
  operatorOfferProposedPickupLabel: 'تاريخ الاستلام المقترح',
  operatorOfferProposedDeliveryLabel: 'تاريخ التسليم المقترح',
  operatorOfferNotesLabel: 'ملاحظات للعميل (اختياري)',
  operatorOfferSubmitCta: 'تقديم العرض',
  operatorOfferSubmitting: 'جارٍ التقديم…',

  operatorMyOffersTitle: 'عروضي المُقدَّمة',
  operatorMyOffersSubtitle: 'تابع حالة العروض التي قدَّمتها.',
  operatorMyOffersEmpty: 'لم تقدّم أي عرض بعد.',
  operatorMyOffersTableRequest: 'الطلب',
  operatorMyOffersTableSubmittedAt: 'تاريخ التقديم',
  operatorMyOffersTableTotal: 'الإجمالي',
  operatorMyOffersTableStatus: 'الحالة',
  operatorMyOffersWithdrawCta: 'سحب العرض',
  operatorMyOffersConfirmWithdrawTitle: 'تأكيد سحب العرض',
  operatorMyOffersConfirmWithdrawBody:
    'سيُسحَب العرض ولن يكون متاحاً للعميل بعد ذلك.',
  operatorMyOffersConfirmWithdrawYes: 'نعم، اسحب',

  // ============================================================
  // PR 2 — Admin extension buttons
  // ============================================================
  adminAcceptOnBehalfCta: 'قبول نيابة عن العميل',
  adminDeclineOnBehalfCta: 'رفض نيابة عن العميل',
  adminCancelRequestCta: 'إلغاء الطلب',
  adminConfirmAcceptOnBehalfTitle: 'تأكيد قبول العرض نيابة',
  adminConfirmAcceptOnBehalfBody:
    'سيُنشأ حجز باسم العميل (الضيف) ويُرفض باقي العروض على هذا الطلب.',

  // ============================================================
  // PR 2 — Action results + error map
  // ============================================================
  actionAcceptSuccess: 'تم قبول العرض. تم إنشاء الحجز.',
  actionDeclineSuccess: 'تم رفض العرض.',
  actionDeclineAlready: 'العرض كان مرفوضاً مسبقاً.',
  actionWithdrawSuccess: 'تم سحب العرض.',
  actionWithdrawAlready: 'العرض كان مسحوباً مسبقاً.',
  actionCancelSuccess: 'تم إلغاء الطلب.',
  actionCancelAlready: 'الطلب كان ملغياً مسبقاً.',
  actionSubmitOfferSuccess: 'تم تقديم العرض. سنُعلم العميل.',
  actionSubmitRequestSuccess: 'تم إنشاء الطلب. سنرسل لك العروض قريباً.',

  errorActorAmbiguous: 'تعارض في تحديد المنفّذ — أعد المحاولة.',
  errorOfferNotFound: 'العرض غير موجود أو حُذف.',
  errorOfferNotPending: 'لا يمكن تنفيذ الإجراء — العرض لم يعد قابلاً للتعديل.',
  errorOfferExpired: 'انتهت صلاحية العرض.',
  errorRequestNotFound: 'الطلب غير موجود.',
  errorRequestNotOpen: 'الطلب لم يعد مفتوحاً للعروض.',
  errorRequestExpired: 'انتهت صلاحية الطلب.',
  errorForbidden: 'ليس لديك صلاحية تنفيذ هذا الإجراء.',
  errorNotYourRequest: 'هذا الطلب ليس لك.',
  errorAdminCannotAcceptAuthed:
    'لا يمكن للأدمن قبول عرض على طلب لعميل مسجّل — يجب على العميل نفسه القبول.',
  errorAdminCannotDeclineAuthed:
    'لا يمكن للأدمن رفض عرض على طلب لعميل مسجّل.',
  errorAdminCannotCancelAuthed:
    'لا يمكن للأدمن إلغاء طلب لعميل مسجّل.',
  errorRequestAccepted: 'تم قبول عرض على هذا الطلب — لا يمكن إلغاؤه.',
  errorRequestNotCancellable: 'حالة الطلب لا تسمح بالإلغاء.',
  errorFlagDisabled: 'خدمة الشحن غير مفعّلة حالياً.',
  errorReasonTooLong: 'السبب لا يتعدى 500 حرف.',
  errorMustChangePassword: 'يجب تعيين كلمة مرور جديدة قبل المتابعة.',
  errorAircraftNotCapable: 'هذه الطائرة لا تدعم نوع الشحنة المطلوب.',
  errorOperatorAlreadySubmitted: 'سبق أن قدَّمت عرضاً على هذا الطلب.',
  errorServerError: 'حدث خطأ غير متوقع. حاول لاحقاً.',
  errorValidation: 'بيانات الإدخال غير صحيحة.',
  errorUnauthorized: 'يجب تسجيل الدخول أولاً.',
} as const;
