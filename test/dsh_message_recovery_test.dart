import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/api.dart';
import 'client_test.dart' show fixture;
import 'dsh_creation_recovery_test.dart' show DiskSimulation;

class MessageApi extends GatewayApi {
  int posts = 0, lookups = 0;
  String? key;
  bool lose = true;
  MessageApi()
      : super(const ConnectionSettings(baseUrl: 'https://fixture.invalid'));
  @override
  Future<Json> post(String path, Json body, {String? requestId}) async {
    expect(path, endsWith('/messages'));
    posts++;
    key = requestId;
    if (lose) throw const SocketException('lost receipt');
    return {'accepted': true};
  }

  @override
  Future<Json> get(String path) async {
    if (path.startsWith('/api/requests/')) {
      lookups++;
      expect(path, endsWith(key!));
      return {
        'task': {
          'id': 'mini~native:deepseek:original',
          'delivery': 'acknowledged'
        }
      };
    }
    return {
      'id': 'mini~native:deepseek:original',
      'deviceId': 'mini',
      'toolId': 'deepseek',
      'readOnly': false,
      'messages': []
    };
  }
}

void main() {
  test(
      'lost continuation receipt survives phone restart; user retry recovers without POST',
      () async {
    final disk = DiskSimulation(), api = MessageApi();
    make() {
      final c = fixture(creationOutbox: disk.open());
      c.api = api;
      c.tools = [
        {
          'id': 'deepseek',
          'deviceId': 'mini',
          'capabilities': {'send': true, 'create': true}
        }
      ];
      c.toolId = 'deepseek';
      c.selectedId = 'mini~native:deepseek:original';
      c.details[c.selectedId!] = {
        'id': c.selectedId,
        'deviceId': 'mini',
        'toolId': 'deepseek',
        'readOnly': false
      };
      return c;
    }

    final c = make();
    expect(await c.send('continue'), isFalse);
    expect(api.posts, 1);
    c.dispose();
    final restored = make();
    expect(await restored.send('continue'), isTrue);
    expect(api.posts, 1);
    expect(api.lookups, 1);
    // A second retry without an explicit edited draft still reuses the receipt.
    expect(await restored.send('continue'), isTrue);
    expect(api.posts, 1);
    // Explicitly typing a fresh message after known delivery permits the same text.
    api.lose = false;
    restored.noteDshMessageDraft(restored.selectedId);
    expect(await restored.send('continue'), isTrue);
    expect(api.posts, 2);
    expect(jsonEncode(disk.records),
        isNot(contains('fixture-not-a-real-credential')));
    restored.dispose();
    api.close();
  });
}
