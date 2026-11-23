import 'dart:io';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/api.dart';
import 'package:mydex_mobile/services/private_updates.dart';

class PrivateUpdateApi extends GatewayApi {
  final paths = <String>[];
  final payload = Uint8List.fromList([1, 3, 7, 9]);
  PrivateUpdateApi()
      : super(const ConnectionSettings(
            baseUrl: 'https://fixture.invalid', token: 'fixture-only'));
  Json get manifest => {
        'channel': 'router-private',
        'version': 'private.2',
        'versionCode': 30,
        'size': payload.length,
        'sha256': sha256.convert(payload).toString()
      };
  @override
  Future<Json> get(String path) async {
    paths.add(path);
    return {...manifest, 'url': '/api/update/stream/apk'};
  }

  @override
  Stream<List<int>> privateUpdateBytes(String path) async* {
    paths.add(path);
    yield payload.sublist(0, 2);
    yield payload.sublist(2);
  }
}

void main() {
  test(
      'private update uses the paired gateway and fixed authenticated APK path',
      () async {
    final api = PrivateUpdateApi(),
        updates = PrivateUpdates(PrivateUpdateApi());
    final private = PrivateUpdates(api),
        dir = await Directory.systemTemp.createTemp('mydex-private-update-');
    try {
      final m = await private.check(), target = File('${dir.path}/update.apk');
      final progress = <int>[];
      await private.download(m, target, (received, _) => progress.add(received));
      expect(api.paths, ['/api/update/stream', '/api/update/stream/apk']);
      expect(progress, [0, 2, 4]);
      expect(await target.readAsBytes(), api.payload);
      expect(() => updates.validate({...m, 'channel': 'stable'}),
          throwsFormatException);
      expect(
          () => updates.validate({...m, 'url': 'https://other.invalid/leak'}),
          throwsFormatException);
    } finally {
      api.close();
      updates.api.close();
      await dir.delete(recursive: true);
    }
  });
  test(
      'private update rejects a corrupt payload before replacing an installed download',
      () async {
    final api = PrivateUpdateApi(),
        dir = await Directory.systemTemp.createTemp('mydex-private-corrupt-');
    try {
      final target = File('${dir.path}/update.apk');
      await target.writeAsBytes([42]);
      await expectLater(
          PrivateUpdates(api).download(
              {...api.manifest, 'sha256': '0' * 64}, target, (_, __) {}),
          throwsFormatException);
      expect(await target.readAsBytes(), [42]);
    } finally {
      api.close();
      await dir.delete(recursive: true);
    }
  });
}
