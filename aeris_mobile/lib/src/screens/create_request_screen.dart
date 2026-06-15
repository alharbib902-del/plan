import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../charter/airport.dart';
import '../charter/charter_repository.dart';
import '../charter/trip_request.dart';
import '../core/app_exception.dart';
import '../theme/aeris_theme.dart';
import '../utils/format.dart';
import '../widgets/error_banner.dart';
import 'airport_picker_screen.dart';

/// Charter request form: pick airports + dates + passengers, submit, then land
/// on the new request's detail. Mutation is rate-limited server-side; on
/// failure the typed error / field_errors surface inline (no double-submit:
/// the button is disabled while submitting).
class CreateRequestScreen extends ConsumerStatefulWidget {
  const CreateRequestScreen({super.key});

  @override
  ConsumerState<CreateRequestScreen> createState() =>
      _CreateRequestScreenState();
}

class _CreateRequestScreenState extends ConsumerState<CreateRequestScreen> {
  Airport? _from;
  Airport? _to;
  DateTime? _departure;
  DateTime? _return;
  int _passengers = 1;
  String? _aircraftPref;
  final _special = TextEditingController();

  bool _submitting = false;
  String? _errorAr;
  String? _fieldError; // first inline validation message

  @override
  void dispose() {
    _special.dispose();
    super.dispose();
  }

  Future<void> _pick({required bool isFrom}) async {
    final picked = await Navigator.of(context).push<Airport>(
      MaterialPageRoute(builder: (_) => const AirportPickerScreen()),
    );
    if (picked == null) return;
    setState(() {
      if (isFrom) {
        _from = picked;
      } else {
        _to = picked;
      }
      _fieldError = null;
    });
  }

  Future<void> _pickDate({required bool isReturn}) async {
    final now = DateTime.now();
    final first = isReturn
        ? (_departure ?? now).add(const Duration(days: 1))
        : now.add(const Duration(days: 1));
    final initial = isReturn ? first : (_departure ?? first);
    // lastDate is relative to `first` (not `now`) so it can never fall before
    // firstDate — e.g. a departure on the last allowed day would otherwise push
    // the return's firstDate past a now-based lastDate and crash showDatePicker.
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: first,
      lastDate: first.add(const Duration(days: 365 * 2)),
    );
    if (picked == null) return;
    setState(() {
      final atNoon = DateTime(picked.year, picked.month, picked.day, 12);
      if (isReturn) {
        _return = atNoon;
      } else {
        _departure = atNoon;
        // Drop a now-invalid return date (must stay after departure).
        if (_return != null && !_return!.isAfter(atNoon)) _return = null;
      }
      _fieldError = null;
    });
  }

  String? _validate() {
    if (_from == null) return 'اختر مطار المغادرة';
    if (_to == null) return 'اختر مطار الوصول';
    if (_from!.iataCode == _to!.iataCode) {
      return 'مطار المغادرة والوصول يجب أن يختلفا';
    }
    if (_departure == null) return 'اختر تاريخ المغادرة';
    return null;
  }

  Future<void> _submit() async {
    final invalid = _validate();
    if (invalid != null) {
      setState(() => _fieldError = invalid);
      return;
    }
    setState(() {
      _submitting = true;
      _errorAr = null;
      _fieldError = null;
    });
    final input = CreateTripRequestInput(
      departureIata: _from!.iataCode,
      arrivalIata: _to!.iataCode,
      departureDateIso: _departure!.toUtc().toIso8601String(),
      returnDateIso: _return?.toUtc().toIso8601String(),
      passengers: _passengers,
      aircraftPref: _aircraftPref,
      specialRequests: _special.text,
    );
    try {
      final id = await ref.read(charterRepositoryProvider).create(input);
      ref.invalidate(charterRequestsProvider); // list refetches the new request
      if (!mounted) return;
      // Land on the new request's detail, replacing the form.
      context.pushReplacement('/requests/$id');
    } on AppException catch (e) {
      if (!mounted) return;
      final fe = e.fieldErrors;
      setState(() {
        _submitting = false;
        _errorAr = e.messageAr;
        _fieldError = (fe != null && fe.isNotEmpty) ? fe.values.first : null;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _errorAr = errorMessageAr('unknown');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('طلب رحلة خاصة')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            if (_errorAr != null) ...[
              ErrorBanner(message: _errorAr!),
              const SizedBox(height: 16),
            ],
            _airportField('من', _from, () => _pick(isFrom: true)),
            const SizedBox(height: 12),
            _airportField('إلى', _to, () => _pick(isFrom: false)),
            const SizedBox(height: 12),
            _dateField(
              'تاريخ المغادرة',
              _departure,
              () => _pickDate(isReturn: false),
            ),
            const SizedBox(height: 12),
            _dateField(
              'تاريخ العودة (اختياري)',
              _return,
              () => _pickDate(isReturn: true),
              onClear: _return == null ? null : () => setState(() => _return = null),
            ),
            const SizedBox(height: 16),
            _passengersField(),
            const SizedBox(height: 16),
            _aircraftField(),
            const SizedBox(height: 16),
            TextField(
              controller: _special,
              enabled: !_submitting,
              maxLines: 3,
              maxLength: 2000,
              decoration: const InputDecoration(
                labelText: 'طلبات خاصة (اختياري)',
              ),
            ),
            if (_fieldError != null) ...[
              const SizedBox(height: 4),
              Text(
                _fieldError!,
                style: const TextStyle(color: AerisColors.danger),
              ),
            ],
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: _submitting ? null : _submit,
              child: _submitting
                  ? const SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.5,
                        color: AerisColors.navy,
                      ),
                    )
                  : const Text('إرسال الطلب'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _airportField(String label, Airport? value, VoidCallback onTap) {
    return InkWell(
      onTap: _submitting ? null : onTap,
      borderRadius: BorderRadius.circular(12),
      child: InputDecorator(
        decoration: InputDecoration(labelText: label),
        child: Text(
          value == null ? 'اختر المطار' : value.displayLabel,
          style: TextStyle(
            color: value == null
                ? AerisColors.inkMuted
                : AerisColors.inkPrimary,
          ),
        ),
      ),
    );
  }

  Widget _dateField(
    String label,
    DateTime? value,
    VoidCallback onTap, {
    VoidCallback? onClear,
  }) {
    return InkWell(
      onTap: _submitting ? null : onTap,
      borderRadius: BorderRadius.circular(12),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          suffixIcon: onClear == null
              ? const Icon(Icons.calendar_today, size: 18)
              : IconButton(
                  icon: const Icon(Icons.clear, size: 18),
                  onPressed: _submitting ? null : onClear,
                ),
        ),
        child: Text(
          value == null
              ? 'اختر التاريخ'
              : (formatDate(value.toIso8601String()) ?? ''),
          style: TextStyle(
            color: value == null
                ? AerisColors.inkMuted
                : AerisColors.inkPrimary,
          ),
        ),
      ),
    );
  }

  Widget _passengersField() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        const Text('عدد الركّاب', style: TextStyle(color: AerisColors.inkSecondary)),
        Row(
          children: [
            IconButton(
              icon: const Icon(Icons.remove_circle_outline),
              color: AerisColors.gold,
              onPressed: (_submitting || _passengers <= 1)
                  ? null
                  : () => setState(() => _passengers--),
            ),
            Text(
              '$_passengers',
              style: const TextStyle(
                color: AerisColors.inkPrimary,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
            IconButton(
              icon: const Icon(Icons.add_circle_outline),
              color: AerisColors.gold,
              onPressed: (_submitting || _passengers >= 19)
                  ? null
                  : () => setState(() => _passengers++),
            ),
          ],
        ),
      ],
    );
  }

  Widget _aircraftField() {
    return DropdownButtonFormField<String?>(
      initialValue: _aircraftPref,
      decoration: const InputDecoration(labelText: 'تفضيل الطائرة (اختياري)'),
      items: [
        const DropdownMenuItem<String?>(value: null, child: Text('بدون تفضيل')),
        for (final o in aircraftPrefOptions)
          DropdownMenuItem<String?>(value: o.value, child: Text(o.label)),
      ],
      onChanged: _submitting ? null : (v) => setState(() => _aircraftPref = v),
    );
  }
}
