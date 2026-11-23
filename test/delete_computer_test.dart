import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/controller.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/storage.dart';
import 'package:mydex_mobile/widgets/connection_picker.dart';
import 'package:mydex_mobile/pages/settings.dart';

class MemoryStorage extends LocalStorage {
  ConnectionSettings saved = const ConnectionSettings();
  List<Json> profilesSaved = [];
  bool cleared = false;
  @override
  Future<void> saveSettings(ConnectionSettings v) async {
    saved = v;
  }

  @override
  Future<void> saveProfiles(List<Json> v) async {
    profilesSaved = List.of(v);
  }

  @override
  Future<void> clearCache() async {
    cleared = true;
  }
}

class OfflineController extends AppController {
  OfflineController(super.storage);
  @override
  Future<void> reconnect() async {}
}

void main() {
  testWidgets('settings exposes named device management and installed version',
      (tester) async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel('dev.mydex/device'),
            (call) async => call.method == 'appVersion'
                ? {'name': '0.2.14', 'code': 17}
                : null);
    final store = MemoryStorage();
    final c = OfflineController(store);
    c.settings = const ConnectionSettings(
        baseUrl: 'https://offline.invalid', token: 'fixture');
    c.connections = [
      {'name': '离线电脑', ...c.settings.toJson()}
    ];
    await tester.pumpWidget(MaterialApp(home: SettingsPage(controller: c)));
    await tester.pumpAndSettle();
    expect(find.text('版本 0.2.14'), findsOneWidget);
    await tester.tap(find.text('管理已添加电脑'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('删除电脑：离线电脑'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('删除设备'));
    await tester.pumpAndSettle();
    expect(c.connections, isEmpty);
    expect(c.settings.configured, false);
    expect(find.text('还没有添加电脑'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel('dev.mydex/device'), null);
  });
  test('re-pairing the same certificate and credential replaces an old IP',
      () async {
    final store = MemoryStorage();
    final app = OfflineController(store);
    app.settings = const ConnectionSettings(
        baseUrl: 'https://old.invalid',
        token: 'fixture',
        fingerprint: 'same-cert');
    app.connections = [
      {'name': '我的电脑', ...app.settings.toJson()}
    ];
    await app.configure(const ConnectionSettings(
        baseUrl: 'https://new.invalid',
        token: 'fixture',
        fingerprint: 'same-cert'));
    expect(app.connections, hasLength(1));
    expect(app.connections.single['baseUrl'], 'https://new.invalid');
    expect(app.connectionName, '我的电脑');
    app.dispose();
  });
  testWidgets(
      'Android can remove an offline active computer without deleting others',
      (tester) async {
    final storage = MemoryStorage();
    // Use an isolated controller/storage: no server, account, token or files.
    final app = AppController(storage);
    app.settings = const ConnectionSettings(
        baseUrl: 'https://old.invalid', token: 'fixture', textScale: .8);
    app.connections = [
      {'name': '离线电脑', ...app.settings.toJson()},
      {
        'name': '另一台电脑',
        'baseUrl': 'https://other.invalid',
        'token': 'fixture-other'
      }
    ];
    app.details['old'] = {
      'messages': [
        {'text': 'private fixture'}
      ]
    };
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: ListenableBuilder(
                listenable: app,
                builder: (_, __) => ConnectionPicker(controller: app)))));
    await tester.tap(find.byTooltip('删除这台电脑'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('删除设备'));
    await tester.pumpAndSettle();
    expect(app.connections.single['name'], '另一台电脑');
    expect(storage.profilesSaved.single['name'], '另一台电脑');
    expect(storage.saved.configured, false);
    expect(storage.saved.token, isEmpty);
    expect(storage.saved.textScale, .8);
    expect(app.details, isEmpty);
    expect(storage.cleared, true);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    app.dispose();
  });
  test('deleting a non-active computer does not clear the active connection',
      () async {
    final storage = MemoryStorage();
    final app = AppController(storage);
    app.settings = const ConnectionSettings(
        baseUrl: 'https://active.invalid', token: 'fixture');
    app.connections = [
      {'baseUrl': 'https://active.invalid'},
      {'baseUrl': 'https://old.invalid'}
    ];
    await app.forgetConnection('https://old.invalid');
    expect(app.settings.configured, true);
    expect(storage.cleared, false);
    app.dispose();
  });
}
