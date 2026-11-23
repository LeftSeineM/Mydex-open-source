import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'api_exception.dart';
import 'lan_discovery.dart';
import 'p2p_native.dart';

/// Only transports the gateway's TLS bytes. Certificate pinning and Bearer
/// authentication stay end-to-end inside GatewayApi, including live WebSocket.
class TunnelProxy {
  final Uri relay, target;
  final String access;
  final String fingerprint;
  final List<String> directUrls;
  P2pTransport? p2p;
  String? lastRoute;
  HttpServer? _server;
  final HttpClient _relayClient = HttpClient()
    ..connectionTimeout = const Duration(seconds: 12);
  final _sockets = <Socket>{};
  final _streams = <WebSocket>{};
  bool _closed = false;
  late String password;
  TunnelProxy(
      this.relay, this.target, this.access, this.fingerprint, this.directUrls);

  Future<String> start() async {
    if (relay.scheme != 'https' ||
        relay.path.isNotEmpty && relay.path != '/' ||
        relay.userInfo.isNotEmpty ||
        relay.hasQuery ||
        relay.hasFragment ||
        !RegExp(r'^pc-[a-f0-9]{32}\.[a-f0-9]{32}\.mydex\.invalid$')
            .hasMatch(target.host) ||
        target.scheme != 'https' ||
        target.port != 443 ||
        !RegExp(r'^[A-Za-z0-9_-]{43}$').hasMatch(access)) {
      throw ApiException('配对连接信息无效，请重新扫码');
    }
    password =
        base64UrlEncode(List.generate(32, (_) => Random.secure().nextInt(256)))
            .replaceAll('=', '');
    ({String host, int port})? direct;
    // Mobile data has no LAN peer: discovery must not delay the relay path.
    // Every discovered endpoint is pinned by discovery AND the inner TLS client.
    unawaited(
        discoverComputer(fingerprint, candidates: directUrls).then((value) {
      if (!_closed) direct = value;
    }).catchError((_) {}));
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    if (_closed) {
      await server.close(force: true);
      throw ApiException('连接已关闭');
    }
    _server = server;
    server.listen((req) async {
      if (req.method != 'CONNECT' ||
          req.uri.toString() != '${target.host}:443' ||
          req.headers.value('proxy-authorization') !=
              'Basic ${base64Encode(utf8.encode('mydex:$password'))}') {
        req.response.statusCode = 403;
        await req.response.close();
        return;
      }
      WebSocket? ws;
      Socket? socket;
      final endpointDirect = direct;
      if (endpointDirect != null) {
        Socket? upstream;
        try {
          upstream = await Socket.connect(
              endpointDirect.host, endpointDirect.port,
              timeout: const Duration(seconds: 2));
          if (_closed) {
            upstream.destroy();
            throw ApiException('连接已关闭');
          }
          socket = await req.response.detachSocket(writeHeaders: false);
          _sockets.addAll([socket, upstream]);
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          lastRoute = '局域网直连';
          final a = socket, b = upstream;
          void end() {
            _sockets.remove(a);
            _sockets.remove(b);
            a.destroy();
            b.destroy();
          }

          a.listen(b.add, onError: (_) => end(), onDone: end);
          b.listen(a.add, onError: (_) => end(), onDone: end);
          return;
        } catch (_) {
          upstream?.destroy();
        }
      }
      final directStream = await p2p?.open();
      if (directStream != null) {
        try {
          if (_closed) throw StateError('Tunnel closed');
          final channelSocket = await req.response.detachSocket(writeHeaders: false);
          _sockets.add(channelSocket);
          channelSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          lastRoute = 'P2P 直连';
          directStream.attach(channelSocket, () => _sockets.remove(channelSocket));
          return;
        } catch (_) { directStream.close(); }
      }
      unawaited(p2p?.warm());
      final ready = Completer<void>();
      void cleanup() {
        if (!ready.isCompleted) {
          ready.completeError(ApiException('电脑连接中断，请稍后重试'));
        }
        if (socket != null) {
          _sockets.remove(socket);
          socket.destroy();
        }
        if (ws != null) {
          _streams.remove(ws);
          unawaited(ws.close());
        }
      }

      try {
        final parts = target.host.split('.');
        final room = parts[0].substring(3) + parts[1];
        final endpoint =
            relay.replace(scheme: 'wss', path: '/v1/connect/$room');
        ws = await WebSocket.connect(endpoint.toString(),
                customClient: _relayClient,
                headers: {HttpHeaders.authorizationHeader: 'Bearer $access'})
            .timeout(const Duration(seconds: 15));
        _streams.add(ws);
        ws.pingInterval = const Duration(seconds: 20);
        ws.listen((data) {
          if (data is String) {
            if (data == '{"type":"ready"}' && !ready.isCompleted) {
              ready.complete();
            } else {
              cleanup();
            }
          } else if (data is List<int> && ready.isCompleted && socket != null) {
            socket.add(data);
          } else {
            cleanup();
          }
        }, onError: (_) => cleanup(), onDone: cleanup);
        await ready.future.timeout(const Duration(seconds: 15));
        if (_closed) throw ApiException('连接已关闭');
        socket = await req.response.detachSocket(writeHeaders: false);
        _sockets.add(socket);
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        lastRoute = '加密中继';
        socket.listen((data) => ws?.add(data),
            onError: (_) => cleanup(), onDone: cleanup);
      } catch (_) {
        // Before detach, fail the CONNECT; never fall back to an unpinned host.
        try {
          req.response.statusCode = 502;
          await req.response.close();
        } catch (_) {}
        if (!ready.isCompleted) {
          ready.complete();
        }
        cleanup();
      }
    });
    return '127.0.0.1:${server.port}';
  }

  void close() {
    _closed = true;
    p2p?.close();
    _relayClient.close();
    unawaited(_server?.close(force: true));
    for (final ws in _streams.toList()) {
      unawaited(ws.close());
    }
    for (final socket in _sockets.toList()) {
      socket.destroy();
    }
    _streams.clear();
    _sockets.clear();
  }
}
