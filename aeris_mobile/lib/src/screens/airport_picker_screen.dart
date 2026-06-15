import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../charter/airport.dart';
import '../charter/airports_repository.dart';
import '../core/app_exception.dart';
import '../theme/aeris_theme.dart';
import '../widgets/async_states.dart';

/// Full-screen searchable airport picker. Pushed via Navigator and pops the
/// selected [Airport] (or null if dismissed). A dead-session 401 mid-search
/// is handled app-wide (token cleared + bounce to /login).
class AirportPickerScreen extends ConsumerStatefulWidget {
  const AirportPickerScreen({super.key});

  @override
  ConsumerState<AirportPickerScreen> createState() =>
      _AirportPickerScreenState();
}

class _AirportPickerScreenState extends ConsumerState<AirportPickerScreen> {
  final _controller = TextEditingController();
  Timer? _debounce;
  bool _loading = true;
  String? _errorAr;
  List<Airport> _results = const [];
  int _reqSeq = 0; // guards against out-of-order async responses

  @override
  void initState() {
    super.initState();
    _search('');
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () => _search(value));
  }

  Future<void> _search(String query) async {
    final seq = ++_reqSeq;
    setState(() {
      _loading = true;
      _errorAr = null;
    });
    try {
      final results =
          await ref.read(airportsRepositoryProvider).search(query);
      if (!mounted || seq != _reqSeq) return; // a newer query superseded this
      setState(() {
        _results = results;
        _loading = false;
      });
    } on AppException catch (e) {
      if (!mounted || seq != _reqSeq) return;
      setState(() {
        _errorAr = e.messageAr;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || seq != _reqSeq) return;
      setState(() {
        _errorAr = errorMessageAr('unknown');
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('اختر المطار')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: _controller,
              autofocus: true,
              onChanged: _onChanged,
              decoration: const InputDecoration(
                labelText: 'ابحث بالمدينة أو الرمز (RUH)',
                prefixIcon: Icon(Icons.search),
              ),
            ),
          ),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading) return const LoadingState();
    if (_errorAr != null) {
      return ErrorState(
        message: _errorAr!,
        onRetry: () => _search(_controller.text),
      );
    }
    if (_results.isEmpty) {
      return const EmptyState(
        icon: Icons.flight_outlined,
        message: 'لا توجد مطارات مطابقة',
      );
    }
    return ListView.separated(
      itemCount: _results.length,
      separatorBuilder: (_, _) =>
          const Divider(height: 1, color: AerisColors.border),
      itemBuilder: (_, i) {
        final a = _results[i];
        return ListTile(
          title: Text(
            '${a.iataCode} · ${a.cityLabel}',
            style: const TextStyle(color: AerisColors.inkPrimary),
          ),
          subtitle: Text(
            a.nameLabel,
            style: const TextStyle(color: AerisColors.inkSecondary),
          ),
          onTap: () => Navigator.of(context).pop(a),
        );
      },
    );
  }
}
