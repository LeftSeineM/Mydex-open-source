import 'dart:convert';
import '../models.dart';
import 'api.dart';

/// QR data is untrusted: restrict destination, pin, lifetime and schema before IO.
Json parseInvitation(String raw, {DateTime? now}) {
  if (raw.length > 4096) throw const FormatException('不是有效的 Mydex 配对二维码');
  final j = jsonDecode(raw);
  if (j is! Map ||
      !['mydex.pair.v1', 'mydex.pair.v2'].contains(j['schema']) ||
      j['baseUrl'] is! String ||
      ConnectionSettings.validate(j['baseUrl']) != null ||
      !j['baseUrl'].startsWith('https://') ||
      j['fingerprint'] is! String ||
      !RegExp(r'^[a-f0-9]{64}$').hasMatch(j['fingerprint']) ||
      j['code'] is! String ||
      !RegExp(r'^[A-Za-z0-9_-]{43}$').hasMatch(j['code']) ||
      j['expiresAt'] is! int ||
      j['name'] is! String ||
      (j['name'] as String).length > 200) {
    throw const FormatException('请扫描电脑版 Mydex 中的配对二维码');
  }
  if (j['expiresAt'] <= (now ?? DateTime.now()).millisecondsSinceEpoch) {
    throw const FormatException('二维码已过期，请在电脑上刷新；也请检查手机时间');
  }
  if (j['schema'] == 'mydex.pair.v2' && (j['relayUrl'] ?? '') == '') {
    throw const FormatException('免账号配对缺少连接服务');
  }
  validateRelayPairing(Map<String, dynamic>.from(j));
  return Map<String, dynamic>.from(j);
}

Future<Json> redeemInvitation(Json invitation) async {
  final api = GatewayApi(ConnectionSettings(
      baseUrl: invitation['baseUrl'],
      fingerprint: invitation['fingerprint'],
      relayUrl: invitation['relayUrl'] ?? '',
      relayToken: invitation['relayToken'] ?? '',
      directUrls: directAddresses(invitation['directUrls']),
      mesh: invitation['mesh'] == true));
  try {
    final result =
        await api.post('/api/pairing/redeem', {'code': invitation['code']});
    return parsePairing(jsonEncode(
        {...invitation, 'token': result['token'], 'name': result['name']}));
  } finally {
    api.close();
  }
}
