import 'dart:io';
import 'package:crypto/crypto.dart';
import '../models.dart';
import 'api_native.dart';
import 'api_exception.dart';

/// Private builds stay on the already-paired, authenticated gateway channel.
/// They never consult the public site or follow a manifest-supplied download URL.
class PrivateUpdates {
  static const _legacyApk = '/api/update/apk';
  static const _streamApk = '/api/update/stream/apk';
  final GatewayApi api;
  PrivateUpdates(this.api);
  Json validate(Json manifest) {
    if (manifest['channel'] != 'router-private' ||
        manifest['versionCode'] is! int ||
        (manifest['versionCode'] as int) <= 0 ||
        manifest['version'] is! String ||
        (manifest['version'] as String).length > 80 ||
        manifest['size'] is! int ||
        (manifest['size'] as int) <= 0 ||
        (manifest['size'] as int) > 256 * 1024 * 1024 ||
        !RegExp(r'^[a-f0-9]{64}$')
            .hasMatch(manifest['sha256']?.toString() ?? '') ||
        ![null, _legacyApk, _streamApk].contains(manifest['url'])) {
      throw const FormatException('私测更新清单无效');
    }
    return manifest;
  }

  Future<Json> check() async {
    try {
      final manifest = validate(await api.get('/api/update/stream'));
      if (manifest['url'] != _streamApk) throw const FormatException('更新路径不匹配');
      return manifest;
    } on ApiException catch (error) {
      if (error.status != 404) rethrow;
      final manifest = validate(await api.get('/api/update'));
      if (manifest['url'] == _streamApk) throw const FormatException('更新路径不匹配');
      return manifest;
    }
  }
  Future<void> download(
      Json manifest, File target, void Function(int, int) progress) async {
    final m = validate(manifest), size = m['size'] as int;
    progress(0, size);
    await target.parent.create(recursive: true);
    final stage = await target.parent.createTemp('.mydex-update-');
    final part = File('${stage.path}/update.apk');
    try {
      final digest = _DigestSink();
      final hasher = sha256.startChunkedConversion(digest);
      final file = await part.open(mode: FileMode.write);
      var received = 0;
      try {
        await for (final chunk in api.privateUpdateBytes(m['url'] as String? ?? _legacyApk)) {
          received += chunk.length;
          if (received > size) throw const FormatException('私测更新包大小超出清单');
          hasher.add(chunk);
          await file.writeFrom(chunk);
          if (received < size) progress(received, size);
        }
        await file.flush();
      } finally {
        await file.close();
        hasher.close();
      }
      if (received != size || digest.value.toString() != m['sha256']) {
        throw const FormatException('私测更新包校验失败');
      }
      await part.rename(target.path);
      progress(size, size);
    } finally {
      if (await part.exists()) await part.delete();
      await stage.delete();
    }
  }
}

class _DigestSink implements Sink<Digest> {
  Digest? value;
  @override
  void add(Digest data) => value = data;
  @override
  void close() {}
}
