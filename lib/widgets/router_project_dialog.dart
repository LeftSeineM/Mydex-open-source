import 'package:flutter/material.dart';
import '../models.dart';

/// Human selection only. Selection never grants native execution implicitly.
class RouterProjectDialog extends StatefulWidget {
  final Json catalog, defaultRouter;
  const RouterProjectDialog(
      {super.key, required this.catalog, required this.defaultRouter});
  @override
  State<RouterProjectDialog> createState() => _RouterProjectDialogState();
}

class _RouterProjectDialogState extends State<RouterProjectDialog> {
  final name = TextEditingController();
  final selected = <String>{}, workspaces = <String>{}, resources = <String>{};
  String? routerKey;
  int step = 0;
  @override
  void initState() {
    super.initState();
    routerKey =
        '${widget.defaultRouter['device']}~${widget.defaultRouter['session']}';
  }

  @override
  void dispose() {
    name.dispose();
    super.dispose();
  }

  String computer(Json n) => '${n['hostName'] ?? n['device']}';
  String group(Json n) => '${n['toolId']} · ${computer(n)}';
  @override
  Widget build(BuildContext context) {
    final sessions = objects(widget.catalog['sessions']);
    final routers = sessions
        .where((n) =>
            n['mode'] == 'original-live' &&
            n['capabilities']?['send'] == 'supported')
        .toList();
    if (!routers.any((n) => n['key'] == routerKey)) {
      routers.insert(0, {
        ...widget.defaultRouter,
        'key': routerKey,
        'title': '当前 Router',
        'toolId': 'codex'
      });
    }
    final workers = sessions
        .where((n) => n['mode'] == 'original-live' && n['key'] != routerKey)
        .toList();
    final groups = <String>{
      ...workers.map(group),
      for (final d in objects(widget.catalog['devices']))
        for (final t in objects(d['tools']))
          group({'device': d['id'], 'toolId': t['id']})
    }.toList()
      ..sort();
    final spaces = objects(widget.catalog['workspaces']);
    return AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      title: Text(['1 · 选择 Router', '2 · 勾选 Worker', '3 · 新窗口范围'][step]),
      content: SizedBox(
          width: 560,
          height: 440,
          child: Column(children: [
            LinearProgressIndicator(value: (step + 1) / 3),
            const SizedBox(height: 12),
            Expanded(
                child: SingleChildScrollView(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                  if (step == 0) ...[
                    TextField(
                        controller: name,
                        onChanged: (_) => setState(() {}),
                        decoration: const InputDecoration(
                            labelText: '项目名称', hintText: '例如：机械臂抓取')),
                    const SizedBox(height: 12),
                    const Text('选择已有原对话作为这个项目的入口。账号和模型沿用电脑设置。'),
                    for (final n in routers)
                      RadioListTile<String>(
                          value: '${n['key']}',
                          groupValue: routerKey,
                          title: Text('${n['title'] ?? n['session']}',
                              maxLines: 2, overflow: TextOverflow.ellipsis),
                          subtitle: Text(group(n)),
                          onChanged: (v) => setState(() {
                                routerKey = v;
                                selected.remove(v);
                              })),
                  ],
                  if (step == 1) ...[
                    Text('已选 ${selected.length} 条 · 勾选只加入观察，不自动执行'),
                    for (final g in groups)
                      ExpansionTile(
                          key: ValueKey('tool:$g'),
                          title: Text(g),
                          children: [
                            if (!workers.any((n) => group(n) == g))
                              const ListTile(
                                  title: Text('暂无可接入原会话'),
                                  subtitle: Text('在对应电脑打开工具或检查连接桥')),
                            for (final cwd in workers
                                .where((n) => group(n) == g)
                                .map((n) => '${n['cwd'] ?? '未归入项目'}')
                                .toSet())
                              ExpansionTile(
                                  title: Text(cwd,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis),
                                  children: [
                                    CheckboxListTile(
                                        title: const Text('选择这个项目的全部会话'),
                                        value: workers
                                            .where((n) =>
                                                group(n) == g &&
                                                '${n['cwd'] ?? '未归入项目'}' == cwd)
                                            .every((n) =>
                                                selected.contains(n['key'])),
                                        onChanged: (v) => setState(() {
                                              final keys = workers
                                                  .where((n) =>
                                                      group(n) == g &&
                                                      '${n['cwd'] ?? '未归入项目'}' ==
                                                          cwd)
                                                  .map((n) => '${n['key']}');
                                              if (v == true) {
                                                selected.addAll(keys);
                                              } else {
                                                selected.removeAll(keys);
                                              }
                                            })),
                                    for (final n in workers.where((n) =>
                                        group(n) == g &&
                                        '${n['cwd'] ?? '未归入项目'}' == cwd))
                                      CheckboxListTile(
                                          dense: true,
                                          value: selected.contains(n['key']),
                                          title: Text(
                                              '${n['title'] ?? n['session']}',
                                              maxLines: 2,
                                              overflow: TextOverflow.ellipsis),
                                          subtitle: n['capabilities']
                                                      ?['send'] ==
                                                  'supported'
                                              ? null
                                              : const Text('可观察 · 原应用暂不支持派发'),
                                          onChanged: (v) => setState(() {
                                                if (v == true) {
                                                  selected.add('${n['key']}');
                                                } else {
                                                  selected.remove(n['key']);
                                                }
                                              })),
                                  ]),
                          ]),
                    if (objects(widget.catalog['resources']).isNotEmpty)
                      ExpansionTile(title: const Text('服务器 · 资源节点'), children: [
                        for (final r in objects(widget.catalog['resources']))
                          CheckboxListTile(
                              value: resources.contains(r['id']),
                              title: Text('${r['name'] ?? r['id']}'),
                              subtitle: const Text('只读查询，不安装 Agent'),
                              onChanged: (v) => setState(() {
                                    if (v == true) {
                                      resources.add('${r['id']}');
                                    } else {
                                      resources.remove(r['id']);
                                    }
                                  })),
                      ]),
                    if (groups.isEmpty) const Text('没有发现可接入的原会话，请先在电脑打开工具。'),
                    for (final d in objects(widget.catalog['devices'])
                        .where((d) => d['online'] != true))
                      Text('${d['name'] ?? d['id']} · 离线'),
                  ],
                  if (step == 2) ...[
                    const Text(
                        '选择 Router 后续可以申请新窗口的项目位置。创建项目后，还需点击“执行授权”才会生效。'),
                    const SizedBox(height: 12),
                    for (final w in spaces)
                      CheckboxListTile(
                          value: workspaces.contains(w['key']),
                          title: Text('${w['name'] ?? w['path']}'),
                          subtitle: Text('${group(w)}\n${w['path']}'),
                          onChanged: (v) => setState(() {
                                if (v == true) {
                                  workspaces.add('${w['key']}');
                                } else {
                                  workspaces.remove(w['key']);
                                }
                              })),
                    if (spaces.isEmpty)
                      const Text('暂无支持原桌面新建的项目位置。请先在电脑打开支持此能力的工具和项目。'),
                    const SizedBox(height: 12),
                    Text(
                        '当前选择：${selected.length} 个 Worker，${resources.length} 个服务器，${workspaces.length} 个新窗口位置。'),
                  ],
                ]))),
          ])),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context), child: const Text('取消')),
        if (step > 0)
          TextButton(
              onPressed: () => setState(() => step--),
              child: const Text('上一步')),
        FilledButton(
            onPressed: name.text.trim().isEmpty ||
                    (step == 2 &&
                        (selected.isEmpty &&
                                workspaces.isEmpty &&
                                resources.isEmpty ||
                            selected.length > 40 ||
                            workspaces.length > 20))
                ? null
                : () {
                    if (step < 2) {
                      setState(() => step++);
                      return;
                    }
                    Navigator.pop(context, <String, dynamic>{
                      'name': name.text.trim(),
                      if (routerKey !=
                          '${widget.defaultRouter['device']}~${widget.defaultRouter['session']}')
                        'routerKey': routerKey,
                      'scope': selected.toList(),
                      'workspaceScope': workspaces.toList(),
                      'resourceScope': resources.toList()
                    });
                  },
            child: Text(step == 2 ? '创建项目' : '下一步')),
      ],
    );
  }
}
