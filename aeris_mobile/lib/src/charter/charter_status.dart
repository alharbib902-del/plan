import 'package:flutter/material.dart';

import '../theme/aeris_theme.dart';

const Color _success = Color(0xFF3FB68B);

/// Tint for a trip-request status pill.
Color tripStatusColor(String code) => switch (code) {
      'booked' => _success,
      'cancelled' => AerisColors.danger,
      _ => AerisColors.gold,
    };

/// Tint for an offer status pill.
Color offerStatusColor(String code) => switch (code) {
      'accepted' => _success,
      'rejected' => AerisColors.danger,
      'expired' => AerisColors.inkMuted,
      _ => AerisColors.gold,
    };
