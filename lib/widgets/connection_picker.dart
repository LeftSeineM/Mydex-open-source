import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import '../controller.dart';
import '../pages/settings.dart';
import '../services/account_navigation.dart';

class ConnectionPicker extends StatelessWidget {
  final AppController controller;
  const ConnectionPicker({super.key, required this.controller});
  @override
  Widget build(BuildContext context) {
    final c = controller;
    final connections = {
      for (final p in c.connections)
        (p['baseUrl'] as String).replaceFirst(RegExp(r'/+$'), ''): p
    }.values.toList();
    return Row(children: [
      Expanded(
          child: DropdownButtonFormField<String>(
        isExpanded: true,
        value: AppController.superagentTest && c.isSuperagent
            ? '__superagent__'
            : connections.any((p) => p['baseUrl'] == c.settings.baseUrl)
                ? c.settings.baseUrl
                : null,
        decoration: const InputDecoration(
            labelText: '电脑',
            isDense: true,
            contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12)),
        items: [
          ...connections.map((p) => DropdownMenuItem<String>(
              value: p['baseUrl'],
              child: Text(p['name'],
                  style: const TextStyle(fontSize: 13),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis))),
          if (AppController.superagentTest)
            const DropdownMenuItem<String>(
                value: '__superagent__',
                child: Row(children: [
                  Icon(Icons.hub_outlined, size: 17),
                  SizedBox(width: 8),
                  Text('项目进展台 · 测试', style: TextStyle(fontSize: 13)),
                ])),
        ],
        onChanged: c.sending
            ? null
            : (v) async {
                if (v == null) return;
                try {
                  if (v == '__superagent__') {
                    await c.connectSuperagent();
                    return;
                  }
                  if (v == c.settings.baseUrl) {
                    final normal = c.devices
                        .where((d) => d['id'] != 'superagent')
                        .firstOrNull;
                    if (normal != null) c.chooseDevice(normal['id']);
                    return;
                  }
                  await c.switchConnection(
                      connections.firstWhere((p) => p['baseUrl'] == v));
                } catch (e) {
                  if (context.mounted) {
                    ScaffoldMessenger.of(context)
                        .showSnackBar(SnackBar(content: Text(e.toString())));
                  }
                }
              },
      )),
      IconButton(
          tooltip: '添加电脑',
          icon: const Icon(Icons.add, size: 20),
          constraints: const BoxConstraints(minWidth: 36, minHeight: 44),
          padding: const EdgeInsets.all(6),
          onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(
                  builder: (_) => SettingsPage(controller: c, addNew: true)))),
      if (c.settings.configured)
        IconButton(
          tooltip: '删除这台电脑',
          icon: const Icon(Icons.delete_outline, size: 20),
          onPressed: c.sending || c.approving.isNotEmpty
              ? null
              : () async {
                  final address = c.settings.baseUrl;
                  final yes = await showDialog<bool>(
                      context: context,
                      builder: (ctx) => AlertDialog(
                            title: Text('删除“${c.connectionName}”？'),
                            content: Text(kIsWeb
                                ? '解除此账号与这台电脑的绑定，电脑上的项目和对话不会被删除。重新使用需要再次配对。'
                                : '从这部手机移除这台电脑及其连接凭据、当前会话缓存。电脑上的项目和对话不会被删除。'),
                            actions: [
                              TextButton(
                                  onPressed: () => Navigator.pop(ctx, false),
                                  child: const Text('取消')),
                              FilledButton(
                                  onPressed: () => Navigator.pop(ctx, true),
                                  child: const Text('删除设备'))
                            ],
                          ));
                  if (yes != true) return;
                  try {
                    if (kIsWeb) {
                      await removeWebComputer(address);
                      openAccountPortal();
                    } else {
                      await c.forgetConnection(address);
                    }
                  } catch (e) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context)
                          .showSnackBar(SnackBar(content: Text('删除未完成：$e')));
                    }
                  }
                },
        )
    ]);
  }
}
