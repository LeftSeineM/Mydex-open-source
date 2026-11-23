import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import '../models.dart';

/// Updates use the release site, never the selected computer's API or token.
class CentralUpdates {
  final Uri origin;
  final HttpClient client;
  CentralUpdates({Uri? origin, HttpClient? client})
      : origin = origin ?? Uri.parse('https://app.leftseinem.dpdns.org'),
        client = client ??
            (HttpClient()..connectionTimeout = const Duration(seconds: 15));

  Json validate(Json m) {
    final url = Uri.tryParse(m['url']?.toString() ?? '');
    if (m['versionCode'] is! int ||
        (m['versionCode'] as int) <= 0 ||
        m['version'] is! String ||
        (m['version'] as String).length > 80 ||
        m['size'] is! int ||
        (m['size'] as int) <= 0 ||
        (m['size'] as int) > 200 * 1024 * 1024 ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(m['sha256']?.toString() ?? '') ||
        url == null ||
        url.origin != origin.origin ||
        url.userInfo.isNotEmpty ||
        url.hasQuery ||
        url.hasFragment ||
        !RegExp(r'^/downloads/Mydex-[a-zA-Z0-9.+-]+\.apk$')
            .hasMatch(url.path)) {
      throw const FormatException('更新清单无效，请稍后重试');
    }
    return m;
  }

  Future<Json> check() async {
    final req =
        await client.getUrl(origin.resolve('/updates/android-stable.json'));
    req.followRedirects = false;
    req.headers.set(HttpHeaders.cacheControlHeader, 'no-cache');
    final res = await req.close().timeout(const Duration(seconds: 30));
    if (res.statusCode != 200) {
      await res.drain<void>();
      throw const HttpException('统一更新站暂不可用');
    }
    final bytes = <int>[];
    await for (final chunk in res.timeout(const Duration(seconds: 30))) {
      bytes.addAll(chunk);
      if (bytes.length > 65536) throw const FormatException('更新清单过大');
    }
    return validate(
        Map<String, dynamic>.from(jsonDecode(utf8.decode(bytes)) as Map));
  }

  Future<void> download(
      Json manifest, File target, void Function(int, int) progress) async {
    final m = validate(manifest), size = manifest['size'] as int;
    final partial = File('${target.parent.path}/${m['sha256']}.part');
    await target.parent.create(recursive: true);
    if (await target.exists() &&
        await target.length() == size &&
        (await sha256.bind(target.openRead()).first).toString() ==
            m['sha256']) {
      progress(size, size);
      return;
    }
    final elapsed = Stopwatch()..start();
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var received = await partial.exists() ? await partial.length() : 0;
        if (received > size) {
          await partial.delete();
          received = 0;
        }
        if (received < size) {
          final req = await client.getUrl(Uri.parse(m['url']));
          req.followRedirects = false;
          if (received > 0) {
            req.headers.set(HttpHeaders.rangeHeader, 'bytes=$received-');
          }
          final res = await req.close().timeout(const Duration(seconds: 30));
          if (res.statusCode == 200) {
            received = 0;
          } else if (res.statusCode != 206 ||
              received == 0 ||
              res.headers.value(HttpHeaders.contentRangeHeader) !=
                  'bytes $received-${size - 1}/$size') {
            await res.drain<void>();
            throw const HttpException('更新下载响应无效');
          }
          final sink = partial.openWrite(
              mode: received == 0 ? FileMode.write : FileMode.append);
          try {
            await for (final chunk
                in res.timeout(const Duration(seconds: 30))) {
              if (elapsed.elapsed > const Duration(minutes: 10)) {
                throw const HttpException('下载超时，请稍后重试');
              }
              received += chunk.length;
              if (received > size) throw const FormatException('更新包长度不符');
              sink.add(chunk);
              progress(received, size);
            }
          } finally {
            await sink.close();
          }
        }
        if (await partial.length() != size) throw const HttpException('下载中断');
        if ((await sha256.bind(partial.openRead()).first).toString() !=
            m['sha256']) {
          await partial.delete();
          throw const FormatException('更新包校验失败');
        }
        if (await target.exists()) await target.delete();
        await partial.rename(target.path);
        return;
      } on FormatException {
        rethrow;
      } catch (_) {
        if (attempt == 2) rethrow;
      }
    }
  }

  void close() => client.close(force: true);
}
