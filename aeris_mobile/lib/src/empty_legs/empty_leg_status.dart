import 'package:flutter/material.dart';

import '../theme/aeris_theme.dart';
import 'empty_leg.dart';

const Color emptyLegSuccess = Color(0xFF3FB68B);

/// Tint for an empty-leg reservation/status pill — shared by the list card
/// and the detail header so they never diverge.
Color emptyLegPillColor(EmptyLeg leg) {
  if (leg.isReservedByMe) return emptyLegSuccess;
  return switch (leg.status) {
    'available' => emptyLegSuccess,
    'reserved' => AerisColors.gold,
    _ => AerisColors.inkMuted, // sold / expired / cancelled
  };
}
