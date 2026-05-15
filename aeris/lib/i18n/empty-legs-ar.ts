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

  // Case 2 — reserved (State B = guest token; State C = client)
  caseReservedTitle: 'تفاصيل التحفظ',
  // Phase 10 PR 2 — distinct title for State C (CLIENT) so the
  // founder can tell at a glance which confirm flow applies.
  caseReservedClientTitle: 'تفاصيل التحفظ — عميل مسجّل',
  reservedCustomerName: 'اسم العميل',
  reservedCustomerPhone: 'رقم العميل',
  reservedExpiresAt: 'ينتهي التحفظ في',
  reservedCallCustomer: 'اتصل بالعميل',
  reservedConfirmReservation: 'تأكيد الحجز',
  // Phase 10 PR 2 — State C: no token input. The §4.3 RPC
  // reads reservation_client_id off the leg + clients table.
  reservedConfirmClientReservation: 'تأكيد حجز عميل مسجّل',
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

  // ============================================================
  // PR 2c — Operator stubs bootstrap + session mint (admin)
  // ============================================================
  adminStubsNavLabel: 'سجلّات المشغّلين',
  adminSessionsNavLabel: 'جلسات المشغّلين',
  adminStubsPageTitle: 'سجلّات المشغّلين (Phase 7)',
  adminStubsPageSubtitle:
    'إدارة سجلّات المشغّلين المؤقتة لمرحلة الرحلات الفارغة. تُستبدل بالسجلّات الكاملة في طور لاحق.',
  adminStubsTableEmpty: 'لا توجد سجلّات مشغّلين فعّالة.',
  adminStubsCreateTitle: 'إضافة سجلّ مشغّل جديد',
  adminStubsFieldCompanyName: 'اسم الشركة',
  adminStubsFieldContactEmail: 'البريد الإلكتروني',
  adminStubsFieldContactPhone: 'رقم الهاتف',
  adminStubsFieldNotes: 'ملاحظات (اختياري)',
  adminStubsSubmit: 'إنشاء السجلّ',
  adminStubsColCompany: 'الشركة',
  adminStubsColEmail: 'البريد',
  adminStubsColPhone: 'الهاتف',
  adminStubsColCreated: 'أُنشئ في',
  adminStubsRowMint: 'إصدار جلسة',

  adminSessionsPageTitle: 'جلسات المشغّلين',
  adminSessionsPageSubtitle:
    'إصدار رمز جلسة جديد لمشغّل قائم. يُعرض الرمز مرة واحدة عند الإصدار.',
  adminSessionsFieldStub: 'اختر السجل',
  adminSessionsSubmit: 'إصدار رمز جلسة',
  adminSessionsTokenIssuedTitle: 'تم إصدار الرمز',
  adminSessionsTokenIssuedHint:
    'انسخ الرمز الآن — لن يُعرض مرة أخرى. شارك الرابط مع المشغّل عبر واتساب.',
  adminSessionsTokenUrlLabel: 'رابط البوابة الكامل',
  adminSessionsTokenExpires: 'ينتهي في',
  adminSessionsNoStubs:
    'لا يوجد سجلّ مشغّل فعّال. أنشئ سجلاً أولاً من صفحة سجلّات المشغّلين.',

  // ============================================================
  // PR 2c — Operator self-serve portal
  // ============================================================
  operatorPortalTitle: 'بوابة المشغّل — الرحلات الفارغة',
  operatorPortalNewLeg: 'نشر رحلة جديدة',
  operatorPortalEmpty: 'لا توجد رحلات منشورة في هذه الجلسة.',
  operatorPortalSessionInvalid:
    'الجلسة غير صالحة أو منتهية الصلاحية. اطلب من فريق Aeris إصدار رابط جديد.',
  operatorPortalLegNotFound: 'الرحلة غير موجودة.',
  operatorPortalLegEditTitle: 'تعديل الرحلة',

  // ============================================================
  // PR 2c — Validator-only error codes
  // ============================================================
  errorRpcCompanyNameMissing: 'اسم الشركة مطلوب.',
  errorRpcContactEmailMissing: 'البريد الإلكتروني مطلوب.',
  errorRpcContactEmailInvalid: 'البريد الإلكتروني غير صالح.',
  errorRpcContactPhoneInvalid: 'رقم الهاتف غير صالح.',
  errorRpcOperatorStubIdInvalid: 'معرّف سجلّ المشغّل غير صالح.',
  errorRpcInvalidSession: 'الجلسة غير صالحة.',

  // ============================================================
  // PR 2d — Public marketplace
  // ============================================================
  publicListTitle: 'الرحلات الفارغة',
  publicListSubtitle:
    'رحلات عودة بأسعار مخفضة. السعر ينخفض كلما اقتربت ساعة المغادرة.',
  publicListEmpty: 'لا توجد رحلات متاحة في الوقت الحالي. عُد لاحقاً.',
  publicListFilterDeparture: 'مدينة المغادرة',
  publicListFilterPassengers: 'عدد الركاب (الحد الأدنى)',
  publicListFilterMaxPrice: 'السعر الأقصى',
  publicListFilterApply: 'تطبيق',
  publicListFilterClear: 'إعادة تعيين',
  publicListFilterAny: 'الكل',
  publicListMostUrgent: 'الأقرب مغادرة',

  publicLegPageBack: 'رجوع للقائمة',
  publicLegRoute: 'المسار',
  publicLegWindow: 'نافذة المغادرة',
  publicLegPrice: 'السعر الحالي',
  publicLegOriginalPrice: 'السعر الأصلي',
  publicLegDiscount: 'الخصم الحالي',
  publicLegMaxPassengers: 'العدد الأقصى للركاب',
  publicLegSar: 'ريال',
  publicLegReserveCta: 'احجز الآن',
  publicLegSold: 'تم بيع هذه الرحلة',
  publicLegExpired: 'انتهت نافذة المزاد',
  publicLegNotFound: 'الرحلة غير موجودة.',

  publicAuctionTrajectoryTitle: 'مسار الخصم',
  publicAuctionTrajectoryHint:
    'سيصل السعر إلى {floor} ريال عند انتهاء نافذة المزاد. كلّ تأخير في الحجز قد يعني سعراً أقل، لكن المقاعد تختفي بسرعة.',
  publicAuctionFloorReached:
    'وصل السعر إلى أدنى حد. احجز قبل اختفاء الرحلة.',
  publicAuctionWillReachIn:
    'سيصل إلى {floor} ريال خلال {hours} ساعة تقريباً.',

  publicReserveTitle: 'حجز الرحلة',
  publicReserveHint:
    'الحجز صالح لمدة 10 دقائق. سنتواصل معك عبر واتساب لتأكيد الدفع.',
  publicReserveFieldName: 'الاسم الكامل',
  publicReserveFieldPhone: 'رقم الواتساب',
  publicReserveOptInLabel:
    'أبلغوني عند توفر رحلة فارغة بسعر مخفض على هذا المسار',
  publicReserveOptInHint:
    'اختياري — يمكنك إلغاء الإشتراك من أي رابط مستقبلي.',
  publicReserveSubmit: 'تأكيد الحجز',
  publicReservedTitle: 'تم تثبيت الحجز',
  publicReservedHint:
    'يجب التواصل معنا خلال 10 دقائق لتأكيد الدفع، وإلا سيُلغى الحجز تلقائياً.',
  publicReservedExpiresAt: 'ينتهي التحفّظ في',
  publicReservedCallUs: 'تواصل معنا عبر واتساب',
  publicReservedCancelButton: 'إلغاء حجزي',
  publicReservedCancelled: 'تم إلغاء الحجز.',

  publicOptOutTitle: 'إلغاء الاشتراك',
  publicOptOutHint:
    'سنوقف إرسال إشعارات الرحلات الفارغة المخفّضة على هذا الرقم.',
  publicOptOutConfirmCta: 'أتأكدت؟ نعم، أوقف الإشعارات',
  publicOptOutDone: 'تم إيقاف الإشعارات. شكراً لاستخدامك Aeris.',
  publicOptOutInvalid: 'الرابط غير صالح أو منتهي الصلاحية.',

  homeEmptyLegsCtaTitle: 'اكتشف رحلات فارغة',
  homeEmptyLegsCtaSubtitle:
    'رحلات عودة بأسعار مخفضة من 40% إلى 70%. مزاد ينخفض مع اقتراب موعد المغادرة.',
  homeEmptyLegsCtaButton: 'تصفّح الرحلات',
  navEmptyLegsLabel: 'رحلات فارغة',

  // PR 2d — Validator + Server Action error codes
  errorRpcLegNumberMissing: 'رقم الرحلة مطلوب.',
  errorRpcLegNumberInvalid: 'رقم الرحلة غير صالح.',
  errorRpcReservationTokenMissing: 'رمز الحجز مفقود.',
  errorRpcOptOutTokenMissing: 'رمز إلغاء الاشتراك مفقود.',
  errorRpcOptOutInvalid: 'رابط إلغاء الاشتراك غير صالح.',
  errorRpcLeadInquiryNotFound:
    'سجل العميل غير موجود. ربما تم حذف الحساب من قاعدة البيانات.',
} as const;

export type EmptyLegsArKey = keyof typeof emptyLegsAr;
