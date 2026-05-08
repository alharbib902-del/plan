/**
 * Phase 7 — Arabic-RTL string constants for the Empty Legs
 * surface. All admin (and later operator + public) UI strings
 * live here per the Phase 6.2 i18n discipline (no inline
 * Arabic in JSX).
 */

export const emptyLegsAr = {
  // ============================================================
  // Nav + page titles
  // ============================================================
  navList: 'الرحلات الفارغة',
  navOutreach: 'قائمة المراسلات',
  pageListTitle: 'الرحلات الفارغة',
  pageListSubtitle:
    'عرض الرحلات الفارغة المنشورة، إنشاء رحلات جديدة، وإدارة الحجوزات.',
  pageDetailTitle: 'تفاصيل الرحلة',
  pageNewTitle: 'نشر رحلة فارغة',
  pageOutreachTitle: 'قائمة المراسلات المعلّقة',
  pageOutreachSubtitle:
    'روابط واتساب جاهزة للإرسال إلى العملاء المهتمين بالرحلات الفارغة.',

  // ============================================================
  // Status badges
  // ============================================================
  statusAvailable: 'متاحة',
  statusReserved: 'محجوزة',
  statusSold: 'مُباعة',
  statusExpired: 'منتهية',
  statusCancelled: 'مُلغاة',

  // ============================================================
  // Filter chips
  // ============================================================
  filterAll: 'الكل',
  filterDefault: 'متاحة + محجوزة',

  // ============================================================
  // Table columns + leg row
  // ============================================================
  colLegNumber: 'الرقم',
  colRoute: 'المسار',
  colWindow: 'نافذة المغادرة',
  colPrice: 'السعر الحالي',
  colDiscount: 'الخصم',
  colStatus: 'الحالة',
  colCreated: 'أُنشئت',
  rowOpen: 'فتح',
  passengersLabel: 'ركاب',
  emptyListMessage: 'لا توجد رحلات بهذه الحالة.',

  // ============================================================
  // Publish form
  // ============================================================
  formPublishTitle: 'نشر رحلة فارغة',
  formPublishSubtitle:
    'سيتم احتساب السعر الأولي تلقائياً من السعر الأصلي وخصم البداية.',

  fieldOperatorName: 'اسم المشغّل (اختياري)',
  fieldOperatorPhone: 'رقم المشغّل (اختياري)',
  fieldOperatorEmail: 'بريد المشغّل (اختياري)',
  fieldAircraftText: 'وصف الطائرة (اختياري)',
  fieldDepartureAirportIata: 'كود مطار المغادرة IATA (اختياري)',
  fieldDepartureAirportFreeform: 'مطار المغادرة (نص حر، اختياري)',
  fieldArrivalAirportIata: 'كود مطار الوصول IATA (اختياري)',
  fieldArrivalAirportFreeform: 'مطار الوصول (نص حر، اختياري)',
  fieldDepartureWindowStart: 'بداية نافذة المغادرة',
  fieldDepartureWindowEnd: 'نهاية نافذة المغادرة',
  fieldFlexibilityHours: 'مرونة المغادرة (ساعات)',
  fieldOriginalPrice: 'السعر الأصلي (ريال)',
  fieldMaxPassengers: 'العدد الأقصى للركاب',
  fieldAuctionInitialPct: 'نسبة الخصم الأولية (%)',
  fieldAuctionFloorPct: 'نسبة الخصم القصوى (%)',
  fieldAuctionCurve: 'منحنى الخصم',
  fieldAuctionCurveLinear: 'خطي',
  fieldAuctionCurveAccelerating: 'متسارع',
  fieldAuctionLeadHours: 'ساعات إغلاق المزاد قبل المغادرة',
  fieldSuppressNotifications: 'رحلة اختبار داخلية — لا ترسل تنبيهات',
  fieldSuppressNotificationsHint:
    'فعّل هذا الخيار للرحلات التجريبية فقط. يمنع المُطابق من إرسال تنبيهات إلى أي عميل.',

  formPublishHintRoutePresence:
    'يجب توفير IATA أو نص حر لكل من المغادرة والوصول.',
  formSubmitPublish: 'نشر الرحلة',
  formSubmitting: 'جارٍ النشر…',

  // ============================================================
  // Detail page — Case 1 / 2 / 3
  // ============================================================
  detailRouteLabel: 'المسار',
  detailWindowLabel: 'نافذة المغادرة',
  detailFlexibilityLabel: 'مرونة المغادرة',
  detailFlexibilityHoursSuffix: 'ساعات',
  detailOriginalPriceLabel: 'السعر الأصلي',
  detailCurrentPriceLabel: 'السعر الحالي',
  detailDiscountPctLabel: 'نسبة الخصم الحالية',
  detailMaxPassengersLabel: 'العدد الأقصى للركاب',
  detailAuctionWindowLabel: 'نافذة المزاد',
  detailAuctionCurveLabel: 'منحنى الخصم',
  detailOperatorLabel: 'المشغّل',
  detailAircraftLabel: 'الطائرة',
  detailNotProvided: 'غير محدد',

  // Case 1 — available
  caseAvailableTitle: 'الإجراءات المتاحة',
  actionEditPrice: 'تعديل السعر الحالي',
  actionCancelLeg: 'إلغاء الرحلة',
  actionMarkSoldManual: 'تأكيد البيع يدوياً (واتساب)',

  priceEditFormTitle: 'تعديل السعر الحالي',
  priceEditFormHint:
    'يجب أن يكون السعر الجديد بين السعر الأرضي للمزاد والسعر الأصلي.',
  priceEditFieldNewPrice: 'السعر الجديد (ريال)',
  priceEditSubmit: 'حفظ السعر',

  cancelFormTitle: 'إلغاء الرحلة',
  cancelFormHint:
    'سيتم تغيير حالة الرحلة إلى "مُلغاة". لا يمكن التراجع عن هذا الإجراء.',
  cancelFieldReason: 'سبب الإلغاء (اختياري)',
  cancelSubmit: 'تأكيد الإلغاء',

  markSoldFormTitle: 'تأكيد بيع يدوي',
  markSoldFormHint:
    'استخدم هذا الخيار للرحلات التي بِيعت عبر واتساب دون المرور بصفحة الحجز العامة. سيتم إنشاء حجز مباشرة.',
  markSoldFieldCustomerName: 'اسم العميل',
  markSoldFieldCustomerPhone: 'رقم العميل',
  markSoldSubmit: 'تأكيد البيع',

  // Case 2 — reserved
  caseReservedTitle: 'تفاصيل التحفظ',
  reservedCustomerName: 'اسم العميل',
  reservedCustomerPhone: 'رقم العميل',
  reservedExpiresAt: 'ينتهي التحفظ في',
  reservedCallCustomer: 'اتصل بالعميل',
  reservedConfirmReservation: 'تأكيد الحجز',
  reservedReleaseReservation: 'إلغاء التحفظ',
  reservedConfirmHint:
    'الصق رمز التحفظ الذي أرسله العميل عبر واتساب لتأكيد الحجز.',
  reservedConfirmFieldToken: 'رمز التحفظ من العميل',
  reservedConfirmSubmit: 'تأكيد',

  // Case 3 — sold
  caseSoldTitle: 'تفاصيل البيع',
  soldBookingId: 'رقم الحجز',
  soldBookingDeepLinkPending:
    'لوحة الحجوزات ليست متاحة في هذه المرحلة. سيُربط هذا الحجز بصفحته الخاصة في طور لاحق.',
  soldBookingMissing: 'لم يتم العثور على معرّف الحجز.',

  // ============================================================
  // Outreach queue
  // ============================================================
  outreachEmpty: 'لا توجد روابط معلّقة في القائمة.',
  outreachLegLabel: 'الرحلة',
  outreachCustomerLabel: 'العميل',
  outreachWaUrl: 'فتح رابط واتساب',
  outreachMarkSent: 'تم الإرسال',
  outreachSendingButton: 'جارٍ الحفظ…',
  outreachAlertBannerTitle: 'تنبيه: تنبيهات المؤسس معطلة',
  outreachAlertBannerHint: 'راجع إعدادات Resend',
  outreachAlertPendingCount: 'مراسلة معلّقة لأكثر من 24 ساعة',

  // ============================================================
  // Generic + errors
  // ============================================================
  back: 'رجوع',
  cancel: 'إلغاء',
  confirm: 'تأكيد',
  errorGeneric: 'تعذّر إكمال العملية. حاول مرة أخرى.',
  errorRpcLegNotFound: 'الرحلة غير موجودة.',
  errorRpcLegNotAvailable: 'الرحلة غير متاحة للتعديل.',
  errorRpcLegNotReserved: 'الرحلة ليست محجوزة.',
  errorRpcLegWindowClosed: 'نافذة الحجز أُغلقت.',
  errorRpcReservationExpired: 'انتهى وقت التحفظ.',
  errorRpcReservationTokenMismatch: 'رمز التحفظ غير مطابق.',
  errorRpcReservationTokenInvalid: 'رمز التحفظ غير صالح.',
  errorRpcReservationExpiryInvalid: 'وقت انتهاء التحفظ غير صالح.',
  errorRpcReservationExpiryTooFar:
    'وقت انتهاء التحفظ يتجاوز الحد المسموح به.',
  errorRpcDepartureRouteMissing: 'مطار المغادرة غير محدد.',
  errorRpcArrivalRouteMissing: 'مطار الوصول غير محدد.',
  errorRpcDepartureAirportUnknown: 'كود مطار المغادرة غير معروف.',
  errorRpcArrivalAirportUnknown: 'كود مطار الوصول غير معروف.',
  errorRpcDepartureWindowInvalid: 'نافذة المغادرة غير صالحة.',
  errorRpcOriginalPriceInvalid: 'السعر الأصلي غير صالح.',
  errorRpcMaxPassengersInvalid: 'عدد الركاب غير صالح.',
  errorRpcAuctionInitialOutOfRange: 'نسبة الخصم الأولية خارج المدى المسموح.',
  errorRpcAuctionFloorOutOfRange: 'نسبة الخصم القصوى خارج المدى المسموح.',
  errorRpcAuctionFloorBelowInitial:
    'نسبة الخصم القصوى يجب أن تكون أكبر من الأولية.',
  errorRpcAuctionCurveInvalid: 'منحنى الخصم غير صالح.',
  errorRpcAuctionWindowLeadHoursInvalid:
    'ساعات إغلاق المزاد يجب أن تكون قيمة موجبة.',
  errorRpcAuctionWindowAlreadyClosed: 'نافذة المزاد مُغلقة بالفعل.',
  errorRpcParentBookingNotFound: 'الحجز الأصلي غير موجود.',
  errorRpcOperatorNotFound: 'المشغّل غير موجود.',
  errorRpcOperatorStubNotFound: 'سجلّ المشغّل المؤقت غير موجود.',
  errorRpcAircraftNotFound: 'الطائرة غير موجودة.',
  errorRpcNewPriceInvalid: 'السعر الجديد غير صالح.',
  errorRpcNewPriceAboveOriginal:
    'السعر الجديد يجب ألا يتجاوز السعر الأصلي.',
  errorRpcNewPriceBelowFloor:
    'السعر الجديد يجب ألا يقل عن السعر الأرضي للمزاد.',
  errorRpcCustomerNameMissing: 'اسم العميل مطلوب.',
  errorRpcCustomerPhoneMissing: 'رقم العميل مطلوب.',
  errorRpcCancellationReasonRequired: 'يجب إدخال سبب الإلغاء.',
  errorRpcLegAlreadyTerminal: 'الرحلة في حالة نهائية ولا يمكن إلغاؤها.',
  errorOutreachNotFound: 'سجل المراسلة غير موجود.',
  errorAdminGate: 'تعذّر التحقق من الصلاحيات.',
  errorFlagDisabled: 'هذه الواجهة معطّلة بإعدادات النظام.',
} as const;

export type EmptyLegsArKey = keyof typeof emptyLegsAr;
