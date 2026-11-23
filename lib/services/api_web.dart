// Browser-only implementation selected by a conditional export.
// ignore_for_file: avoid_web_libraries_in_flutter
import 'dart:async';
import 'dart:convert';
import 'dart:html' as html;
import 'dart:math';
import 'dart:typed_data';
import '../models.dart';
import 'api_exception.dart';
import 'web_socket.dart';

class GatewayApi {
  final ConnectionSettings settings;
  GatewayApi(this.settings);
  Uri uri(String path) {
    final base = Uri.parse(settings.baseUrl);
    if (base.scheme != 'https' || base.userInfo.isNotEmpty) {
      throw ApiException('网页版需要浏览器信任的 HTTPS 地址');
    }
    final relay = base.path.startsWith('/c/');
    if (relay && base.origin != Uri.base.origin) throw ApiException('中继必须与网页同源');
    final target = relay ? base.replace(path: '${base.path.replaceFirst(RegExp(r"/$"), "")}/').resolve(path.replaceFirst(RegExp(r'^/'), '')) : base.resolve(path);
    if (target.origin != base.origin) throw ApiException('内容地址不属于当前电脑');
    return target;
  }
  static String requestId() {
    final random = Random.secure();
    return List.generate(24, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  }
  Future<Uint8List> bytes(String path,
      {String method = 'GET', Json? body, String? requestId}) async {
    final relay = Uri.parse(settings.baseUrl).path.startsWith('/c/');
    final headers = <String,String>{if (!relay) 'Authorization': 'Bearer ${settings.token}'};
    if (body != null) {
      headers['Content-Type'] = 'application/json';
      headers['Idempotency-Key'] = requestId ?? GatewayApi.requestId();
    }
    try {
      final response = await html.HttpRequest.request(uri(path).toString(),
          method: method, requestHeaders: headers, responseType: 'arraybuffer', withCredentials: relay,
          sendData: body == null ? null : jsonEncode(body))
          .timeout(const Duration(seconds: 55));
      final data = Uint8List.view(response.response as ByteBuffer);
      if (data.length > 24 * 1024 * 1024) throw ApiException('返回内容过大');
      return data;
    } on TimeoutException {
      throw ApiException(method == 'POST' ? '结果尚未确认，请查看会话后再操作' : '连接超时');
    } on html.ProgressEvent catch (e) {
      final request = e.target;
      if (request is html.HttpRequest && request.status == 401 && relay) html.window.location.replace('/connect/');
      throw ApiException('连接失败，请检查 HTTPS 地址、令牌及电脑端网页访问设置',
          request is html.HttpRequest ? request.status : null);
    }
  }
  Future<Json> get(String path) async => Map<String, dynamic>.from(jsonDecode(utf8.decode(await bytes(path))));
  Future<Json> post(String path, Json body, {String? requestId}) async =>
      Map<String, dynamic>.from(jsonDecode(utf8.decode(await bytes(path, method: 'POST', body: body, requestId: requestId))));
  Future<WebSocket> connect() async {
    // Exchange the bearer over HTTPS for a single-use, 30-second socket ticket.
    // Never put the persistent bearer in a WebSocket URL.
    final ticket = await post('/api/web/ticket', {});
    final url = uri('/ws').replace(scheme: 'wss', queryParameters: {'ticket': ticket['ticket'] as String});
    final socket = html.WebSocket(url.toString());
    final wrapper = WebSocket(socket);
    try {
      await socket.onOpen.first.timeout(const Duration(seconds: 15));
      return wrapper;
    } catch (_) {
      await wrapper.close();
      rethrow;
    }
  }
  void close() {}
}
