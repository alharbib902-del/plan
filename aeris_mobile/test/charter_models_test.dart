import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/charter/airport.dart';
import 'package:aeris_mobile/src/charter/charter_repository.dart';
import 'package:aeris_mobile/src/charter/offer.dart';
import 'package:aeris_mobile/src/charter/trip_request.dart';

void main() {
  group('TripRequest', () {
    test('fromJson parses the serializer shape', () {
      final t = TripRequest.fromJson({
        'id': 't1',
        'request_number': 'TR-100',
        'status': 'offered',
        'trip_type': 'charter',
        'departure_iata': 'RUH',
        'arrival_iata': 'JED',
        'departure_date': '2026-08-01T12:00:00Z',
        'return_date': null,
        'passengers': 3,
        'aircraft_pref': 'mid',
        'special_requests': 'سيارة',
        'can_cancel': true,
        'can_accept_offers': true,
      });
      expect(t.id, 't1');
      expect(t.status, 'offered');
      expect(t.passengers, 3);
      expect(t.canAcceptOffers, isTrue);
      expect(t.routeLabel, 'RUH إلى JED');
    });

    test('defaults on partial json', () {
      final t = TripRequest.fromJson({'id': 't2'});
      expect(t.passengers, 0);
      expect(t.canCancel, isFalse);
      expect(t.aircraftPref, isNull);
    });

    test('status + aircraft labels map known codes, fall back otherwise', () {
      expect(tripStatusAr('offered'), 'يوجد عروض');
      expect(tripStatusAr('cancelled'), 'ملغى');
      expect(tripStatusAr('???'), '???');
      expect(aircraftPrefAr('super_mid'), 'فوق المتوسطة');
      expect(aircraftPrefAr(null), isNull);
      expect(aircraftPrefAr('weird'), 'weird');
    });
  });

  group('Offer', () {
    test('fromJson parses + coerces price', () {
      final o = Offer.fromJson({
        'id': 'o1',
        'source': 'phase4',
        'status': 'pending',
        'operator_name': 'Skybridge',
        'total_price_sar': '125000',
        'can_accept': true,
        'can_decline': true,
      });
      expect(o.id, 'o1');
      expect(o.source, 'phase4');
      expect(o.totalPriceSar, 125000);
      expect(o.canAccept, isTrue);
    });

    test('offerStatusAr maps known, falls back', () {
      expect(offerStatusAr('accepted'), 'مقبول');
      expect(offerStatusAr('rejected'), 'مرفوض');
      expect(offerStatusAr('???'), '???');
    });
  });

  group('Airport', () {
    test('fromJson + Arabic-first labels', () {
      final a = Airport.fromJson({
        'iata_code': 'RUH',
        'name': 'King Khalid Intl',
        'name_ar': 'مطار الملك خالد',
        'city': 'Riyadh',
        'city_ar': 'الرياض',
        'is_private_capable': true,
      });
      expect(a.iataCode, 'RUH');
      expect(a.cityLabel, 'الرياض');
      expect(a.nameLabel, 'مطار الملك خالد');
      expect(a.displayLabel, 'RUH · الرياض');
    });

    test('falls back to English then IATA when Arabic absent', () {
      final a = Airport.fromJson({'iata_code': 'XYZ', 'city': 'Town'});
      expect(a.cityLabel, 'Town');
      expect(a.nameLabel, 'XYZ');
    });
  });

  group('CreateTripRequestInput.toJson', () {
    test('builds legs + top-level fields; omits empty optionals', () {
      final json = const CreateTripRequestInput(
        departureIata: 'RUH',
        arrivalIata: 'JED',
        departureDateIso: '2026-08-01T12:00:00Z',
        passengers: 2,
      ).toJson();
      expect(json['departure_iata'], 'RUH');
      expect(json['arrival_iata'], 'JED');
      expect(json['passengers'], 2);
      expect(json['legs'], [
        {'from': 'RUH', 'to': 'JED', 'date': '2026-08-01T12:00:00Z'},
      ]);
      expect(json.containsKey('return_date'), isFalse);
      expect(json.containsKey('aircraft_pref'), isFalse);
      expect(json.containsKey('special_requests'), isFalse);
    });

    test('includes optionals when present', () {
      final json = const CreateTripRequestInput(
        departureIata: 'RUH',
        arrivalIata: 'JED',
        departureDateIso: '2026-08-01T12:00:00Z',
        returnDateIso: '2026-08-05T12:00:00Z',
        passengers: 4,
        aircraftPref: 'heavy',
        specialRequests: '  catering  ',
      ).toJson();
      expect(json['return_date'], '2026-08-05T12:00:00Z');
      expect(json['aircraft_pref'], 'heavy');
      expect(json['special_requests'], 'catering'); // trimmed
    });
  });
}
