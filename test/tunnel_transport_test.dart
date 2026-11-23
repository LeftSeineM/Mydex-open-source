import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/api.dart';

class FixtureTrust extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    final trust = context ??
        (SecurityContext()
          ..setTrustedCertificates('test/fixtures/mesh-cert.pem'));
    return super.createHttpClient(trust);
  }
}

void main() {
  test('native API and realtime socket cross opaque relay with gateway pinning',
      () async {
    final process = await Process.start(
        'D:/Node/node.exe', ['test/fixtures/tunnel-server.mjs']);
    process.stderr.transform(utf8.decoder).listen((s) => stderr.write(s));
    final raw = await process.stdout
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .first
        .timeout(const Duration(seconds: 10));
    final config = Map<String, dynamic>.from(jsonDecode(raw));
    final previous = HttpOverrides.current;
    HttpOverrides.global = FixtureTrust();
    final api = GatewayApi(
        ConnectionSettings.fromJson({...config, 'token': 'fixture-only'}));
    try {
      expect((await api.get('/api/tasks'))['ok'], true);
      expect(
          (await api.post('/api/tasks', {'instruction': 'fixture'}))['method'],
          'POST');
      expect((await api.bytes('/api/update/apk')).length, 2 * 1024 * 1024);
      final ws = await api.connect();
      final events = StreamIterator(ws);
      expect(await events.moveNext(), true);
      expect(jsonDecode(events.current)['type'], 'devices');
      ws.add('{"type":"subscribe"}');
      expect(await events.moveNext(), true);
      expect(jsonDecode(events.current)['type'], 'subscribe');
      await events.cancel();
      await ws.close();
      // A dead relay must not prevent a pinned direct connection from a QR.
      final direct = GatewayApi(ConnectionSettings.fromJson({
        ...config, 'token':'fixture-only', 'relayUrl':'https://127.0.0.1:1',
        'directUrls':[config['directTestUrl']]
      }));
      try { expect((await direct.get('/api/tasks'))['ok'],true); }
      finally { direct.close(); }
      // Discovery also works without a stored address or reachable relay.
      process.stdin.writeln('lan');
      final discovered = GatewayApi(ConnectionSettings.fromJson({
        ...config, 'token':'fixture-only', 'relayUrl':'https://127.0.0.1:1'
      }));
      try { expect((await discovered.get('/api/tasks'))['ok'],true); }
      finally { discovered.close(); }
      final wrong = GatewayApi(ConnectionSettings.fromJson(
          {...config, 'token': 'fixture-only', 'fingerprint': '0' * 64}));
      try {
        await expectLater(wrong.get('/api/tasks'), throwsA(isA<Exception>()));
      } finally {
        wrong.close();
      }
    } finally {
      api.close();
      HttpOverrides.global = previous;
      process.stdin.writeln('stop');
      await process.exitCode.timeout(const Duration(seconds: 5), onTimeout: () {
        process.kill();
        return -1;
      });
    }
  }, timeout: const Timeout(Duration(seconds: 60)));
}
