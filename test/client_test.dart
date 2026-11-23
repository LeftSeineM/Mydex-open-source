import 'dart:io';
import 'dart:async';
import 'dart:convert';
import 'dart:ui' show DisplayFeature, DisplayFeatureType, DisplayFeatureState;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/main.dart';
import 'package:mydex_mobile/controller.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/api.dart';
import 'package:mydex_mobile/services/storage.dart';
import 'package:mydex_mobile/services/dsh_create_outbox.dart';
import 'package:mydex_mobile/services/router_command_journal.dart';
import 'package:mydex_mobile/pages/home.dart';
import 'package:mydex_mobile/widgets/message.dart';
import 'package:mydex_mobile/pages/controls.dart';
import 'package:mydex_mobile/pages/settings.dart';

void main() {
  testWidgets(
      'prediction stays a draft and stale responses cannot enter another conversation',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    final c = fixture();
    c.settings = const ConnectionSettings(
        baseUrl: 'https://fixture.invalid',
        token: 'fixture-not-a-real-credential',
        predictions: true);
    final api = PredictionApi(c.settings);
    c.api = api;
    await tester.pumpWidget(MydexApp(controller: c));
    await tester.pump();
    await tester.tap(find.text('建议下一步'));
    await tester.pump();
    api.reply.complete({'available': true, 'text': '请补充边界测试。'});
    await tester.pump();
    expect(find.text('采用'), findsOneWidget);
    final field = find.byType(TextField).last;
    expect(tester.widget<TextField>(field).controller!.text, isEmpty);
    await tester.tap(field);
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    expect(tester.widget<TextField>(field).controller!.text, '请补充边界测试。');
    expect(api.paths, hasLength(1));
    expect(api.paths.single, endsWith('/prediction'));
    await tester.enterText(field, '');
    await tester.pump();
    api.reply = Completer<Json>();
    await tester.tap(find.text('建议下一步'));
    await tester.pump();
    c.selectedId = null;
    c.composing = true;
    c.notifyListeners();
    await tester.pump();
    api.reply.complete({'available': true, 'text': '过期建议'});
    await tester.pump();
    expect(find.text('采用'), findsNothing);
    expect(
        tester.widget<TextField>(find.byType(TextField).last).controller!.text,
        isEmpty);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  });
  testWidgets(
      'long content is fetched only on demand and navigates in bounded chunks',
      (tester) async {
    final api = ContentApi(
        const ConnectionSettings(baseUrl: 'https://fixture.invalid'));
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: MessageBlock(message: {
      'id': 'large',
      'role': 'agent',
      'type': 'text',
      'text': '预览内容',
      'contentPath': '/api/tasks/example/content?ref=test'
    }, api: api))));
    expect(api.paths, isEmpty);
    await tester.tap(find.text('分段查看完整内容'));
    await tester.pumpAndSettle();
    expect(find.text('第一段'), findsOneWidget);
    expect(api.paths.single, endsWith('offset=0'));
    await tester.tap(find.text('下一段'));
    await tester.pumpAndSettle();
    expect(find.text('第二段'), findsOneWidget);
    expect(find.text('第一段'), findsNothing);
    expect(api.paths.last, endsWith('offset=16000'));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    api.close();
  });
  test('pairing imports desktop bundle and rejects invalid credentials', () {
    final p = parsePairing('MYDEX-CONNECTION\n${jsonEncode({
          'name': '工作电脑',
          'baseUrl': 'https://demo.invalid:18443/',
          'token': 'demo-token-not-a-real-secret-123',
          'fingerprint': 'ab' * 32
        })}');
    expect(p['name'], '工作电脑');
    expect(p['baseUrl'], 'https://demo.invalid:18443');
    expect(
        () =>
            parsePairing('{"baseUrl":"https://demo.invalid","token":"short"}'),
        throwsFormatException);
    expect(
        () => parsePairing(
            '{"baseUrl":"https://demo.invalid/private","token":"demo-token-not-a-real-secret-123"}'),
        throwsFormatException);
  });
  testWidgets('long history opens at latest and returns there in one tap',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    final c = fixture();
    c.details[c.selectedId]!['messages'] = List.generate(
        160,
        (i) => <String, dynamic>{
              'id': 'msg-$i',
              'role': i.isEven ? 'user' : 'agent',
              'type': 'text',
              'text': '消息 $i — ${'历史内容。' * 15}'
            });
    await tester.pumpWidget(MydexApp(controller: c));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.textContaining('消息 159'), findsOneWidget);
    expect(find.textContaining('消息 0 —'), findsNothing);
    await tester.drag(find.byType(ListView).last, const Offset(0, 600));
    await tester.pumpAndSettle();
    expect(find.byTooltip('回到最新消息'), findsOneWidget);
    await tester.tap(find.byTooltip('回到最新消息'));
    await tester.pump();
    expect(find.textContaining('消息 159'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  });
  testWidgets('long replies collapse without losing copyable full text',
      (tester) async {
    final text = '周期任务结果。' * 200 + '完整内容末尾标记';
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: SingleChildScrollView(
                child: MessageBlock(message: {
      'id': 'long',
      'role': 'agent',
      'type': 'text',
      'text': text
    }, api: null)))));
    expect(find.textContaining('完整内容末尾标记'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('expand-message:long')));
    await tester.pump();
    expect(find.textContaining('完整内容末尾标记'), findsWidgets);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('many scripts are one collapsed runtime group', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    final c = fixture();
    c.details[c.selectedId]!['messages'] = [
      {'id': 'u', 'role': 'user', 'type': 'text', 'text': '执行脚本'},
      ...List.generate(
          80,
          (i) => {
                'id': 'script-$i',
                'role': 'agent',
                'type': 'step',
                'title': '脚本 $i',
                'text': '日志 $i'
              }),
      {'id': 'final', 'role': 'agent', 'type': 'text', 'text': '任务完成'}
    ];
    await tester.pumpWidget(MydexApp(controller: c));
    await tester.pump();
    expect(find.text('运行过程 · 80 个步骤'), findsOneWidget);
    expect(find.text('脚本 0'), findsNothing);
    expect(find.text('任务完成'), findsOneWidget);
    await tester.tap(find.text('运行过程 · 80 个步骤'));
    await tester.pumpAndSettle();
    expect(find.text('脚本 0'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  });
  testWidgets('compact controls at phone width have no layout errors',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    final c = fixture();
    c.models = [
      {
        'id': 'test',
        'name': 'Host model',
        'efforts': ['low', 'high'],
        'defaultEffort': 'low',
        'isDefault': true,
        'fast': true
      }
    ];
    c.controlState = {
      'model': 'test',
      'effort': 'low',
      'capabilities': {'settings': true, 'goal': true, 'queue': true}
    };
    await tester.pumpWidget(MaterialApp(
        theme: appTheme(Brightness.light),
        home: Scaffold(body: ControlsPanel(controller: c))));
    await tester.pump();
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('队列'));
    await tester.pump();
    expect(find.text('队列为空'), findsOneWidget);
    await tester.tap(find.text('目标'));
    await tester.pump();
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  });
  testWidgets('fold hinge and open keyboard do not overlap or overflow',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(740, 844));
    final c = fixture();
    await tester.pumpWidget(MaterialApp(
        theme: appTheme(Brightness.light),
        home: MediaQuery(
            data: const MediaQueryData(
                size: Size(740, 844),
                viewInsets: EdgeInsets.only(bottom: 300),
                displayFeatures: [
                  DisplayFeature(
                      bounds: Rect.fromLTWH(350, 0, 20, 844),
                      type: DisplayFeatureType.hinge,
                      state: DisplayFeatureState.postureFlat)
                ]),
            child: HomePage(controller: c))));
    await tester.pump(const Duration(milliseconds: 400));
    expect(tester.takeException(), isNull);
    expect(tester.getTopLeft(find.byType(TextField).last).dx,
        greaterThanOrEqualTo(370));
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  });
  test('first launch and missing preference default to light', () {
    expect(const ConnectionSettings().dark, false);
    expect(ConnectionSettings.fromJson({}).dark, false);
  });
  for (final width in [320.0, 720.0]) {
    testWidgets('large text remains readable at $width', (tester) async {
      await tester.binding.setSurfaceSize(Size(width, 844));
      final c = fixture();
      await tester.pumpWidget(MaterialApp(
          theme: appTheme(Brightness.light),
          home: MediaQuery(
              data: MediaQueryData(
                  size: Size(width, 844),
                  textScaler: const TextScaler.linear(2.0)),
              child: HomePage(controller: c))));
      await tester.pump(const Duration(milliseconds: 400));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      c.dispose();
      await tester.binding.setSurfaceSize(null);
    });
  }
  test('origin boundary prevents credential forwarding', () {
    final api = GatewayApi(const ConnectionSettings(
        baseUrl: 'https://example.test:18443', token: 'test-only-token'));
    expect(api.uri('/api/tasks').host, 'example.test');
    expect(() => api.uri('https://third-party.test/image.png'),
        throwsA(isA<ApiException>()));
    expect(() => api.uri('//third-party.test/image.png'),
        throwsA(isA<ApiException>()));
    expect(ConnectionSettings.validate('https://name:secret@host'), isNotNull);
    expect(ConnectionSettings.validate('http://192.168.1.2:8080'), isNull);
    api.close();
  });
  test('all requests authenticated; redirects are refused', () async {
    HttpOverrides.global = null;
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    String? auth;
    server.listen((r) {
      auth = r.headers.value('Authorization');
      r.response.statusCode = 302;
      r.response.headers.set('Location', 'http://external.test/');
      r.response.close();
    });
    final api = GatewayApi(ConnectionSettings(
        baseUrl: 'http://127.0.0.1:${server.port}', token: 'secret-test'));
    await expectLater(api.get('/api/tasks'), throwsA(isA<ApiException>()));
    expect(auth, 'Bearer secret-test');
    api.close();
    await server.close(force: true);
  });
  test('POST carries stable deduplication key', () async {
    HttpOverrides.global = null;
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    String? key;
    server.listen((r) async {
      key = r.headers.value('Idempotency-Key');
      await utf8.decoder.bind(r).join();
      r.response.headers.contentType = ContentType.json;
      r.response.write('{"accepted":true}');
      await r.response.close();
    });
    final api = GatewayApi(ConnectionSettings(
        baseUrl: 'http://127.0.0.1:${server.port}', token: 'secret-test'));
    expect(
        (await api.post('/api/tasks', {'instruction': 'test'},
            requestId: 'unique-request-123'))['accepted'],
        true);
    expect(key, 'unique-request-123');
    api.close();
    await server.close(force: true);
  });
  for (final width in [320.0, 390.0, 600.0, 720.0, 960.0]) {
    testWidgets('conversation at width $width has no layout errors',
        (tester) async {
      await tester.binding.setSurfaceSize(Size(width, 844));
      final c = fixture();
      await tester.pumpWidget(MydexApp(controller: c));
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('梳理项目结构与下一步'), findsWidgets);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      c.dispose();
      await tester.binding.setSurfaceSize(null);
    });
  }
  testWidgets('fold-unfold retains conversation and unsent draft',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    final c = fixture();
    await tester.pumpWidget(MydexApp(controller: c));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.enterText(find.byType(TextField).last, '这是折叠屏上尚未发送的草稿');
    await tester.binding.setSurfaceSize(const Size(720, 844));
    await tester.pump();
    expect(find.text('电脑'), findsOneWidget);
    expect(find.text('这是折叠屏上尚未发送的草稿'), findsOneWidget);
    expect(c.selectedId, 'mini~fixture');
    expect(tester.takeException(), isNull);
    await tester.binding.setSurfaceSize(const Size(390, 844));
    await tester.pump();
    expect(find.text('这是折叠屏上尚未发送的草稿'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  });
  testWidgets('conversation visual reference (fixture data)', (tester) async {
    await tester.runAsync(() async {
      final icons = File(
          '${Platform.environment['FLUTTER_ROOT'] ?? ''}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
      if (await icons.exists()) {
        final loader = FontLoader('MaterialIcons')
          ..addFont(
              Future.value(ByteData.sublistView(await icons.readAsBytes())));
        await loader.load();
      }
      final font = File('C:/Windows/Fonts/msyh.ttc');
      if (await font.exists()) {
        final loader = FontLoader('sans-serif')
          ..addFont(
              Future.value(ByteData.sublistView(await font.readAsBytes())));
        await loader.load();
      }
    });
    await tester.binding.setSurfaceSize(const Size(390, 844));
    final c = fixture();
    await tester.pumpWidget(MydexApp(controller: c));
    await tester.pump(const Duration(milliseconds: 400));
    await expectLater(find.byType(MaterialApp),
        matchesGoldenFile('goldens/conversation.png'));
    for (final scale in [.6, .8, 1.0]) {
      c.settings = ConnectionSettings.fromJson(
          {...c.settings.toJson(), 'textScale': scale});
      c.notifyListeners();
      for (final width in [390.0, 720.0]) {
        await tester.binding.setSurfaceSize(Size(width, 844));
        await tester.pump(const Duration(milliseconds: 400));
        expect(tester.takeException(), isNull);
        expect(tester.getSize(find.byTooltip('发送')).height,
            greaterThanOrEqualTo(40));
        await expectLater(
            find.byType(MaterialApp),
            matchesGoldenFile(
                'goldens/density-${(scale * 100).round()}-${width.round()}.png'));
      }
    }
    await tester.binding.setSurfaceSize(const Size(390, 844));
    c.settings = const ConnectionSettings(
        baseUrl: 'https://fixture.invalid',
        token: 'fixture-not-a-real-credential',
        predictions: true);
    final predictionApi = PredictionApi(c.settings);
    c.api = predictionApi;
    c.notifyListeners();
    await tester.pump();
    await tester.tap(find.text('建议下一步'));
    await tester.pump();
    predictionApi.reply
        .complete({'available': true, 'text': '请先检查两台电脑的会话同步，并补充验证步骤。'});
    await tester.pump();
    await expectLater(
        find.byType(MaterialApp), matchesGoldenFile('goldens/prediction.png'));
    c.api = null;
    predictionApi.client.close(force: true);
    c.browse();
    c.projects = [
      {'id': 'p1', 'deviceId': 'mini', 'name': '个人网站'},
      {'id': 'p2', 'deviceId': 'mini', 'name': '移动端应用'},
      {'id': 'p3', 'deviceId': 'mini', 'name': '周末实验室'},
    ];
    await tester.pump();
    await expectLater(
        find.byType(MaterialApp), matchesGoldenFile('goldens/projects.png'));
    await tester.tap(find.byTooltip('删除这台电脑'));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp),
        matchesGoldenFile('goldens/delete-computer-native.png'));
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    await c.select('mini~fixture'); // No real connection in this UI fixture.
    c.error = null;
    await tester.binding.setSurfaceSize(const Size(720, 844));
    await tester.pump(const Duration(milliseconds: 400));
    await expectLater(
        find.byType(MaterialApp), matchesGoldenFile('goldens/foldable.png'));
    await tester.binding.setSurfaceSize(const Size(390, 844));
    c.models = [
      {
        'id': 'host-model',
        'name': '电脑当前模型',
        'efforts': ['low', 'medium', 'high'],
        'defaultEffort': 'medium',
        'isDefault': true,
        'fast': true
      }
    ];
    c.controlState = {
      'model': 'host-model',
      'effort': 'medium',
      'fast': true,
      'capabilities': {
        'settings': true,
        'fastSettings': true,
        'queue': true,
        'goal': true
      }
    };
    await tester.pumpWidget(MaterialApp(
        theme: appTheme(Brightness.light),
        home: Scaffold(body: SafeArea(child: ControlsPanel(controller: c)))));
    await tester.pump();
    await expectLater(
        find.byType(MaterialApp), matchesGoldenFile('goldens/controls.png'));
    await tester.pumpWidget(MaterialApp(
        theme: appTheme(Brightness.light),
        home: SettingsPage(controller: c, addNew: true)));
    await tester.pump();
    await expectLater(find.byType(MaterialApp),
        matchesGoldenFile('goldens/add-computer.png'));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  }, tags: ['golden']);
}

AppController fixture({DshCreateOutbox? creationOutbox}) {
  Json operationRecords = {};
  Json routerRecords = {};
  final c = AppController(LocalStorage(),
      routerCommandJournal: RouterCommandJournal(
        read: () async => jsonDecode(jsonEncode(routerRecords)),
        save: (value) async {routerRecords = jsonDecode(jsonEncode(value));}),
      dshCreateOutbox: creationOutbox ??
          DshCreateOutbox(
              read: () async => jsonDecode(jsonEncode(operationRecords)),
              save: (value) async {
                operationRecords = jsonDecode(jsonEncode(value));
              }));
  c.initialized = true;
  c.connected = true;
  c.settings = const ConnectionSettings(
      baseUrl: 'https://fixture.invalid',
      token: 'fixture-not-a-real-credential');
  c.connections = [
    {
      'name': '工作电脑',
      'baseUrl': 'https://fixture.invalid',
      'token': 'fixture-not-a-real-credential'
    },
    {
      'name': '我的笔记本',
      'baseUrl': 'https://laptop.invalid',
      'token': 'fixture-not-a-real-credential'
    }
  ];
  c.devices = [
    {'id': 'mini', 'name': '工作电脑', 'online': true, 'desktopOnline': true},
  ];
  c.deviceId = 'mini';
  c.tools = [
    {
      'id': 'codex',
      'name': 'Codex',
      'deviceId': 'mini',
      'capabilities': {'send': true}
    },
    {
      'id': 'claude',
      'name': 'Claude Code',
      'deviceId': 'mini',
      'capabilities': {'send': false}
    },
    {
      'id': 'openclaw',
      'name': 'OpenClaw',
      'deviceId': 'mini',
      'capabilities': {'send': true}
    }
  ];
  c.selectedId = 'mini~fixture';
  final task = <String, dynamic>{
    'id': 'mini~fixture',
    'deviceId': 'mini',
    'title': '梳理项目结构与下一步',
    'status': 'Completed',
    'source': 'desktop',
    'messages': [
      {'id': '1', 'role': 'user', 'type': 'text', 'text': '帮我看一下这个项目，梳理一下下一步。'},
      {
        'id': '2',
        'role': 'agent',
        'type': 'text',
        'text': '我会先查看项目结构和当前改动，再整理需要优先处理的事项。'
      },
      {
        'id': '3',
        'role': 'agent',
        'type': 'step',
        'title': '已读取项目目录与说明文档',
        'status': 'completed',
        'text': '项目文件与 README 已读取。'
      },
      {
        'id': '4',
        'role': 'agent',
        'type': 'text',
        'text':
            '项目的主要模块已经连通。接下来建议先完成这三件事：\n\n1. 验证两台电脑的会话同步\n2. 补齐断线后的历史消息\n3. 在手机上检查交互和布局\n\n你可以直接在这里继续提问。'
      },
    ]
  };
  c.tasks = [task];
  c.details[c.selectedId!] = task;
  return c;
}

class PredictionApi extends GatewayApi {
  PredictionApi(super.settings);
  Completer<Json> reply = Completer<Json>();
  final List<String> paths = [];
  @override
  Future<Json> post(String path, Json body, {String? requestId}) {
    paths.add(path);
    return reply.future;
  }
}

class ContentApi extends GatewayApi {
  ContentApi(super.settings);
  final List<String> paths = [];
  @override
  Future<Json> get(String path) async {
    paths.add(path);
    return path.endsWith('offset=0')
        ? {'text': '第一段', 'nextOffset': 16000}
        : {'text': '第二段', 'nextOffset': null};
  }
}
