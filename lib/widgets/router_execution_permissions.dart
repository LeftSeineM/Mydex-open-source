import 'package:flutter/material.dart';
import '../models.dart';

List<Json> _rows(dynamic value) => (value as List? ?? [])
    .whereType<Map>()
    .map((v) => Map<String, dynamic>.from(v))
    .toList();

/// Returns a proposed grant only after the user presses Save. Never writes here.
Future<Json?> showRouterExecutionPermissions(BuildContext context,
    {required Json job, required Json catalog}) async {
  final execution = Map<String, dynamic>.from(job['execution'] as Map? ?? {});
  final allowed = Set<String>.from(execution['sessions'] as List? ?? []);
  final spaces = Set<String>.from(execution['workspaces'] as List? ?? []);
  int budget = execution['maxNewWindows'] as int? ?? 3;
  bool inheritWorkers = execution['inheritCreatedWorkers'] == true;
  final nodes = _rows(catalog['sessions']);
  final locations = _rows(catalog['workspaces']);
  final okay = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
          builder: (context, change) => AlertDialog(
                title: const Text('Router 执行权限'),
                content: SizedBox(
                    width: 560,
                    child: SingleChildScrollView(
                        child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                          const Text(
                              '只允许勾选的范围。撤销只阻止后续操作，不打断正在运行的任务；高危审批仍由你决定。'),
                          const SizedBox(height: 12),
                          Wrap(spacing: 8, children: [
                            TextButton(
                                onPressed: () => change(() {
                                      allowed.addAll(nodes
                                          .where((n) =>
                                              (job['scope'] as List? ?? [])
                                                  .contains(n['key']) &&
                                              n['capabilities']?['send'] ==
                                                  'supported')
                                          .map((n) => n['key'] as String));
                                      spaces.addAll(locations
                                          .where((w) =>
                                              (job['workspaceScope'] as List? ??
                                                      [])
                                                  .contains(w['key']))
                                          .map((w) => w['key'] as String));
                                      inheritWorkers = true;
                                    }),
                                child: const Text('授权全部可执行范围')),
                            TextButton(
                                onPressed: () => change(() {
                                      allowed.clear();
                                      spaces.clear();
                                      inheritWorkers = false;
                                    }),
                                child: const Text('全部改为仅观察')),
                          ]),
                          const Text('向已有 Worker 派发'),
                          for (final key in job['scope'] as List? ?? [])
                            Builder(builder: (_) {
                              final n = nodes
                                  .where((n) => n['key'] == key)
                                  .firstOrNull;
                              final supported =
                                  n?['capabilities']?['send'] == 'supported';
                              return CheckboxListTile(
                                  value: allowed.contains(key),
                                  title: Text('${n?['title'] ?? key}'),
                                  subtitle: Text(supported
                                      ? '${n?['toolId']} · ${n?['hostName'] ?? n?['device']}'
                                      : '当前不可派发，可撤销已有授权'),
                                  onChanged: supported || allowed.contains(key)
                                      ? (v) => change(() {
                                            if (v == true && supported) {
                                              allowed.add('$key');
                                            } else {
                                              allowed.remove(key);
                                            }
                                          })
                                      : null);
                            }),
                          const Divider(),
                          const Text('允许 Router 新建原桌面窗口'),
                          const Text('沿用电脑账号及当前默认模型。窗口和记录保留在原工具中。',
                              style: TextStyle(fontSize: 12)),
                          for (final key
                              in job['workspaceScope'] as List? ?? [])
                            Builder(builder: (_) {
                              final w = locations
                                  .where((n) => n['key'] == key)
                                  .firstOrNull;
                              return CheckboxListTile(
                                  value: spaces.contains(key),
                                  title: Text('${w?['name'] ?? key}'),
                                  subtitle: Text(w == null
                                      ? '位置暂不可用'
                                      : '${w['toolId']} · ${w['device']}\n${w['path']}'),
                                  onChanged: w != null || spaces.contains(key)
                                      ? (v) => change(() {
                                            if (v == true && w != null) {
                                              spaces.add('$key');
                                            } else {
                                              spaces.remove(key);
                                            }
                                          })
                                      : null);
                            }),
                          if ((job['workspaceScope'] as List? ?? []).isEmpty)
                            const Text('本项目未选择新窗口位置。创建项目时可指定。'),
                          DropdownButtonFormField<int>(
                              value: budget,
                              decoration: const InputDecoration(
                                  labelText: '本项目累计新建窗口上限'),
                              items: List.generate(
                                  11,
                                  (i) => DropdownMenuItem(
                                      value: i, child: Text('$i 个'))),
                              onChanged: (v) => change(() => budget = v ?? 3)),
                          const Text('发送结果未确认的窗口也计入上限，避免断线后重复创建。',
                              style: TextStyle(fontSize: 12)),
                          SwitchListTile(
                              title: const Text('允许 Router 管理新建的 Worker'),
                              subtitle: const Text('仅限已授权工作区内核验成功的新会话，免去逐个授权。'),
                              value: inheritWorkers,
                              onChanged: (v) =>
                                  change(() => inheritWorkers = v)),
                        ]))),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context, false),
                      child: const Text('取消')),
                  FilledButton(
                      onPressed: () => Navigator.pop(context, true),
                      child: const Text('保存授权'))
                ],
              )));
  if (okay != true) return null;
  return {
    'jobId': job['id'],
    'expectedRevision': execution['revision'] ?? 0,
    'sessions': allowed.toList(),
    'workspaces': spaces.toList(),
    'maxNewWindows': budget,
    'inheritCreatedWorkers': inheritWorkers
  };
}
