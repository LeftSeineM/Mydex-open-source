// Browser-only implementation selected by a conditional export.
// ignore_for_file: avoid_web_libraries_in_flutter
import 'dart:html' as html;
import 'dart:convert';

void openAccountPortal() => html.window.location.assign('/connect/');
Future<void> removeWebComputer(String address) async {
  final uri = Uri.parse(address);
  final id =
      RegExp(r'^/c/([A-Za-z0-9_-]{43})/?$').firstMatch(uri.path)?.group(1);
  if (uri.origin != Uri.base.origin || id == null) {
    throw const FormatException('无效的电脑连接');
  }
  await html.HttpRequest.request('/relay/device/revoke',
      method: 'POST',
      withCredentials: true,
      requestHeaders: {'Content-Type': 'application/json'},
      sendData: jsonEncode({'id': id}));
  html.window.sessionStorage.remove('mydex.connection');
  html.window.sessionStorage.remove('mydex.profiles');
}
