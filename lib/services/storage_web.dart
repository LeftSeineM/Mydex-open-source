// Browser-only implementation selected by a conditional export.
// ignore_for_file: avoid_web_libraries_in_flutter
import 'dart:convert';
import 'dart:html' as html;
import '../models.dart';
import 'package:crypto/crypto.dart';
import 'router_web_lock.dart';

/// Browser session storage is NOT Android Keystore. Credentials deliberately
/// expire with this browser session; conversation history is not persisted.
class LocalStorage {
  Future<void> withRouterLock(Future<void> Function() action) async {
    final owner = await _creationStorageKey();
    await withRouterWebLock('$owner.routerCommands.v1', () async {
      if (await _creationStorageKey() != owner) throw StateError('账号已改变');
      await action();
    });
  }
  String? _creationOwner;
  Future<String> _creationStorageKey() async {
    final response=await html.HttpRequest.request('/relay/me',withCredentials:true);
    final account=jsonDecode(response.responseText ?? '{}')['username'];
    if(account is! String||account.isEmpty)throw StateError('请先登录自己的账号');
    final key='mydex.dshCreateOutbox.v1.${sha256.convert(utf8.encode('${html.window.location.origin}|${account.toLowerCase()}'))}';
    if(_creationOwner!=null&&_creationOwner!=key)throw StateError('账号已改变，请重新打开会话页面');
    _creationOwner=key;return key;
  }
  final _store = html.window.sessionStorage;
  // Only font size persists on this browser. It is not an account preference.
  double _fontScale(dynamic fallback) {
    try {
      final n =
          double.tryParse(html.window.localStorage['mydex.textScale'] ?? '');
      if (n != null && n.isFinite && n >= .6 && n <= 2) return n;
    } catch (_) {}
    return fallback is num ? fallback.toDouble().clamp(.6, 2) : 1;
  }

  Future<bool> testFeatures({bool seed = false}) async {
    if (seed) _store['mydex.testFeatures'] = 'true';
    return seed || _store['mydex.testFeatures'] == 'true';
  }

  Future<ConnectionSettings> settings() async {
    if (_store['mydex.connection'] == null) {
      html.window.location.replace('/connect/');
      return const ConnectionSettings();
    }
    final value =
        Map<String, dynamic>.from(jsonDecode(_store['mydex.connection']!));
    value['textScale'] = _fontScale(value['textScale']);
    return ConnectionSettings.fromJson(value);
  }

  Future<void> saveSettings(ConnectionSettings value) async {
    _store['mydex.connection'] = jsonEncode(value.toJson());
    try {
      html.window.localStorage['mydex.textScale'] = value.textScale.toString();
    } catch (_) {}
  }

  Future<List<Json>> profiles() async =>
      objects(jsonDecode(_store['mydex.profiles'] ?? '[]'))
          .map((p) => {...p, 'textScale': _fontScale(p['textScale'])})
          .toList();
  Future<void> saveProfiles(List<Json> profiles) async {
    _store['mydex.profiles'] = jsonEncode(profiles);
  }

  Future<Json?> readCache() async => null;
  Future<Json?> readDshOutbox() async => Map<String, dynamic>.from(
      jsonDecode(html.window.localStorage[await _creationStorageKey()] ?? '{}'));
  Future<void> saveDshOutbox(Json value) async {
    html.window.localStorage[await _creationStorageKey()] = jsonEncode(value);
  }

  Future<Json?> readRouterJournal() async => Map<String, dynamic>.from(
      jsonDecode(html.window.localStorage[
          '${await _creationStorageKey()}.routerCommands.v1'] ?? '{}'));
  Future<void> saveRouterJournal(Json value) async {
    html.window.localStorage['${await _creationStorageKey()}.routerCommands.v1'] =
        jsonEncode(value);
  }

  Future<void> saveCache(Json value) async {}
  Future<void> clearCache() async {}
  Future<void> clearAll() async {
    _store.remove('mydex.connection');
    _store.remove('mydex.profiles');
  }
}
