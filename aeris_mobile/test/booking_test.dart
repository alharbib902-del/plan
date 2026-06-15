import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/bookings/booking.dart';

void main() {
  group('Booking.fromJson', () {
    test('parses the serializer allowlist shape', () {
      final b = Booking.fromJson({
        'id': 'b1',
        'booking_number': 'BK-1001',
        'route_origin_label': 'RUH',
        'route_destination_label': 'JED',
        'passengers': 4,
        'return_scheduled': true,
        'aircraft': 'Gulfstream G650',
        'operator_name': 'Skybridge',
        'base_amount': 100000,
        'addons_amount': 5000,
        'vat_amount': 15750,
        'total_amount': 120750,
        'payment_status': 'pending_offline',
        'flight_status': 'confirmed',
        'departure_scheduled': '2026-07-01T10:00:00Z',
        'zatca_invoice_url': 'https://x/inv',
        'loyalty_points_earned': 1200,
      });
      expect(b.id, 'b1');
      expect(b.bookingNumber, 'BK-1001');
      expect(b.passengers, 4);
      expect(b.returnScheduled, isTrue);
      expect(b.totalAmount, 120750);
      expect(b.paymentStatus, 'pending_offline');
      expect(b.flightStatus, 'confirmed');
      expect(b.loyaltyPointsEarned, 1200);
      expect(b.routeLabel, 'RUH إلى JED');
    });

    test('tolerates missing/partial fields with safe defaults', () {
      final b = Booking.fromJson({'id': 'b2'});
      expect(b.id, 'b2');
      expect(b.passengers, 0);
      expect(b.returnScheduled, isFalse);
      expect(b.totalAmount, isNull);
      expect(b.loyaltyPointsEarned, isNull);
      expect(b.aircraft, isNull);
    });

    test('coerces a numeric string amount', () {
      final b = Booking.fromJson({'id': 'b3', 'total_amount': '999.5'});
      expect(b.totalAmount, 999.5);
    });
  });

  group('status labels', () {
    test('flightStatusAr maps known codes, falls back to the raw code', () {
      expect(flightStatusAr('completed'), 'مكتمل');
      expect(flightStatusAr('cancelled'), 'ملغى');
      expect(flightStatusAr('confirmed'), 'مؤكّد');
      expect(flightStatusAr('weird_unknown'), 'weird_unknown');
    });

    test('paymentStatusAr maps known codes, falls back to the raw code', () {
      expect(paymentStatusAr('paid'), 'مدفوع');
      expect(paymentStatusAr('pending_offline'), 'بانتظار الدفع');
      expect(paymentStatusAr('refunded'), 'مسترجع');
      expect(paymentStatusAr('weird_unknown'), 'weird_unknown');
    });
  });
}
