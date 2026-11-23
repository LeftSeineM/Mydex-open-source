import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/pairing.dart';

void main() {
  test('saved first-party .com relay migrates to old origin', () {
    final settings = ConnectionSettings.fromJson({
      'baseUrl': 'https://example.org',
      'relayUrl': 'https://app.leftseinem.com'
    });
    expect(settings.relayUrl, 'https://app.leftseinem.dpdns.org');
    final custom = ConnectionSettings.fromJson({
      'baseUrl': 'https://example.org',
      'relayUrl': 'https://relay.example.org'
    });
    expect(custom.relayUrl, 'https://relay.example.org');
  });
  final now = DateTime.fromMillisecondsSinceEpoch(1000);
  final valid = {
    'schema': 'mydex.pair.v1',
    'baseUrl': 'https://192.0.2.1:18443',
    'name': '演示电脑',
    'fingerprint': 'a' * 64,
    'code': 'b' * 43,
    'expiresAt': 121000
  };
  test(
      'QR parsing rejects redirects, insecure URLs, expired and malformed credentials',
      () {
    expect(parseInvitation(jsonEncode(valid), now: now)['name'], '演示电脑');
    for (final change in [
      {'baseUrl': 'http://192.0.2.1'},
      {'baseUrl': 'https://user@192.0.2.1'},
      {'baseUrl': 'https://192.0.2.1/path'},
      {'expiresAt': 1000},
      {'fingerprint': ''},
      {'code': 'short'},
      {'schema': 'other'},
      {'name': null}
    ]) {
      expect(() => parseInvitation(jsonEncode({...valid, ...change}), now: now),
          throwsFormatException);
    }
  });
}

