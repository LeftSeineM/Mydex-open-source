import 'package:flutter/widgets.dart';

// Scale whitespace with the effective font size, without shrinking tap targets.
// 100% and larger keep the established spacing; small fonts get denser layouts.
double compactFactor(BuildContext context) =>
    MediaQuery.textScalerOf(context).scale(1).clamp(.6, 1.0);
double compactGap(BuildContext context, double value) =>
    value * compactFactor(context);
EdgeInsets compactInsets(BuildContext context, EdgeInsets value) {
  final scale = compactFactor(context);
  final horizontal = .75 + .25 * scale;
  return EdgeInsets.fromLTRB(value.left * horizontal, value.top * scale,
      value.right * horizontal, value.bottom * scale);
}

double compactLineHeight(BuildContext context, double normal) =>
    normal - (1 - compactFactor(context)) * .25;
