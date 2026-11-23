import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/api_native.dart';
import 'package:mydex_mobile/services/api_exception.dart';
import 'package:mydex_mobile/services/mesh_proxy.dart';

void main() {
  test(
      'CONNECT carries pinned HTTPS and WebSocket without leaking Bearer to proxy',
      () async {
    final security = SecurityContext()
      ..useCertificateChain('test/fixtures/mesh-cert.pem')
      ..usePrivateKey('test/fixtures/mesh-key.pem');
    final backend = await HttpServer.bindSecure('127.0.0.1', 0, security);
    final proxy = await ServerSocket.bind('127.0.0.1', 0);
    final sockets = <Socket>[];
    final failures = <String>[];
    var tunnels = 0;
    backend.listen((request) async {
      if (request.headers.value('Authorization') != 'Bearer fixture-token') {
        failures.add('missing backend credential');
      }
      if (WebSocketTransformer.isUpgradeRequest(request)) {
        final ws = await WebSocketTransformer.upgrade(request);
        ws.add('{"type":"fixture"}');
      } else {
        request.response.write('{"ok":true}');
        await request.response.close();
      }
    });
    proxy.listen((local) {
      sockets.add(local);
      Socket? upstream;
      var header = '';
      local.listen((data) async {
        if (upstream != null) {
          upstream!.add(data);
          return;
        }
        header += latin1.decode(data);
        if (!header.contains('\r\n\r\n')) return;
        final lower = header.toLowerCase();
        if (lower.contains('\r\nauthorization:')) {
          failures.add('Bearer leaked to CONNECT');
        }
        final expected =
            'Basic ${base64Encode(utf8.encode('mydex:fixture-secret'))}';
        if (!lower.contains('proxy-authorization: ${expected.toLowerCase()}')) {
          failures.add('missing proxy credential');
          local.destroy();
          return;
        }
        if (!header.startsWith('CONNECT ')) failures.add('unencrypted request');
        tunnels++;
        upstream = await Socket.connect('127.0.0.1', backend.port);
        sockets.add(upstream!);
        upstream!.listen(local.add,
            onError: (_) => local.destroy(), onDone: local.destroy);
        local.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        await local.flush();
      },
          onError: (_) => upstream?.destroy(),
          onDone: () => upstream?.destroy());
    });
    final pem = File('test/fixtures/mesh-cert.pem').readAsStringSync();
    final der = base64Decode(pem.replaceAll(RegExp(r'-----[^-]+-----|\s'), ''));
    final api = GatewayApi(ConnectionSettings(
        baseUrl: 'https://100.64.0.1:18443',
        token: 'fixture-token',
        fingerprint: sha256.convert(der).toString()));
    configureMeshProxy(api.client, '127.0.0.1:${proxy.port}', 'fixture-secret');
    addTearDown(() async {
      api.close();
      for (final socket in sockets) {
        socket.destroy();
      }
      await proxy.close();
      await backend.close(force: true);
    });
    final probe = await api.client.getUrl(api.uri('/api/probe'));
    probe.headers.set('Authorization', 'Bearer fixture-token');
    await (await probe.close()).drain<void>();
    expect((await api.get('/api/devices'))['ok'], true);
    final ws = await api.connect();
    expect(await ws.first, '{"type":"fixture"}');
    await ws.close();
    expect(tunnels, greaterThanOrEqualTo(2));
    expect(failures, isEmpty);

    final wrongPin = GatewayApi(ConnectionSettings(
        baseUrl: 'https://100.64.0.1:18443',
        token: 'fixture-token',
        fingerprint: '0' * 64));
    configureMeshProxy(
        wrongPin.client, '127.0.0.1:${proxy.port}', 'fixture-secret');
    await expectLater(
        wrongPin.get('/api/devices'), throwsA(isA<ApiException>()));
    wrongPin.close();
  });

  test('pairing and saved profiles preserve opt-in mesh mode', () {
    final bundle = parsePairing(jsonEncode({
      'baseUrl': 'https://100.64.0.1:18443',
      'token': 'x' * 32,
      'mesh': true,
    }));
    expect(bundle['mesh'], true);
    expect(
        ConnectionSettings.fromJson(
                ConnectionSettings.fromJson(bundle).toJson())
            .mesh,
        true);
    expect(const ConnectionSettings().mesh, false);
  });
}
