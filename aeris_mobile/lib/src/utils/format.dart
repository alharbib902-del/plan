import 'package:intl/intl.dart';

/// SAR amount with thousands grouping + Western digits (Aeris identity),
/// e.g. 12500 -> "12,500 ريال". Capped at 2 fraction digits (money is
/// 2dp; never render 15,750.555). Null -> em dash.
String formatSar(num? amount) {
  if (amount == null) return '—';
  final fmt = NumberFormat.decimalPattern('en')..maximumFractionDigits = 2;
  return '${fmt.format(amount)} ريال';
}

/// ISO timestamp -> "yyyy/MM/dd" (device-local, Western digits).
/// Formatted manually (no DateFormat) so it needs no locale data and the
/// digits are always Western. Null/empty/unparseable -> null.
String? formatDate(String? iso) {
  final dt = _parse(iso);
  return dt == null ? null : '${dt.year}/${_two(dt.month)}/${_two(dt.day)}';
}

/// ISO timestamp -> "yyyy/MM/dd HH:mm" (device-local, Western digits).
String? formatDateTime(String? iso) {
  final dt = _parse(iso);
  if (dt == null) return null;
  return '${dt.year}/${_two(dt.month)}/${_two(dt.day)} '
      '${_two(dt.hour)}:${_two(dt.minute)}';
}

String _two(int n) => n.toString().padLeft(2, '0');

DateTime? _parse(String? iso) {
  if (iso == null || iso.isEmpty) return null;
  return DateTime.tryParse(iso)?.toLocal();
}
