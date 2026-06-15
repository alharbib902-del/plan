import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/utils/format.dart';

void main() {
  group('formatSar', () {
    test('groups thousands with Western digits + ريال suffix', () {
      expect(formatSar(12500), '12,500 ريال');
      expect(formatSar(0), '0 ريال');
    });
    test('null -> em dash', () => expect(formatSar(null), '—'));
    test('caps at 2 fraction digits (money)', () {
      expect(formatSar(15750.555), '15,750.56 ريال'); // rounded, not .555
      expect(formatSar(100.5), '100.5 ريال'); // no forced trailing zeros
    });
  });

  group('formatDate / formatDateTime', () {
    test('null / empty / unparseable -> null', () {
      expect(formatDate(null), isNull);
      expect(formatDate(''), isNull);
      expect(formatDate('not-a-date'), isNull);
      expect(formatDateTime(null), isNull);
    });

    test('valid ISO -> expected pattern (Western digits)', () {
      // Assert the shape, not an exact value (toLocal is tz-dependent).
      expect(formatDate('2026-07-01T12:00:00Z'), matches(r'^\d{4}/\d{2}/\d{2}$'));
      expect(
        formatDateTime('2026-07-01T12:00:00Z'),
        matches(r'^\d{4}/\d{2}/\d{2} \d{2}:\d{2}$'),
      );
    });
  });
}
