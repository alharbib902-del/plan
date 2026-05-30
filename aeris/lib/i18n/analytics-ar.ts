/**
 * Phase 14 — Arabic-RTL strings for the admin analytics dashboard
 * (`/admin/analytics`). Per the i18n discipline, every user-visible
 * Arabic string lives here (no inline Arabic in JSX).
 */

export const analyticsAr = {
  nav: 'التحليلات',
  metaTitle: 'لوحة التحليلات',
  heading: 'نظرة عامة على الأداء',

  // Date-range control
  rangeFrom: 'من',
  rangeTo: 'إلى',
  rangeApply: 'تطبيق',
  rangeReset: 'آخر 30 يوماً',
  rangeHint: 'النطاق الافتراضي آخر 30 يوماً (الحد الأقصى 366 يوماً).',
  rangeSummary: 'النطاق المعروض',

  // Errors
  errorInvalidRange: 'النطاق غير صالح (تاريخ البداية يساوي/يلي تاريخ النهاية).',
  errorRangeTooLarge: 'النطاق كبير جداً — الحد الأقصى 366 يوماً.',
  errorGeneric: 'تعذّر تحميل التحليلات حالياً. حاول لاحقاً.',

  // KPI cards
  revenueLabel: 'الإيرادات المدفوعة',
  paidCountLabel: 'حجوزات مدفوعة',
  bookingsLabel: 'إجمالي الحجوزات',
  cancelledLabel: 'حجوزات ملغاة',
  requestsLabel: 'إجمالي الطلبات',
  conversionLabel: 'معدّل التحويل (محجوز/طلبات)',

  // Sections
  bySourceHeading: 'الحجوزات حسب النوع',
  byStatusHeading: 'الطلبات حسب الحالة',
  topRoutesHeading: 'أعلى المسارات (طلبات)',
  topOperatorsHeading: 'أداء المشغّلين (إيراد مدفوع)',

  // Table columns
  colType: 'النوع',
  colStatus: 'الحالة',
  colRoute: 'المسار',
  colOperator: 'المشغّل',
  colCount: 'العدد',
  colRevenue: 'الإيراد المدفوع',
  colPaidCount: 'حجوزات',

  noData: 'لا توجد بيانات في هذا النطاق.',

  // Booking source labels (bookings.source_discriminator)
  sourceCharter: 'عادي (Charter)',
  sourceEmptyLeg: 'رحلة فارغة',
  sourceCargo: 'شحن',
  sourceMedevac: 'إخلاء طبي',

  // Trip-request status labels (trip_request_status)
  statusPending: 'قيد الانتظار',
  statusDistributed: 'موزّع للمشغّلين',
  statusOffered: 'وردت عروض',
  statusBooked: 'محجوز',
  statusCancelled: 'ملغى',
} as const;
