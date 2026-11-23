import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import '../models.dart';

import 'api_exception.dart';
import 'mesh_proxy.dart';
import 'tunnel_proxy.dart';

class GatewayApi {
  final ConnectionSettings settings;
  late final HttpClient client;
  Future<void>? _networkReady;
  TunnelProxy? _tunnel;
  Future<void> prepareNetwork() => _networkReady ??= _prepareNetwork();
  Future<void> _prepareNetwork() async {
    if (settings.relayUrl.isNotEmpty) {
      if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(settings.fingerprint)) {
        throw ApiException('免账号连接缺少电脑证书指纹，请重新扫码');
      }
      final tunnel = TunnelProxy(
          Uri.parse(settings.relayUrl),
          Uri.parse(settings.baseUrl),
          settings.relayToken,
          settings.fingerprint,
          settings.directUrls);
      _tunnel = tunnel;
      try {
        final endpoint = await tunnel.start();
        configureMeshProxy(client, endpoint, tunnel.password);
      } catch (_) {
        tunnel.close();
        _networkReady = null;
        rethrow;
      }
      return;
    }
    if (settings.mesh) {
      throw ApiException('旧版组网连接已停用，请更新电脑连接器后重新扫描应用版二维码');
    }
  }

  GatewayApi(this.settings) {
    final pin =
        settings.fingerprint.replaceAll(RegExp(r'[:\s]'), '').toLowerCase();
    client = HttpClient(context: SecurityContext(withTrustedRoots: pin.isEmpty))
      ..connectionTimeout = const Duration(seconds: 12);
    if (pin.isNotEmpty) {
      client.badCertificateCallback = (cert, host, port) =>
          host == Uri.parse(settings.baseUrl).host &&
          sha256.convert(cert.der).toString() == pin;
    }
  }
  Uri uri(String path) {
    final base = Uri.parse(settings.baseUrl);
    final result = base.resolve(path);
    if (result.origin != base.origin || result.userInfo.isNotEmpty) {
      throw ApiException('只允许加载当前后端的内容');
    }
    return result;
  }

  static String requestId() {
    final random = Random.secure();
    return List.generate(
            24, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'))
        .join();
  }

  Future<Uint8List> bytes(String path,
      {String method = 'GET', Json? body, String? requestId}) async {
    try {
      await prepareNetwork();
      final req = await client.openUrl(method, uri(path));
      req.followRedirects =
          false; // Never forward Bearer credentials to another origin.
      req.headers
          .set(HttpHeaders.authorizationHeader, 'Bearer ${settings.token}');
      if (body != null) {
        req.headers.contentType = ContentType.json;
        req.headers.set('Idempotency-Key', requestId ?? GatewayApi.requestId());
        req.write(jsonEncode(body));
      }
      final res = await req.close().timeout(const Duration(seconds: 55));
      final data = BytesBuilder();
      await for (final chunk in res.timeout(const Duration(seconds: 20))) {
        data.add(chunk);
        if (data.length > 24 * 1024 * 1024) {
          throw ApiException(
              '此接口返回的数据超过 24 MiB（${uri(path).path}），请更新电脑连接器后重新打开会话');
        }
      }
      final result = data.takeBytes();
      if (res.statusCode < 200 || res.statusCode >= 300) {
        String? error;
        try {
          error = (jsonDecode(utf8.decode(result)) as Map)['error']?.toString();
        } catch (_) {}
        throw ApiException(error ?? '连接失败 (${res.statusCode})', res.statusCode);
      }
      return result;
    } on ApiException {
      rethrow;
    } on HandshakeException {
      throw ApiException('证书验证失败，请核对服务器证书指纹');
    } on TimeoutException {
      throw ApiException(
          method == 'POST' ? '发送结果尚未确认，请刷新会话核对，勿重复发送' : '连接超时，请检查网络和后端地址');
    } on SocketException {
      throw ApiException('无法连接这台电脑，请检查网络、地址和电脑是否开机');
    } on HttpException {
      throw ApiException('连接中断，请重新连接后查看会话');
    }
  }

  Future<Json> get(String path) async =>
      Map<String, dynamic>.from(jsonDecode(utf8.decode(await bytes(path))));
  Future<Json> post(String path, Json body, {String? requestId}) async =>
      Map<String, dynamic>.from(jsonDecode(utf8.decode(await bytes(path,
          method: 'POST', body: body, requestId: requestId))));
  Future<WebSocket> connect() async {
    await prepareNetwork();
    final url =
        uri('/ws').replace(scheme: uri('/ws').scheme == 'https' ? 'wss' : 'ws');
    return WebSocket.connect(url.toString(),
            headers: {
              HttpHeaders.authorizationHeader: 'Bearer ${settings.token}'
            },
            customClient: client)
        .timeout(const Duration(seconds: 15));
  }

  void close() {
    _tunnel?.close();
    client.close();
  }
}
