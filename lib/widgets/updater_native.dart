import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/central_updates.dart';
import 'package:path_provider/path_provider.dart';
import '../services/api.dart';

class UpdateTile extends StatefulWidget {
  final GatewayApi? api;
  const UpdateTile({super.key, this.api});
  @override
  State<UpdateTile> createState() => _UpdateTileState();
}

class _UpdateTileState extends State<UpdateTile> {
  bool busy = false;
  String status = '从 Mydex 统一更新站检查，不需要连接电脑';
  Future<void> check() async {
    // Android update manifests contain APKs and cannot update an iOS app.
    if (!Platform.isAndroid) return;
    final updates = CentralUpdates();
    setState(() {
      busy = true;
      status = '检查更新…';
    });
    try {
      final current = await const MethodChannel('dev.mydex/device')
          .invokeMapMethod<String, dynamic>('appVersion');
      final m = await updates.check();
      if (!mounted) return;
      if ((m['versionCode'] as int) <= (current?['code'] as int? ?? 4)) {
        setState(() => status = '当前版本 ${current?['name'] ?? '0.2.13'} 已是最新');
        return;
      }
      if (!mounted) return;
      final yes = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
                  title: Text('更新到 ${m['version']}'),
                  content:
                      Text(m['notes']?.toString() ?? '下载后由安卓系统确认安装，保留本地设置。'),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(ctx, false),
                        child: const Text('稍后')),
                    FilledButton(
                        onPressed: () => Navigator.pop(ctx, true),
                        child: const Text('下载更新'))
                  ]));
      if (yes != true) return;
      final dir = Directory('${(await getTemporaryDirectory()).path}/updates');
      final file = File('${dir.path}/update.apk');
      await updates.download(m, file, (received, size) {
        if (mounted) {
          setState(
              () => status = '统一更新站下载中 ${(received * 100 / size).floor()}%');
        }
      });
      final opened = await const MethodChannel('dev.mydex/device')
          .invokeMethod<bool>('installUpdate');
      if (mounted) {
        setState(() => status =
            opened == true ? '请在系统界面确认更新' : '允许 Mydex 安装应用后，点击此处重新检查更新');
      }
    } catch (e) {
      if (mounted) setState(() => status = '更新未完成，请检查手机网络后重试；无需连接电脑');
    } finally {
      updates.close();
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => !Platform.isAndroid
      ? const ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(Icons.info_outline),
          title: Text('iOS 测试版本'),
          subtitle: Text('更新需要重新安装有效签名的 iOS 安装包。'),
        )
      : ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.system_update),
          title: const Text('检查更新'),
          subtitle: Text(status),
          trailing: busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.chevron_right),
          onTap: busy ? null : check);
}
