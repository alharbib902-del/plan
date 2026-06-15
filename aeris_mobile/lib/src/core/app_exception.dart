/// Typed transport error carrying the opaque wire `error` code
/// returned by `/api/v1/mobile/*` ({ ok:false, error:'<code>' }).
///
/// The Arabic dictionary is PORTED from the web's
/// `lib/i18n/clients-ar.ts` + the mobile-layer codes
/// (`lib/mobile/http.ts`). The wire stays code-based so
/// enumeration-safe codes (e.g. invalid_credentials) keep their
/// meaning; the app does the localisation here.
class AppException implements Exception {
  const AppException(this.code, {this.retryAfterSeconds, this.fieldErrors});

  final String code;
  final int? retryAfterSeconds;
  final Map<String, String>? fieldErrors;

  String get messageAr => errorMessageAr(code);

  @override
  String toString() => 'AppException($code)';
}

const String _fallbackAr = 'حدث خطأ غير متوقّع، يرجى المحاولة لاحقاً';

const Map<String, String> _ar = {
  // credentials / session
  'invalid_credentials': 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
  'account_not_active': 'هذا الحساب غير مفعّل، تواصل مع الدعم',
  'missing_token': 'انتهت الجلسة، يرجى تسجيل الدخول من جديد',
  'invalid_session': 'انتهت الجلسة، يرجى تسجيل الدخول من جديد',
  'session_expired': 'انتهت جلستك، يرجى تسجيل الدخول من جديد',
  'expired': 'انتهت جلستك، يرجى تسجيل الدخول من جديد',
  'password_change_required': 'يجب تغيير كلمة المرور قبل المتابعة',
  // change-password (NOTE: current_password_invalid is a credential error,
  // NOT a session death — it must never clear the token; see session_codes.dart)
  'current_password_invalid': 'كلمة المرور الحالية غير صحيحة',
  'client_not_active': 'هذا الحساب غير مفعّل، تواصل مع الدعم',
  'client_not_found': 'تعذّر العثور على الحساب',
  'lookup_failed': 'تعذّر إتمام الطلب، حاول مرة أخرى',
  'update_failed': 'تعذّر حفظ التغيير، حاول مرة أخرى',
  'bcrypt_failed': 'تعذّر إتمام الطلب، حاول مرة أخرى',
  // owned-resource lookups
  'booking_not_found': 'هذا الحجز غير موجود أو لا يخصّ حسابك',
  'request_not_found': 'هذا الطلب غير موجود أو لا يخصّ حسابك',
  // 409 — charter action conflicts (accept / decline offer, cancel request)
  'cancel_not_allowed':
      'لا يمكن إلغاء هذا الطلب الآن (قد يكون محجوزاً أو لم يعد متاحاً).',
  'accept_failed': 'تعذّر قبول العرض الآن. حاول لاحقاً.',
  'decline_not_allowed':
      'لا يمكن رفض هذا العرض الآن (قد يكون مقبولاً أو منتهي الصلاحية).',
  'offer_not_pending': 'هذا العرض لم يعد قيد المراجعة.',
  'offer_expired': 'انتهت صلاحية هذا العرض.',
  'trip_not_open': 'هذا الطلب لم يعد مفتوحاً للعروض (قد يكون محجوزاً أو ملغياً).',
  'unknown_source': 'مصدر العرض غير معروف.',
  'booking_has_active_payment': 'لا يمكن تنفيذ الإجراء (يوجد دفع جارٍ).',
  'auction_window_closed': 'انتهت نافذة المزايدة.',
  // input / flags
  'validation_failed': 'يرجى التحقّق من البيانات المُدخلة',
  'flag_disabled': 'هذه الخدمة غير متاحة حالياً',
  'body_too_large': 'حجم الطلب كبير جداً',
  'malformed_body': 'طلب غير صالح',
  // throttle
  'rate_limited': 'محاولات كثيرة، يرجى المحاولة بعد قليل',
  // dependency / network
  'rpc_failed': 'تعذّر إتمام الطلب، حاول مرة أخرى',
  'rpc_error': 'تعذّر إتمام الطلب، حاول مرة أخرى',
  'storage_error': 'الخدمة مشغولة مؤقتاً، حاول لاحقاً',
  'secret_missing': 'الخدمة غير مهيّأة حالياً',
  'network_error': 'تعذّر الاتصال بالخادم، تحقّق من اتصالك',
};

String errorMessageAr(String code) => _ar[code] ?? _fallbackAr;
