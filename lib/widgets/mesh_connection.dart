import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/mesh.dart';

class MeshConnection extends StatefulWidget {
  final bool enabled;
  final ValueChanged<bool> onChanged;
  const MeshConnection(
      {super.key, required this.enabled, required this.onChanged});
  @override
  State<MeshConnection> createState() => _MeshConnectionState();
}

class _MeshConnectionState extends State<MeshConnection> {
  Timer? timer;
  bool busy = false;
  String state = '', authUrl = '', error = '';
  @override
  void initState() {
    super.initState();
    if (widget.enabled) refresh();
    timer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (widget.enabled) refresh();
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  Future<void> refresh() async {
    if (busy) return;
    busy = true;
    try {
      final value = await MeshNetwork.status();
      if (mounted) {
        setState(() {
          state = value['state']?.toString() ?? '';
          authUrl = value['authUrl']?.toString() ?? '';
          error = '';
        });
      }
    } catch (_) {
      if (mounted) setState(() => error = '组网连接暂不可用，请检查网络后重试');
    } finally {
      busy = false;
    }
  }

  Future<void> login() async {
    try {
      await refresh();
      if (state == 'Running') return;
      if (authUrl.isEmpty) {
        await MeshNetwork.login();
        await refresh();
      }
      if (authUrl.isNotEmpty) {
        await MeshNetwork.openLogin(authUrl);
      } else if (mounted) {
        setState(() => error = '正在获取登录链接，请稍后再点登录');
      }
    } catch (_) {
      if (mounted) setState(() => error = '暂时无法登录，请检查网络后重试');
    }
  }

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            title: const Text('内置跨网络连接'),
            subtitle: const Text('手机只装 Mydex · 不依赖小主机转发'),
            value: widget.enabled,
            onChanged: (v) {
              widget.onChanged(v);
              if (v) refresh();
            },
          ),
          if (widget.enabled) ...[
            const Text(
                '首次登录与电脑相同的 Tailscale 账号。后端地址填写电脑的 Tailscale IP，保留 HTTPS 和端口。登录及必要时的中继由 Tailscale 提供，仅承载 Mydex 连接。',
                style: TextStyle(fontSize: 12, color: Colors.grey)),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: state == 'Running' ? refresh : login,
              icon: Icon(
                  state == 'Running' ? Icons.check_circle_outline : Icons.link),
              label: Text(state == 'Running' ? '组网已连接 · 刷新状态' : '登录 Tailscale'),
            ),
            if (error.isNotEmpty)
              Text(error,
                  style: TextStyle(color: Theme.of(context).colorScheme.error)),
            TextButton(
              onPressed: () async {
                final notices =
                    await rootBundle.loadString('assets/mesh-notices.txt');
                if (!context.mounted) return;
                showDialog<void>(
                    context: context,
                    builder: (ctx) => AlertDialog(
                          title: const Text('网络组件开源许可'),
                          content: SizedBox(
                              width: 600,
                              child: SingleChildScrollView(
                                  child: SelectableText(notices,
                                      style: const TextStyle(fontSize: 12)))),
                          actions: [
                            TextButton(
                                onPressed: () => Navigator.pop(ctx),
                                child: const Text('关闭'))
                          ],
                        ));
              },
              child: const Text('网络组件开源许可'),
            ),
            const SizedBox(height: 16),
          ],
        ],
      );
}
