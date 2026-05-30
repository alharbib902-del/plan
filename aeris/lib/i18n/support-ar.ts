/**
 * Arabic-RTL strings for the Support feature (client portal + admin panel).
 * Mirrors the per-feature i18n discipline of cargoAr / medevacAr / privilegeAr:
 * every user-visible Support string lives here so the surface is reviewable in
 * isolation. Shared across the client and admin Support surfaces.
 */
export const supportAr = {
  // nav
  nav: 'الدعم',

  // client pages
  centerTitle: 'مركز الدعم',
  newTicketTitle: 'فتح تذكرة جديدة',
  myTicketsTitle: 'تذاكري',
  noTicketsClient: 'لا توجد تذاكر بعد.',
  viewConversation: 'عرض المحادثة',
  backToTickets: 'العودة إلى التذاكر',
  ticketClosed: 'هذه التذكرة مغلقة.',
  addReplyTitle: 'إضافة رد',

  // admin pages
  adminTicketsTitle: 'تذاكر الدعم',
  noTicketsAdmin: 'لا توجد تذاكر.',
  adminReplyTitle: 'الرد على العميل',
  openAction: 'فتح',
  thNumber: 'الرقم',
  thSubject: 'الموضوع',
  thCategory: 'التصنيف',
  thStatus: 'الحالة',
  thUpdated: 'آخر تحديث',

  // ticket form
  fieldCategory: 'التصنيف',
  fieldSubject: 'الموضوع',
  fieldDescription: 'وصف المشكلة',
  submitOpen: 'فتح تذكرة',
  submitting: 'جارٍ الإرسال...',

  // reply form
  fieldReply: 'ردّك',
  submitReply: 'إرسال الرد',

  // status form
  submitUpdate: 'تحديث',
  updating: '...',
  resolutionPlaceholder: 'ملاحظة الحل (اختياري)',

  // thread
  noMessages: 'لا توجد رسائل في هذه التذكرة بعد.',
  staffName: 'فريق الدعم',
  clientName: 'العميل',

  // category labels
  categoryBooking: 'الحجوزات',
  categoryPayment: 'المدفوعات',
  categoryRefund: 'الاسترداد',
  categoryComplaint: 'شكوى',
  categoryOther: 'أخرى',

  // status labels
  statusOpen: 'مفتوحة',
  statusInProgress: 'قيد المعالجة',
  statusResolved: 'تم الحل',
  statusClosed: 'مغلقة',

  // validation messages
  invalidCategory: 'اختر تصنيفًا صالحًا',
  subjectRequired: 'مطلوب عنوان للتذكرة',
  subjectTooLong: 'العنوان طويل جدًا',
  descRequired: 'مطلوب وصف للمشكلة',
  descTooLong: 'الوصف طويل جدًا',
  invalidTicketId: 'معرّف التذكرة غير صالح',
  bodyEmpty: 'الرسالة فارغة',
  bodyTooLong: 'الرسالة طويلة جدًا',
  invalidStatus: 'حالة غير صالحة',
  resolutionTooLong: 'النص طويل جدًا',

  // action results
  actionInvalid: 'تحقق من البيانات المدخلة',
  createError: 'تعذّر فتح التذكرة، حاول مرة أخرى',
  createSuccess: 'تم فتح تذكرة الدعم بنجاح',
  replyError: 'تعذّر إرسال الرد، حاول مرة أخرى',
  replyCannot: 'لا يمكن الرد على هذه التذكرة',
  replySuccess: 'تم إرسال ردّك',
  adminReplySuccess: 'تم إرسال الرد',
  statusUpdateError: 'تعذّر تحديث الحالة، حاول مرة أخرى',
  statusUpdateSuccess: 'تم تحديث حالة التذكرة',
} as const;
