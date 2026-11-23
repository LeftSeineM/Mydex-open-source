import 'dart:convert';

typedef Json = Map<String, dynamic>;

/// Import only connection fields. A pairing bundle never supplies executable instructions.
Json parsePairing(String text) {
  if (text.length > 16384) throw const FormatException('配对信息过长');
  Json j;
  final start = text.indexOf('{');
  if (start >= 0) {
    final value = jsonDecode(text.substring(start).trim());
    if (value is! Map) throw const FormatException('配对信息格式不正确');
    j = Map<String, dynamic>.from(value);
  } else {
    String field(String label) =>
        RegExp('$label[：:]\\s*([^\\r\\n]+)')
            .firstMatch(text)
            ?.group(1)
            ?.trim() ??
        '';
    j = {
      'baseUrl': field('后端地址'),
      'token': field('访问令牌'),
      'fingerprint': field('证书 SHA-256 指纹')
    };
  }
  final address = (j['baseUrl'] ?? j['address'] ?? '')
      .toString()
      .trim()
      .replaceAll(RegExp(r'/$'), '');
  final token = (j['token'] ?? '').toString().trim();
  final pin = (j['fingerprint'] ?? '')
      .toString()
      .replaceAll(RegExp(r'[:\s]'), '')
      .toLowerCase();
  if (ConnectionSettings.validate(address) != null ||
      token.length < 24 ||
      RegExp(r'\s').hasMatch(token) ||
      (pin.isNotEmpty && !RegExp(r'^[a-f0-9]{64}$').hasMatch(pin))) {
    throw const FormatException('未找到完整有效的地址、令牌或证书指纹');
  }
  validateRelayPairing(j);
  return {
    'name': (j['name'] ?? Uri.parse(address).host).toString(),
    'baseUrl': address,
    'token': token,
    'fingerprint': pin,
    'mesh': j['mesh'] == true,
    'relayUrl': j['relayUrl'] ?? '',
    'relayToken': j['relayToken'] ?? '',
    'directUrls': directAddresses(j['directUrls'])
  };
}

List<String> directAddresses(dynamic raw) {
  if (raw is! List) return const [];
  return raw
      .whereType<String>()
      .where((value) {
        final u = Uri.tryParse(value);
        return u != null &&
            u.scheme == 'https' &&
            u.host.isNotEmpty &&
            u.userInfo.isEmpty &&
            !u.hasQuery &&
            !u.hasFragment &&
            (u.path.isEmpty || u.path == '/');
      })
      .take(8)
      .toList();
}

void validateRelayPairing(Json j) {
  if ((j['relayUrl'] ?? '') == '') return;
  final relay = Uri.tryParse(j['relayUrl'].toString());
  final target = Uri.tryParse(j['baseUrl'].toString());
  if (relay == null ||
      relay.scheme != 'https' ||
      relay.host.isEmpty ||
      relay.userInfo.isNotEmpty ||
      relay.hasQuery ||
      relay.hasFragment ||
      (relay.path.isNotEmpty && relay.path != '/') ||
      target == null ||
      target.scheme != 'https' ||
      target.port != 443 ||
      !RegExp(r'^pc-[a-f0-9]{32}\.[a-f0-9]{32}\.mydex\.invalid$')
          .hasMatch(target.host) ||
      !RegExp(r'^[A-Za-z0-9_-]{43}$')
          .hasMatch((j['relayToken'] ?? '').toString()) ||
      !RegExp(r'^[a-f0-9]{64}$')
          .hasMatch((j['fingerprint'] ?? '').toString())) {
    throw const FormatException('免账号配对信息不完整，请重新扫码');
  }
}

class ConnectionSettings {
  final String baseUrl, token, fingerprint;
  final String relayUrl, relayToken;
  final List<String> directUrls;
  final bool dark;
  final bool predictions;
  final bool mesh;
  final double textScale;
  const ConnectionSettings(
      {this.baseUrl = '',
      this.token = '',
      this.fingerprint = '',
      this.relayUrl = '',
      this.relayToken = '',
      this.directUrls = const [],
      this.dark = false,
      this.textScale = 1,
      this.predictions = false,
      this.mesh = false});
  factory ConnectionSettings.fromJson(Json j) => ConnectionSettings(
      baseUrl: j['baseUrl'] ?? '',
      token: j['token'] ?? '',
      fingerprint: j['fingerprint'] ?? '',
      relayUrl: (j['relayUrl'] == 'https://app.leftseinem.com')
          ? 'https://app.leftseinem.dpdns.org'
          : (j['relayUrl'] ?? ''),
      relayToken: j['relayToken'] ?? '',
      directUrls: directAddresses(j['directUrls']),
      dark: j['dark'] ?? false,
      predictions: j['predictions'] == true,
      mesh: j['mesh'] == true,
      textScale: j['textScale'] is num
          ? (j['textScale'] as num).toDouble().clamp(.6, 2.0)
          : 1);
  Json toJson() => {
        'baseUrl': baseUrl,
        'token': token,
        'fingerprint': fingerprint,
        'relayUrl': relayUrl,
        'relayToken': relayToken,
        'directUrls': directUrls,
        'dark': dark,
        'textScale': textScale,
        'predictions': predictions,
        'mesh': mesh
      };
  bool get configured => baseUrl.isNotEmpty && token.isNotEmpty;
  static String? validate(String value) {
    final u = Uri.tryParse(value.trim());
    if (u == null ||
        !['http', 'https'].contains(u.scheme) ||
        u.host.isEmpty ||
        u.userInfo.isNotEmpty ||
        u.hasQuery ||
        u.hasFragment ||
        (u.path.isNotEmpty && u.path != '/')) {
      return '请填写 http(s)://主机:端口，不含路径或账号';
    }
    return null;
  }
}

String statusLabel(String? status) => switch (status) {
      'Running' => '运行中',
      'AwaitingApproval' => '待审批',
      'Completed' => '已完成',
      'Failed' => '失败 / 已中断',
      _ => '等待中',
    };

List<Json> objects(dynamic value) => value is List
    ? value.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
    : [];
