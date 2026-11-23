import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/main.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/api.dart';
import 'client_test.dart' show fixture;

class DeferredCatalog extends GatewayApi {
  final response = Completer<Json>();
  DeferredCatalog() : super(const ConnectionSettings());
  @override
  Future<Json> get(String path) => response.future;
}

void main() {
  test('native writable session is not blocked by stale tool catalog', () {
    final c = fixture();
    c.toolId = 'kimi';
    c.composing = true; // select() uses this for the conversation panel too.
    c.details[c.selectedId!] = {
      'toolId': 'kimi',
      'source': 'desktop',
      'readOnly': false
    };
    c.tools = [];
    expect(c.toolCanSend, true);
    c.details[c.selectedId!]?['readOnly'] = true;
    expect(c.toolCanSend, false);
    c.composing = true;
    expect(c.toolCanSend, false);
    c.dispose();
  });
  test('font preference round trips and clamps corrupt values', () {
    expect(
        ConnectionSettings.fromJson(
                const ConnectionSettings(textScale: 1.2).toJson())
            .textScale,
        1.2);
    expect(ConnectionSettings.fromJson({'textScale': 9}).textScale, 2.0);
    expect(ConnectionSettings.fromJson({}).textScale, 1);
  });

  test('old control response cannot cross tool switch and return', () async {
    final c = fixture()..browse();
    final api = DeferredCatalog();
    c.api = api;
    final pending = c.loadControls();
    c.chooseTool('claude');
    c.chooseTool('codex');
    api.response.complete({
      'models': [
        {'id': 'stale'}
      ]
    });
    await pending;
    expect(c.models, isEmpty);
    expect(c.controlState, isEmpty);
    expect(c.controlsLoading, false);
    c.dispose();
  });

  for (final width in [390.0, 1100.0]) {
    testWidgets('tool workspace isolation at width $width', (tester) async {
      await tester.binding.setSurfaceSize(Size(width, 844));
      final c = fixture();
      c.projects = [
        {
          'id': 'codex-project',
          'name': 'Codex 专属项目',
          'deviceId': 'mini',
          'toolId': 'codex'
        }
      ];
      c.chooseTool('claude');
      await tester.pumpWidget(MydexApp(controller: c));
      await tester.pump();
      expect(c.visibleProjects, isEmpty);
      expect(c.visibleTasks, isEmpty);
      expect(find.text('Codex 专属项目'), findsNothing);
      expect(find.text('梳理项目结构与下一步'), findsNothing);
      expect(find.text('Claude Code'), findsWidgets);
      c.chooseTool('codex');
      await tester.pump();
      expect(c.visibleProjects.single['name'], 'Codex 专属项目');
      expect(c.visibleTasks, hasLength(1));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      c.dispose();
      await tester.binding.setSurfaceSize(null);
    });
  }
}
