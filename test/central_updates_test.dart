import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/services/central_updates.dart';
import 'package:mydex_mobile/models.dart';

void main() {
  test('central manifest and APK work without a paired computer or bearer',
      () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final origin = Uri.parse('http://127.0.0.1:${server.port}');
    final bytes = List.generate(4096, (i) => i % 251);
    final hash = sha256.convert(bytes).toString();
    final Json manifest = {
      'version': '0.2.22',
      'versionCode': 28,
      'size': bytes.length,
      'sha256': hash,
      'url': '$origin/downloads/Mydex-0.2.22-light.apk'
    };
    var requests = 0;
    server.listen((req) async {
      expect(req.headers.value('authorization'), isNull);
      requests++;
      if (req.uri.path.contains('.json')) {
        req.response.write(jsonEncode(manifest));
      } else {
        req.response.add(bytes);
      }
      await req.response.close();
    });
    final updates = CentralUpdates(origin: origin);
    final dir = await Directory.systemTemp.createTemp('mydex-central-');
    try {
      final m = await updates.check();
      final file = File('${dir.path}/update.apk');
      await updates.download(m, file, (_, __) {});
      expect(await file.readAsBytes(), bytes);
      expect(requests, 2);
      await updates.download(m, file, (_, __) {});
      expect(requests, 2,
          reason: 'verified APK is reused after install permission prompt');
      for (final url in [
        'http://evil.invalid/downloads/test.apk',
        '$origin/other.apk',
        '$origin/downloads/Mydex-x.apk?token=secret'
      ]) {
        expect(
            () => updates.validate({...m, 'url': url}), throwsFormatException);
      }
    } finally {
      updates.close();
      await server.close(force: true);
      await dir.delete(recursive: true);
    }
  });
  test(
      'resumes partial APK and rejects bad content without replacing prior verified file',
      () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final origin = Uri.parse('http://127.0.0.1:${server.port}');
    final bytes = List.generate(1024, (i) => i % 255),
        hash = sha256.convert(bytes).toString();
    final Json m = {
      'version': 'v',
      'versionCode': 28,
      'size': bytes.length,
      'sha256': hash,
      'url': '$origin/downloads/Mydex-test.apk'
    };
    var corrupt = false;
    server.listen((req) async {
      if (!corrupt) {
        expect(req.headers.value('range'), 'bytes=128-');
        req.response.statusCode = 206;
        req.response.headers.set('content-range', 'bytes 128-1023/1024');
        req.response.add(bytes.sublist(128));
      } else {
        req.response.add(List.filled(1024, 42));
      }
      await req.response.close();
    });
    final updates = CentralUpdates(origin: origin),
        dir = await Directory.systemTemp.createTemp('mydex-resume-');
    try {
      await File('${dir.path}/$hash.part').writeAsBytes(bytes.sublist(0, 128));
      final target = File('${dir.path}/update.apk');
      await updates.download(m, target, (_, __) {});
      expect(await target.readAsBytes(), bytes);
      corrupt = true;
      final otherHash = sha256.convert([1, 2, 3]).toString();
      await expectLater(
          updates.download({...m, 'sha256': otherHash}, target, (_, __) {}),
          throwsFormatException);
      expect(await target.readAsBytes(), bytes);
    } finally {
      updates.close();
      await server.close(force: true);
      await dir.delete(recursive: true);
    }
  });
  test('redirects cannot move update requests to another host', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final origin = Uri.parse('http://127.0.0.1:${server.port}');
    server.listen((req) async {
      req.response.statusCode = 302;
      req.response.headers.set('location', 'http://evil.invalid');
      await req.response.close();
    });
    final updates = CentralUpdates(origin: origin);
    try {
      await expectLater(updates.check(), throwsA(isA<HttpException>()));
    } finally {
      updates.close();
      await server.close(force: true);
    }
  });
}
