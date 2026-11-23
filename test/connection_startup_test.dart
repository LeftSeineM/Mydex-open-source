import 'dart:async';
import 'dart:io';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/api.dart';
import 'package:mydex_mobile/services/tunnel_proxy.dart';
import 'client_test.dart' show fixture;

class DelayedMetadata extends GatewayApi {
  final replies = <String, Completer<Json>>{};
  final counts = <String, int>{};
  DelayedMetadata()
      : super(const ConnectionSettings(baseUrl: 'https://fixture.invalid'));
  @override
  Future<Json> get(String path) {
    counts[path] = (counts[path] ?? 0) + 1;
    return (replies[path] ??= Completer<Json>()).future;
  }
}

void main() {
  test(
      'refresh finishes while tool scan is pending and concurrent scans coalesce',
      () async {
    final c = fixture(), api = DelayedMetadata();
    c.api = api;
    c.connected = true;
    var done = false;
    final refresh = c.refresh().then((_) => done = true);
    api.replies['/api/tasks']!.complete({
      'tasks': [
        {'id': 'first'}
      ],
      'devices': []
    });
    await Future<void>.delayed(Duration.zero);
    expect(done, true);
    expect(c.tasks.single['id'], 'first');
    await c.refresh();
    expect(api.counts['/api/projects'], 1);
    expect(api.counts['/api/tools'], 1);
    api.replies['/api/projects']!.complete({'projects': []});
    api.replies['/api/tools']!.complete({'tools': []});
    await c.refreshCatalog();
    await refresh;
    await c.refresh();
    expect(api.counts['/api/projects'], 1);
    expect(api.counts['/api/tools'], 1);
    await c.refreshCatalog(force: true);
    expect(api.counts['/api/tools'], 2);
    c.dispose();
  });
  test(
      'real WebSocket handshake returns before deliberately blocked catalog HTTP',
      () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final release = Completer<void>();
    WebSocket? socket;
    server.listen((req) async {
      if (req.uri.path == '/ws') {
        socket = await WebSocketTransformer.upgrade(req);
        return;
      }
      if (req.uri.path == '/api/projects' || req.uri.path == '/api/tools')
        await release.future;
      req.response.headers.contentType = ContentType.json;
      req.response.write(jsonEncode(
          {'tasks': [], 'devices': [], 'projects': [], 'tools': []}));
      await req.response.close();
    });
    final c = fixture();
    c.settings = ConnectionSettings(
        baseUrl: 'http://127.0.0.1:${server.port}',
        token: 'fixture-local-token');
    try {
      await c.reconnect().timeout(const Duration(seconds: 2));
      expect(c.connected, true);
      expect(release.isCompleted, false);
      release.complete();
      await c.refreshCatalog();
    } finally {
      if (!release.isCompleted) release.complete();
      c.dispose();
      await socket?.close();
      await server.close(force: true);
    }
  });
  test(
      'metadata loads concurrently, publishes early and resume retains live client',
      () async {
    final c = fixture(), api = DelayedMetadata();
    c.api = api;
    c.connected = true;
    final pending = c.resumeConnection();
    expect(api.replies.keys.toSet(),
        {'/api/tasks', '/api/projects', '/api/tools'});
    api.replies['/api/tasks']!.complete({
      'tasks': [
        {'id': 'fast'}
      ],
      'devices': []
    });
    await Future<void>.delayed(Duration.zero);
    expect(c.tasks.single['id'], 'fast');
    expect(c.api, same(api));
    expect(c.connected, true);
    api.replies['/api/projects']!
        .completeError(Exception('offline project list'));
    api.replies['/api/tools']!.complete({'tools': []});
    await pending;
    expect(c.connected, true);
    expect(c.tasks.single['id'], 'fast');
    c.dispose();
  });
  test('proxy startup does not wait for the 1800ms LAN discovery timeout',
      () async {
    final p = TunnelProxy(
        Uri.parse('https://relay.invalid'),
        Uri.parse('https://pc-${'a' * 32}.${'b' * 32}.mydex.invalid'),
        'c' * 43,
        'd' * 64, []);
    final clock = Stopwatch()..start();
    final endpoint = await p.start();
    expect(endpoint, startsWith('127.0.0.1:'));
    expect(clock.elapsedMilliseconds, lessThan(1200));
    p.close();
  });
}
