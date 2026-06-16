import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../charter/airport.dart';
import '../core/app_exception.dart';
import '../empty_legs/alert.dart';
import '../empty_legs/empty_legs_repository.dart';
import '../theme/aeris_theme.dart';
import '../widgets/error_banner.dart';
import 'airport_picker_screen.dart';

/// Create an empty-leg price alert: origin + destination (distinct) + optional
/// max price + optional date range (YYYY-MM-DD, date_to >= date_from). On
/// success invalidates the alerts list and pops. Rate-limited; no double-submit
/// (button disabled in flight).
class CreateAlertScreen extends ConsumerStatefulWidget {
  const CreateAlertScreen({super.key});

  @override
  ConsumerState<CreateAlertScreen> createState() => _CreateAlertScreenState();
}

class _CreateAlertScreenState extends ConsumerState<CreateAlertScreen> {
  Airport? _from;
  Airport? _to;
  DateTime? _dateFrom;
  DateTime? _dateTo;
  final _maxPrice = TextEditingController();

  bool _submitting = false;
  String? _errorAr;
  String? _fieldError;

  @override
  void dispose() {
    _maxPrice.dispose();
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

  Future<void> _pickDate({required bool isTo}) async {
    final now = DateTime.now();
    final first = isTo ? (_dateFrom ?? now) : now;
    final picked = await showDatePicker(
      context: context,
      initialDate: isTo ? first : (_dateFrom ?? now),
      firstDate: first,
      lastDate: first.add(const Duration(days: 365 * 2)),
    );
    if (picked == null) return;
    setState(() {
      if (isTo) {
        _dateTo = picked;
      } else {
        _dateFrom = picked;
        if (_dateTo != null && _dateTo!.isBefore(picked)) _dateTo = null;
      }
      _fieldError = null;
    });
  }

  String _ymd(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  String? _validate() {
    if (_from == null) return 'اختر مطار المغادرة';
    if (_to == null) return 'اختر مطار الوصول';
    if (_from!.iataCode == _to!.iataCode) {
      return 'مطار المغادرة والوصول يجب أن يختلفا';
    }
    final priceText = _maxPrice.text.trim();
    if (priceText.isNotEmpty) {
      final p = num.tryParse(priceText);
      if (p == null || p <= 0) return 'أدخل سعراً صحيحاً';
    }
    return null;
  }

  Future<void> _submit() async {
    final invalid = _validate();
    if (invalid != null) {
      setState(() => _fieldError = invalid);
      return;
    }
    if (_submitting) return;
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    setState(() {
      _submitting = true;
      _errorAr = null;
      _fieldError = null;
    });
    final priceText = _maxPrice.text.trim();
    final input = CreateAlertInput(
      originIata: _from!.iataCode,
      destinationIata: _to!.iataCode,
      maxPriceSar: priceText.isEmpty ? null : num.tryParse(priceText),
      dateFrom: _dateFrom == null ? null : _ymd(_dateFrom!),
      dateTo: _dateTo == null ? null : _ymd(_dateTo!),
    );
    try {
      await ref.read(emptyLegsRepositoryProvider).createAlert(input);
      ref.invalidate(emptyLegAlertsProvider);
      if (!mounted) return;
      messenger
        ..clearSnackBars()
        ..showSnackBar(const SnackBar(content: Text('تم إنشاء التنبيه')));
      navigator.pop();
    } on AppException catch (e) {
      if (!mounted) return;
      final fe = e.fieldErrors;
      final s = e.retryAfterSeconds;
      setState(() {
        _submitting = false;
        _errorAr = (e.code == 'rate_limited' && s != null)
            ? 'محاولات كثيرة، حاول بعد $s ثانية'
            : e.messageAr;
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
      appBar: AppBar(title: const Text('تنبيه سعر جديد')),
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
            TextField(
              controller: _maxPrice,
              enabled: !_submitting,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'أقصى سعر (اختياري) — ريال',
              ),
            ),
            const SizedBox(height: 12),
            _dateField('من تاريخ (اختياري)', _dateFrom,
                () => _pickDate(isTo: false),
                onClear:
                    _dateFrom == null ? null : () => setState(() => _dateFrom = null)),
            const SizedBox(height: 12),
            _dateField('إلى تاريخ (اختياري)', _dateTo, () => _pickDate(isTo: true),
                onClear:
                    _dateTo == null ? null : () => setState(() => _dateTo = null)),
            if (_fieldError != null) ...[
              const SizedBox(height: 8),
              Text(_fieldError!,
                  style: const TextStyle(color: AerisColors.danger)),
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
                  : const Text('إنشاء التنبيه'),
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
            color:
                value == null ? AerisColors.inkMuted : AerisColors.inkPrimary,
          ),
        ),
      ),
    );
  }

  Widget _dateField(String label, DateTime? value, VoidCallback onTap,
      {VoidCallback? onClear}) {
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
          value == null ? 'اختر التاريخ' : _ymd(value),
          style: TextStyle(
            color:
                value == null ? AerisColors.inkMuted : AerisColors.inkPrimary,
          ),
        ),
      ),
    );
  }
}
