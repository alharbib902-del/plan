/**
 * Phase 9 — Arabic-RTL strings for the client portal.
 *
 * Mirrors `operatorsAr` (Phase 8) and `emptyLegsAr` (Phase 7)
 * discipline: every user-visible Arabic string lives in one
 * module so the UI surface can be reviewed in isolation.
 */

export const clientsAr = {
  // ------------------------------------------------------------
  // Brand + nav
  // ------------------------------------------------------------
  brand: 'AERIS',
  navMyArea: 'حسابي',
  navProfile: 'الملف الشخصي',
  navLogout: 'تسجيل الخروج',

  // Surfaced on the admin canary page (Phase 9 PR 1
  // 4th ChannelHealth card)
  canaryClientEmailChannel: 'بريد العملاء (Resend)',

  // ------------------------------------------------------------
  // Public auth pages
  // ------------------------------------------------------------
  loginTitle: 'تسجيل الدخول',
  loginSubtitle: 'أدخل بريدك وكلمة المرور للوصول إلى حسابك.',
  loginEmailLabel: 'البريد الإلكتروني',
  loginPasswordLabel: 'كلمة المرور',
  loginRememberMe: 'تذكّرني (30 يوم)',
  loginSubmit: 'دخول',
  loginSubmitting: 'جارٍ الدخول...',
  loginForgotLink: 'نسيت كلمة المرور؟',
  loginNoAccountPrompt: 'ليس لديك حساب؟',
  loginSignupLink: 'أنشئ حساباً جديداً',

  signupTitle: 'إنشاء حساب جديد',
  signupSubtitle:
    'سجّل لطلب رحلات Charter ومتابعة عروضك في مكان واحد.',
  signupEmailLabel: 'البريد الإلكتروني',
  signupPasswordLabel: 'كلمة المرور (10 أحرف على الأقل، حرف ورقم)',
  signupFullNameLabel: 'الاسم الكامل',
  signupPhoneLabel: 'رقم الجوال (مع رمز الدولة)',
  signupMarketingOptIn:
    'أرغب في تلقي عروض ورحلات Empty Legs على بريدي.',
  signupSubmit: 'إنشاء الحساب',
  signupSubmitting: 'جارٍ الإنشاء...',
  signupHasAccountPrompt: 'لديك حساب بالفعل؟',
  signupLoginLink: 'سجّل الدخول',
  signupSuccessHeading: 'تم إنشاء حسابك',
  signupSuccessBody: 'تم تسجيل دخولك تلقائياً. سننقلك إلى حسابك...',

  forgotTitle: 'استعادة كلمة المرور',
  forgotSubtitle:
    'اكتب بريد الحساب وسنُرسل رابط إعادة التعيين خلال دقائق.',
  forgotEmailLabel: 'البريد الإلكتروني',
  forgotSubmit: 'إرسال رابط الاستعادة',
  forgotSubmitting: 'جارٍ الإرسال...',
  forgotOpaqueSuccess:
    'إذا كان البريد مسجّلاً لدينا، ستجد رابط الاستعادة في صندوق الوارد خلال دقائق.',
  forgotBackToLogin: 'العودة لتسجيل الدخول',

  resetTitle: 'تعيين كلمة مرور جديدة',
  resetSubtitle:
    'اكتب كلمة المرور الجديدة. سيُسجَّل خروجك من جميع الأجهزة بعد الحفظ.',
  resetNewPasswordLabel: 'كلمة المرور الجديدة',
  resetSubmit: 'حفظ كلمة المرور',
  resetSubmitting: 'جارٍ الحفظ...',
  resetSuccessHeading: 'تم تحديث كلمة المرور',
  resetSuccessBody: 'يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.',
  resetGoToLogin: 'الذهاب لتسجيل الدخول',

  // ------------------------------------------------------------
  // Authed /me pages
  // ------------------------------------------------------------
  meLandingTitle: 'مرحباً بك في Aeris',
  meLandingSubtitle:
    'حسابك جاهز. ستفتح صفحة طلب الرحلات + عروضك بمجرد تسليم PR 2 + PR 3.',
  meLandingProfileLink: 'الملف الشخصي',

  profileTitle: 'الملف الشخصي',
  profileEmailLabel: 'البريد (لا يُعدَّل)',
  profileFullNameLabel: 'الاسم الكامل',
  profilePhoneLabel: 'رقم الجوال',
  profileMarketingOptIn: 'تلقي عروض Empty Legs على البريد',
  profileSave: 'حفظ التعديلات',
  profileSaving: 'جارٍ الحفظ...',
  profileSavedToast: 'تم حفظ التعديلات.',
  profileChangePasswordLink: 'تغيير كلمة المرور',

  changePasswordTitle: 'تغيير كلمة المرور',
  changePasswordSubtitle:
    'أدخل كلمة المرور الحالية، ثم اختر كلمة مرور جديدة.',
  changePasswordCurrentLabel: 'كلمة المرور الحالية',
  changePasswordNewLabel: 'كلمة المرور الجديدة',
  changePasswordSubmit: 'تحديث كلمة المرور',
  changePasswordSubmitting: 'جارٍ التحديث...',
  changePasswordSuccess: 'تم تحديث كلمة المرور.',

  // ------------------------------------------------------------
  // Phase 9 PR 2 — Authenticated charter form
  // ------------------------------------------------------------
  charterTitle: 'طلب رحلة Charter',
  charterSubtitle:
    'املأ تفاصيل رحلتك وسنوزّع طلبك على المشغّلين المؤهّلين.',
  charterDepartureIataLabel: 'كود مطار المغادرة (IATA)',
  charterArrivalIataLabel: 'كود مطار الوصول (IATA)',
  charterDepartureDateLabel: 'تاريخ ووقت المغادرة',
  charterReturnDateLabel: 'تاريخ ووقت العودة (اختياري)',
  charterPassengersLabel: 'عدد الركاب',
  charterAircraftPrefLabel: 'تفضيل فئة الطائرة (اختياري)',
  charterAircraftPrefAny: 'لا تفضيل',
  charterAircraftPrefLight: 'خفيفة (Light)',
  charterAircraftPrefMid: 'متوسطة (Mid)',
  charterAircraftPrefSuperMid: 'متوسطة كبيرة (Super-Mid)',
  charterAircraftPrefHeavy: 'ثقيلة (Heavy)',
  charterAircraftPrefLongRange: 'بعيدة المدى (Long-Range)',
  charterSpecialRequestsLabel: 'طلبات خاصة (اختياري)',
  charterSubmit: 'إرسال الطلب',
  charterSubmitting: 'جارٍ الإرسال...',
  charterSuccessHeading: 'تم استلام طلبك',
  charterSuccessBody: (requestNumber: string): string =>
    `رقم طلبك: ${requestNumber}. ستظهر العروض في «طلباتي» خلال دقائق.`,
  charterSuccessGoToRequests: 'الذهاب إلى طلباتي',

  cancelTripConfirm: 'هل أنت متأكد من إلغاء هذا الطلب؟',
  cancelTripSubmit: 'إلغاء الطلب',
  cancelTripSubmitting: 'جارٍ الإلغاء...',
  cancelTripSuccess: 'تم إلغاء الطلب.',

  // ------------------------------------------------------------
  // Error translation map (RPC error codes → Arabic strings)
  // ------------------------------------------------------------
  errors: {
    flag_disabled: 'بوابة العملاء غير مفعّلة حالياً.',
    validation_failed: 'يرجى مراجعة الحقول وتصحيح الأخطاء.',
    bcrypt_failed: 'تعذّر تشفير كلمة المرور. حاول مرة أخرى.',
    rpc_failed: 'حدث خطأ في الخادم. حاول مرة أخرى لاحقاً.',
    rate_limited:
      'تم تجاوز حدّ المحاولات (3/يوم/IP). جرّب لاحقاً أو غيّر الشبكة.',
    duplicate_email: 'هذا البريد مسجّل مسبقاً. سجّل الدخول بدلاً من ذلك.',
    invalid_credentials: 'البريد أو كلمة المرور غير صحيحة.',
    account_not_active:
      'الحساب غير مفعّل (موقوف أو محذوف). تواصل مع الدعم.',
    invalid_email: 'صيغة البريد الإلكتروني غير صحيحة.',
    // Codex round 2 PR #55 P1 #1 — structured DB-validation
    // contracts mirrored from Phase 8 operator_signup. These
    // are defence-in-depth: Zod in the Server Action catches
    // them first; if anything reaches here, the user gets a
    // precise hint instead of the generic rpc_failed.
    email_invalid: 'صيغة البريد الإلكتروني غير صحيحة.',
    password_hash_malformed: 'صيغة كلمة المرور غير مدعومة.',
    full_name_invalid:
      'الاسم الكامل يجب أن يكون بين 2 و 120 حرف.',
    contact_phone_invalid:
      'رقم الجوال يجب أن يكون بين 6 و 20 خانة.',
    ip_required:
      'تعذّر التحقق من جلستك. حاول من شبكة مختلفة أو تواصل مع الدعم.',
    invalid_token_hash: 'رابط غير صالح.',
    invalid_client: 'حساب غير صالح.',
    client_not_found: 'الحساب غير موجود.',
    invalid_session: 'الجلسة غير صالحة. سجّل دخولك من جديد.',
    expired: 'انتهت الجلسة. سجّل دخولك من جديد.',
    token_invalid:
      'الرابط غير صالح أو منتهي الصلاحية. اطلب رابطاً جديداً.',
    token_used: 'استُخدم هذا الرابط مسبقاً. اطلب رابطاً جديداً.',
    token_expired: 'انتهت صلاحية الرابط. اطلب رابطاً جديداً.',
    token_not_found: 'الرابط غير موجود. اطلب رابطاً جديداً.',
    token_mint_failed:
      'تعذّر إنشاء رابط الاستعادة. حاول مرة أخرى لاحقاً.',
    invalid_expiry: 'مدّة صلاحية الرابط غير صحيحة.',
    invalid_password_hash: 'صيغة كلمة المرور غير مدعومة.',
    current_password_invalid: 'كلمة المرور الحالية غير صحيحة.',
    lookup_failed: 'تعذّر قراءة بيانات الحساب.',
    update_failed: 'تعذّر حفظ التعديلات. حاول مرة أخرى.',
    not_implemented: 'هذه الميزة لم تُفعَّل بعد.',

    // Phase 9 PR 2 — create_authenticated_trip_request +
    // cancelMyTripRequest structured contracts (client_not_found
    // is shared with PR 1 above and intentionally not redefined).
    client_not_active:
      'الحساب غير مفعّل. تواصل مع الدعم لاستعادة الوصول.',
    invalid_trip_type:
      'نوع الرحلة غير مدعوم في هذه الصفحة (charter فقط).',
    invalid_legs:
      'يجب إضافة قطعة طيران واحدة على الأقل.',
    invalid_iata: 'كود المطار يجب أن يكون 3 أحرف لاتينية.',
    departure_airport_unknown:
      'كود مطار المغادرة غير معروف. تأكّد من إدخال كود IATA صحيح (مثل: RUH).',
    arrival_airport_unknown:
      'كود مطار الوصول غير معروف. تأكّد من إدخال كود IATA صحيح (مثل: JED).',
    invalid_departure_date:
      'تاريخ المغادرة يجب أن يكون في المستقبل.',
    invalid_return_date:
      'تاريخ العودة يجب أن يكون بعد تاريخ المغادرة.',
    invalid_passengers: 'عدد الركاب يجب أن يكون بين 1 و 19.',
    invalid_aircraft_pref: 'فئة الطائرة المختارة غير معروفة.',
    special_requests_too_long:
      'الطلبات الخاصة يجب أن تكون أقل من 2000 حرف.',
    cancel_not_allowed:
      'لا يمكن إلغاء هذا الطلب الآن (قد يكون محجوزاً أو لم يعد متاحاً).',
  } as Record<string, string>,
} as const;
