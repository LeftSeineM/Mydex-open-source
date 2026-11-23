// ignore_for_file: avoid_web_libraries_in_flutter
import 'dart:html' as html;
import 'dart:typed_data';
import 'package:flutter/services.dart';

/// One same-origin font covers Latin and CJK, so measurement and rendering do
/// not select different system fallback fonts on mobile browsers.
Future<void> prepareWebFont() async {
  try {
    final response = await html.HttpRequest.request('fonts/mydex-sans-sc.woff2',
            responseType: 'arraybuffer')
        .timeout(const Duration(seconds: 30));
    final loader = FontLoader('MydexSans')
      ..addFont(Future.value(ByteData.view(response.response as ByteBuffer)));
    await loader.load();
  } catch (_) {
    // The app remains usable when a font request fails; system fonts are the
    // fallback. No font request goes to Google or another external CDN.
  }
}
