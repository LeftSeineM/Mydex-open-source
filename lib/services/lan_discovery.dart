import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:crypto/crypto.dart';

Future<({String host, int port})?> discoverComputer(String fingerprint,
    {List<String> candidates = const []}) async {
  RawDatagramSocket? socket;
  final result = Completer<({String host, int port})?>();
  var probes = 0;
  Future<void> probe(String host, int port) async {
    try {
      final tls = await SecureSocket.connect(host, port,
          context: SecurityContext(withTrustedRoots: false),
          onBadCertificate: (cert) =>
              sha256.convert(cert.der).toString() == fingerprint,
          timeout: const Duration(milliseconds: 1500));
      final matched = tls.peerCertificate != null &&
          sha256.convert(tls.peerCertificate!.der).toString() == fingerprint;
      tls.destroy();
      if (matched && !result.isCompleted) {
        result.complete((host: host, port: port));
      }
    } catch (_) {}
  }

  for (final value in candidates.take(8)) {
    final u = Uri.tryParse(value);
    if (u != null && u.scheme == 'https' && u.userInfo.isEmpty) {
      unawaited(probe(u.host, u.port));
    }
  }
  final random = Random.secure();
  final nonce = List.generate(
      16, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  try {
    socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
    socket.broadcastEnabled = true;
    socket.listen((event) async {
      final packet = socket?.receive();
      if (packet == null ||
          packet.data.length > 512 ||
          probes >= 4 ||
          result.isCompleted) {
        return;
      }
      try {
        final m = jsonDecode(utf8.decode(packet.data));
        if (m['type'] != 'mydex.discover.v1' ||
            m['nonce'] != nonce ||
            m['port'] is! int ||
            m['port'] < 1 ||
            m['port'] > 65535) {
          return;
        }
        ++probes;
        await probe(packet.address.address, m['port'] as int);
      } catch (_) {/* Untrusted discovery responses never change identity. */}
    });
    socket.send(
        utf8.encode(jsonEncode({
          'type': 'mydex.discover.v1',
          'nonce': nonce,
          'fingerprint': fingerprint
        })),
        InternetAddress('255.255.255.255'),
        18445);
    return await result.future
        .timeout(const Duration(milliseconds: 1800), onTimeout: () => null);
  } catch (_) {
    return await result.future
        .timeout(const Duration(milliseconds: 1800), onTimeout: () => null);
  } finally {
    socket?.close();
  }
}
