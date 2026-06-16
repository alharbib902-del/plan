import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/empty_legs/alert.dart';
import 'package:aeris_mobile/src/empty_legs/empty_leg.dart';

void main() {
  group('EmptyLeg.fromJson', () {
    test('parses with pricing VISIBLE (prices spread top-level)', () {
      final leg = EmptyLeg.fromJson({
        'id': 'el-1',
        'leg_number': 'EL-1001',
        'status': 'available',
        'departure_iata': 'RUH',
        'arrival_iata': 'JED',
        'departure_label': 'الرياض',
        'arrival_label': 'جدة',
        'departure_window_start': '2026-08-01T08:00:00Z',
        'departure_window_end': '2026-08-01T18:00:00Z',
        'aircraft': 'Phenom 300',
        'max_passengers': 7,
        'current_discount_pct': 25,
        'is_reserved': false,
        'is_reserved_by_me': false,
        'pricing_visible': true,
        'original_price_sar': 80000,
        'current_price_sar': 60000,
      });
      expect(leg.id, 'el-1');
      expect(leg.legNumber, 'EL-1001');
      expect(leg.maxPassengers, 7);
      expect(leg.currentDiscountPct, 25);
      expect(leg.pricingVisible, isTrue);
      expect(leg.currentPriceSar, 60000);
      expect(leg.originalPriceSar, 80000);
      expect(leg.routeLabel, 'الرياض إلى جدة');
    });

    test('pricing HIDDEN → prices null, pricingVisible false', () {
      final leg = EmptyLeg.fromJson({
        'id': 'el-2',
        'leg_number': 'EL-2',
        'status': 'available',
        'pricing_visible': false,
      });
      expect(leg.pricingVisible, isFalse);
      expect(leg.currentPriceSar, isNull);
      expect(leg.originalPriceSar, isNull);
    });

    test('reservation label prefers "محجوزة لك" then status', () {
      final mine = EmptyLeg.fromJson(
          {'id': 'a', 'leg_number': 'EL-3', 'status': 'reserved', 'is_reserved_by_me': true});
      expect(emptyLegReservationLabel(mine), 'محجوزة لك');
      final avail =
          EmptyLeg.fromJson({'id': 'b', 'leg_number': 'EL-4', 'status': 'available'});
      expect(emptyLegReservationLabel(avail), 'متاحة');
    });

    test('emptyLegStatusAr maps known, falls back', () {
      expect(emptyLegStatusAr('sold'), 'مباعة');
      expect(emptyLegStatusAr('cancelled'), 'ملغاة');
      expect(emptyLegStatusAr('???'), '???');
    });
  });

  group('MatchedLeg.fromJson', () {
    test('wraps the leg + notification meta', () {
      final m = MatchedLeg.fromJson({
        'notification': {
          'id': 'n1',
          'sent_at': '2026-07-20T10:00:00Z',
          'event_type': 'price_drop',
          'channel': 'whatsapp',
        },
        'leg': {'id': 'el-9', 'leg_number': 'EL-9', 'status': 'available'},
      });
      expect(m.leg.legNumber, 'EL-9');
      expect(m.notificationEventType, 'price_drop');
      expect(m.notificationSentAt, '2026-07-20T10:00:00Z');
    });
  });

  group('Alert', () {
    test('fromJson parses channels + price + active', () {
      final a = Alert.fromJson({
        'id': 'a1',
        'origin_iata': 'RUH',
        'destination_iata': 'JED',
        'max_price_sar': 50000,
        'date_from': '2026-08-01',
        'date_to': '2026-08-31',
        'channels': ['whatsapp', 'email'],
        'is_active': true,
      });
      expect(a.id, 'a1');
      expect(a.maxPriceSar, 50000);
      expect(a.channels, ['whatsapp', 'email']);
      expect(a.isActive, isTrue);
      expect(a.routeLabel, 'RUH إلى JED');
    });

    test('defaults: empty channels, inactive when flag absent', () {
      final a = Alert.fromJson({'id': 'a2'});
      expect(a.channels, isEmpty);
      expect(a.isActive, isFalse);
      expect(a.maxPriceSar, isNull);
    });
  });

  group('CreateAlertInput.toJson', () {
    test('required iatas; omits null optionals', () {
      final json = const CreateAlertInput(
        originIata: 'RUH',
        destinationIata: 'JED',
      ).toJson();
      expect(json['origin_iata'], 'RUH');
      expect(json['destination_iata'], 'JED');
      expect(json.containsKey('max_price_sar'), isFalse);
      expect(json.containsKey('date_from'), isFalse);
      expect(json.containsKey('date_to'), isFalse);
    });

    test('includes optionals when present', () {
      final json = const CreateAlertInput(
        originIata: 'RUH',
        destinationIata: 'JED',
        maxPriceSar: 40000,
        dateFrom: '2026-08-01',
        dateTo: '2026-08-31',
      ).toJson();
      expect(json['max_price_sar'], 40000);
      expect(json['date_from'], '2026-08-01');
      expect(json['date_to'], '2026-08-31');
    });
  });
}
