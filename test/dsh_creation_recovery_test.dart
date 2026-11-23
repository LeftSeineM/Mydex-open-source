import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/controller.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/api.dart';
import 'package:mydex_mobile/services/dsh_create_outbox.dart';
import 'client_test.dart' show fixture;

class DiskSimulation {
  Json records = {};
  int writes = 0;
  bool broken = false;
  DshCreateOutbox open() => DshCreateOutbox(
      read: () async => jsonDecode(jsonEncode(records)),
      save: (value) async {
        if (broken) throw StateError('disk unavailable');
        writes++;
        records = jsonDecode(jsonEncode(value));
      });
}

class RecoveryApi extends GatewayApi {
  final DiskSimulation disk;
  int posts = 0, lookups = 0;
  String? key;
  bool losePost = true, failDetail = false;
  Json task = {
    'id': 'mini~native:deepseek:original',
    'deviceId': 'mini',
    'toolId': 'deepseek',
    'source': 'desktop',
    'readOnly': false,
    'initialDelivery': 'unknown'
  };
  RecoveryApi(this.disk)
      : super(const ConnectionSettings(baseUrl: 'https://fixture.invalid'));
  @override
  Future<Json> post(String path, Json body, {String? requestId}) async {
    expect(path, '/api/tasks');
    expect(disk.writes, greaterThanOrEqualTo(2));
    posts++;
    key = requestId;
    expect(key, matches(RegExp(r'^[a-f0-9]{48}$')));
    if (losePost) throw const SocketException('response lost');
    return task;
  }

  @override
  Future<Json> get(String path) async {
    if (path.startsWith('/api/requests/')) {
      lookups++;
      expect(path, endsWith(key!));
      return {'task': task};
    }
    if (failDetail) throw const SocketException('detail failed');
    return {...task, 'messages': []};
  }
}

AppController controller(DiskSimulation disk, RecoveryApi api) {
  final c = fixture(creationOutbox: disk.open());
  c.api = api;
  c.tools = [
    {
      'id': 'deepseek',
      'deviceId': 'mini',
      'capabilities': {'send': true, 'create': true}
    }
  ];
  c.projects = [
    {
      'id': 'project',
      'deviceId': 'mini',
      'toolId': 'deepseek',
      'name': 'DSH project'
    }
  ];
  c.chooseTool('deepseek');
  c.chooseProject('project');
  c.newTask();
  return c;
}

void main() {
  test(
      'phone restart queries the original reservation, retains native ID even when detail fails',
      () async {
    final disk = DiskSimulation(), api = RecoveryApi(DiskSimulation());
    final actualApi = RecoveryApi(disk);
    final c = controller(disk, actualApi);
    expect(await c.send('initial instruction'), isFalse);
    expect(actualApi.posts, 1);
    c.dispose();
    final restored = controller(disk, actualApi);
    restored.browse();
    actualApi.failDetail = true;
    await restored.recoverDshCreations();
    expect(restored.selectedId, actualApi.task['id']);
    expect(actualApi.posts, 1);
    expect(actualApi.lookups, 1);
    expect(restored.selected?['initialDelivery'], 'unknown');
    expect(jsonEncode(disk.records),
        isNot(contains('fixture-not-a-real-credential')));
    restored.dispose();
    api.close();
  });
  test('another account cannot recover the previous account reservation',
      () async {
    final disk = DiskSimulation(), api = RecoveryApi(DiskSimulation());
    final actualApi = RecoveryApi(disk);
    final c = controller(disk, actualApi);
    await c.send('initial');
    c.dispose();
    final other = controller(disk, actualApi);
    other.settings = const ConnectionSettings(
        baseUrl: 'https://fixture.invalid', token: 'different-account-token');
    other.browse();
    await other.recoverDshCreations();
    expect(actualApi.lookups, 0);
    expect(other.selectedId, isNull);
    expect(actualApi.posts, 1);
    other.dispose();
    api.close();
  });
  test('local reservation failure prevents any native creation HTTP request',
      () async {
    final disk = DiskSimulation()..broken = true,
        api = RecoveryApi(DiskSimulation());
    final actualApi = RecoveryApi(disk);
    final c = controller(disk, actualApi);
    expect(await c.send('initial'), isFalse);
    expect(actualApi.posts, 0);
    c.dispose();
    api.close();
  });
  test('unresolved operation cannot be erased or replaced with a fresh POST',
      () async {
    Json data = {};
    var posts = 0;
    final box = DshCreateOutbox(
        read: () async => jsonDecode(jsonEncode(data)),
        save: (v) async {
          data = jsonDecode(jsonEncode(v));
        });
    Future<Json> post(Json body, String key) async {
      posts++;
      throw StateError('lost');
    }

    Future<Json> lookup(String key) async => {'task': null};
    await expectLater(
        box.submit(
            scope: 'account/device/project',
            body: {'instruction': 'one'},
            post: post,
            lookup: lookup),
        throwsStateError);
    await expectLater(box.newDraft('account/device/project'), throwsStateError);
    await expectLater(
        box.submit(
            scope: 'account/device/project',
            body: {'instruction': 'two'},
            post: post,
            lookup: lookup),
        throwsStateError);
    await expectLater(
        box.submit(
            scope: 'account/device/project',
            body: {'instruction': 'one'},
            post: post,
            lookup: lookup),
        throwsStateError);
    expect(posts, 1);
  });
}
