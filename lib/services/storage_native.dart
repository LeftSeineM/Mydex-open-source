import 'dart:convert';
import 'dart:io';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';
import '../models.dart';

class LocalStorage {
  Future<void> withRouterLock(Future<void> Function() action) => action();
  // Android Keystore + encrypted preferences; no Google account or Play Services.
  final secure = const FlutterSecureStorage(
      aOptions: AndroidOptions(encryptedSharedPreferences: true));
  Future<bool> testFeatures({bool seed = false}) async {
    if (seed) await secure.write(key: 'features.superagent.v1', value: 'true');
    return seed || await secure.read(key: 'features.superagent.v1') == 'true';
  }

  Future<ConnectionSettings> settings() async {
    final text = await secure.read(key: 'connection.v1');
    return text == null
        ? const ConnectionSettings()
        : ConnectionSettings.fromJson(jsonDecode(text));
  }

  Future<void> saveSettings(ConnectionSettings value) =>
      secure.write(key: 'connection.v1', value: jsonEncode(value.toJson()));
  Future<List<Json>> profiles() async {
    final text = await secure.read(key: 'connections.v2');
    return text == null ? [] : objects(jsonDecode(text));
  }

  Future<void> saveProfiles(List<Json> profiles) =>
      secure.write(key: 'connections.v2', value: jsonEncode(profiles));
  Future<File> get _cache async =>
      File('${(await getApplicationSupportDirectory()).path}/sessions-v1.json');
  Future<Json?> readCache() async {
    try {
      final file = await _cache;
      return await file.exists() ? jsonDecode(await file.readAsString()) : null;
    } catch (_) {
      return null;
    }
  }

  Future<File> get _dshOutbox async => File(
      '${(await getApplicationSupportDirectory()).path}/dsh-create-outbox-v1.json');
  Future<Json?> readDshOutbox() async {
    final file = await _dshOutbox;
    if (!await file.exists()) return {};
    // A corrupt/unreadable operation journal must fail closed, never become an
    // empty cache that allows a second native creation.
    return Map<String, dynamic>.from(jsonDecode(await file.readAsString()));
  }

  Future<void> saveDshOutbox(Json value) async {
    final file = await _dshOutbox,
        temporary = File('${(await _dshOutbox).path}.tmp');
    await file.parent.create(recursive: true);
    await temporary.writeAsString(jsonEncode(value), flush: true);
    await temporary.rename(file.path);
  }

  Future<File> get _routerJournal async => File(
      '${(await getApplicationSupportDirectory()).path}/router-commands-v1.json');
  Future<Json?> readRouterJournal() async {
    final file = await _routerJournal;
    if (!await file.exists()) return {};
    return Map<String, dynamic>.from(jsonDecode(await file.readAsString()));
  }
  Future<void> saveRouterJournal(Json value) async {
    final file = await _routerJournal;
    final temporary = File('${file.path}.tmp');
    await file.parent.create(recursive: true);
    await temporary.writeAsString(jsonEncode(value), flush: true);
    await temporary.rename(file.path);
  }

  Future<void> saveCache(Json value) async {
    final file = await _cache;
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(jsonEncode(value), flush: true);
    await temporary.rename(file.path);
  }

  Future<void> clearCache() async {
    final file = await _cache;
    if (await file.exists()) await file.delete();
  }

  Future<void> clearAll() async {
    await secure.delete(key: 'features.superagent.v1');
    await secure.delete(key: 'connection.v1');
    await secure.delete(key: 'connections.v2');
    await clearCache();
  }
}
