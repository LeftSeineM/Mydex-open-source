import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/api.dart';
import 'client_test.dart' show fixture;

class EntryApi extends GatewayApi {
  Json result={'id':'laptop~desktop:router','deviceId':'laptop',
    'toolId':'codex','source':'desktop','messages':<Json>[]};
  Completer<void>? wait;
  EntryApi():super(const ConnectionSettings(baseUrl:'https://fixture.invalid'));
  @override Future<Json> get(String path) async {
    await wait?.future;return result;
  }
}

void main() {
  test('Router entry selects native tool, clears old controls and keeps identity',() async {
    final c=fixture(),api=EntryApi();c.api=api;c.toolId='deepseek';
    c.controlState={'model':'old-tool-model'};
    expect(await c.openNativeRouter('laptop','desktop:router'),true);
    expect(c.toolId,'codex');expect(c.deviceId,'laptop');
    expect(c.selectedId,'laptop~desktop:router');expect(c.selected?['toolId'],'codex');
    expect(c.controlState,isEmpty);c.dispose();
  });
  test('foreign identity cannot replace the currently selected conversation',() async {
    final c=fixture(),api=EntryApi();c.api=api;c.toolId='deepseek';c.selectedId='old-session';
    api.result={...api.result,'id':'other~desktop:router'};
    expect(await c.openNativeRouter('laptop','desktop:router'),false);
    expect(c.selectedId,'old-session');expect(c.toolId,'deepseek');c.dispose();
  });
  test('late Router read does not override a newer user selection',() async {
    final c=fixture(),api=EntryApi();c.api=api;api.wait=Completer<void>();
    final opening=c.openNativeRouter('laptop','desktop:router');
    c.chooseTool('claude');api.wait!.complete();
    expect(await opening,false);expect(c.toolId,'claude');expect(c.selectedId,isNull);c.dispose();
  });
}
