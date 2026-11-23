import 'dart:convert';
import 'dart:io';
import '../lib/services/central_updates.dart';

Future<void> main(List<String> args) async {
  final expected = jsonDecode(await File(args[0]).readAsString()) as Map;
  final client = CentralUpdates();
  try {
    final m = await client.check();
    if (m['versionCode'] != expected['versionCode'] ||
        m['sha256'] != expected['sha256'])
      throw const FormatException('Public feed mismatch');
    final target = File(args[1]);
    await client.download(m, target, (_, __) {});
    stdout.writeln(jsonEncode({
      'version': m['version'],
      'versionCode': m['versionCode'],
      'downloadSize': await target.length(),
      'publicSha256Verified': true,
      'pairedComputerRequired': false,
      'computerTokenUsed': false
    }));
  } finally {
    client.close();
  }
}
