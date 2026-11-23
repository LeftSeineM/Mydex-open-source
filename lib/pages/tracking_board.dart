import 'dart:async';
import 'package:flutter/material.dart';
import '../controller.dart';
import '../models.dart';
import '../services/api.dart';
import '../widgets/connection_picker.dart';
import '../widgets/message.dart';

/// A private project surface. Refreshing this view never calls a model; the
/// host organizes only explicitly selected conversations after new evidence.
class TrackingBoardPage extends StatefulWidget {
  final AppController controller;
  const TrackingBoardPage({super.key, required this.controller});
  @override
  State<TrackingBoardPage> createState() => _TrackingBoardPageState();
}

class _TrackingBoardPageState extends State<TrackingBoardPage> {
  AppController get c => widget.controller;
  GatewayApi? get api => c.api;
  Json snapshot = {};
  String? projectId, error;
  bool busy = false;
  int tab = 0;
  final selected = <String>{};
  Timer? timer;
  bool refreshing = false;
  @override
  void initState() {
    super.initState();
    refresh();
    timer = Timer.periodic(const Duration(seconds: 5), (_) => refresh());
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  Future<void> refresh() async {
    if (refreshing || api == null) return;
    refreshing = true;
    final activeApi = api;
    try {
      final data =
          await activeApi!.get('/api/tasks/superagent~workbench/controls');
      if (!mounted || activeApi != api) return;
      setState(() {
        snapshot = data;
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      refreshing = false;
    }
  }

  Future<Json> command(Json body) async {
    if (api == null) throw Exception('请先连接小主机');
    return api!.post('/api/tasks/superagent~workbench/settings', body);
  }

  Json? get project => objects(snapshot['projects'])
      .where((p) => p['id'] == projectId)
      .firstOrNull;
  Future<void> importDialog() async {
    if (busy || api == null) return;
    final result = await showDialog<Json>(
        context: context,
        builder: (_) => _ImportDialog(command: command, project: project));
    if (!mounted || result == null) return;
    setState(() {
      projectId = result['id'];
      selected.clear();
    });
    await refresh();
  }

  String date(dynamic value) {
    if (value is! num) return '尚未同步';
    final d = DateTime.fromMillisecondsSinceEpoch(value.toInt());
    return '${d.month}/${d.day} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  Color stateColor(Json s) => s['online'] == false
      ? Colors.grey
      : switch (s['state'] ?? s['status']) {
          'Running' => const Color(0xff41658a),
          'AwaitingApproval' => const Color(0xff997333),
          'Failed' => const Color(0xffa65757),
          _ => const Color(0xff52745e),
        };
  String stateLabel(Json s) => s['online'] == false
      ? '无法同步'
      : switch (s['state'] ?? s['status']) {
          'Running' => '执行中',
          'AwaitingApproval' => '原会话待审批',
          'Failed' => '本轮异常',
          'Completed' => '本轮结束 · 未代表验收',
          _ => '等待回报',
        };
  Widget card({required Widget child, Color? color}) => Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
          color: color ?? Theme.of(context).colorScheme.surface,
          border: Border.all(
              color: Theme.of(context).dividerColor.withValues(alpha: .5)),
          borderRadius: BorderRadius.circular(15)),
      child: child);
  Widget heading(String text, {Widget? action}) => Padding(
      padding: const EdgeInsets.only(top: 16, bottom: 12),
      child: Row(children: [
        Expanded(
            child: Text(text,
                style: const TextStyle(
                    fontSize: 16, fontWeight: FontWeight.w600))),
        if (action != null) action
      ]));
  Widget empty(String text) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 30),
      child:
          Text(text, style: const TextStyle(color: Colors.grey, height: 1.7)));
  @override
  Widget build(BuildContext context) {
    final p = project;
    return RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
            children: [
              ConnectionPicker(controller: c),
              const SizedBox(height: 18),
              Row(children: [
                Expanded(
                    child: Text(p?['name'] ?? '项目进展',
                        style: const TextStyle(
                            fontSize: 27, fontWeight: FontWeight.w500))),
                if (p != null)
                  IconButton(
                      tooltip: '返回项目列表',
                      onPressed: () => setState(() {
                            projectId = null;
                            selected.clear();
                          }),
                      icon: const Icon(Icons.grid_view_rounded, size: 20))
              ]),
              const SizedBox(height: 8),
              Text(
                  '私有测试 · ${snapshot['router']?['model'] ?? 'DeepSeek Router'}',
                  style: const TextStyle(fontSize: 11, color: Colors.grey)),
              if (error != null)
                Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text('刷新未完成，保留上次记录。$error',
                        style: const TextStyle(
                            fontSize: 12, color: Colors.redAccent))),
              if (p == null) ...[
                heading('我的项目',
                    action: TextButton.icon(
                        onPressed: importDialog,
                        icon: const Icon(Icons.add, size: 18),
                        label: const Text('接入会话'))),
                if (objects(snapshot['projects']).isEmpty)
                  empty('先勾选已有项目或会话。\nRouter 会根据原记录整理层次与进展，\n你仍可从普通电脑入口继续原对话。'),
                ...objects(snapshot['projects']).map((item) => card(
                    child: ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(item['name']),
                        subtitle: Text(
                            '${objects(item['sources']).length} 条已接入会话 · ${item['organizing'] == true ? 'Router 整理中' : date(item['updatedAt'])}'),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => setState(() => projectId = item['id'])))),
              ] else ...[
                if ((p['goal'] ?? '').toString().isNotEmpty)
                  Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(p['goal'],
                          style: const TextStyle(
                              fontSize: 13, color: Colors.grey))),
                const SizedBox(height: 16),
                Wrap(spacing: 10, runSpacing: 8, children: [
                  FilledButton.icon(
                      onPressed: () => discuss(p),
                      icon: const Icon(Icons.auto_awesome_outlined, size: 17),
                      label: const Text('与 Router 讨论')),
                  OutlinedButton.icon(
                      onPressed: importDialog,
                      icon: const Icon(Icons.checklist, size: 17),
                      label: const Text('勾选会话'))
                ]),
                const SizedBox(height: 18),
                SegmentedButton<int>(segments: const [
                  ButtonSegment(
                      value: 0,
                      label: Text('树状层次'),
                      icon: Icon(Icons.account_tree_outlined, size: 17)),
                  ButtonSegment(
                      value: 1,
                      label: Text('时间脉络'),
                      icon: Icon(Icons.timeline, size: 17))
                ], selected: {
                  tab
                }, onSelectionChanged: (v) => setState(() => tab = v.first)),
                const SizedBox(height: 16),
                if (p['organizing'] == true)
                  const LinearProgressIndicator(minHeight: 2),
                if (p['error'] != null)
                  card(
                      color: const Color(0xfffffaf0),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(p['error'],
                                style: const TextStyle(fontSize: 12)),
                            TextButton(
                                onPressed: busy ? null : () => organize(p),
                                child: const Text('重新整理'))
                          ])),
                if ((p['routerSummary'] ?? '').toString().isNotEmpty)
                  card(
                      color: const Color(0xfff3f6f9),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Router 进展摘要',
                                style: TextStyle(
                                    fontSize: 12, fontWeight: FontWeight.w600)),
                            const SizedBox(height: 7),
                            Text(p['routerSummary'],
                                style:
                                    const TextStyle(fontSize: 13, height: 1.6)),
                            const SizedBox(height: 6),
                            Text(
                                '整理于 ${date(p['organizedAt'])} · 关系由模型建议，状态来自原会话',
                                style: const TextStyle(
                                    fontSize: 10, color: Colors.grey))
                          ])),
                if (tab == 0) ...tree(p) else ...timeline(p),
                if (selected.isNotEmpty)
                  card(
                      color: const Color(0xffedf3f9),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('已选 ${selected.length} 条会话作为提问上下文'),
                            const SizedBox(height: 10),
                            FilledButton(
                                onPressed: () => discuss(p, scoped: true),
                                child: const Text('围绕所选节点提问'))
                          ])),
                heading('跟踪说明',
                    action: TextButton(
                        onPressed: busy ? null : () => organize(p),
                        child: const Text('重新整理'))),
                const Text(
                    '状态按原会话回报更新；时间线记录平台观察到变化的时间。只有新内容才触发 Router 整理。勾选仅用于跟踪和讨论，不会执行或批准电脑操作。',
                    style: TextStyle(
                        fontSize: 11, color: Colors.grey, height: 1.7)),
              ],
            ]));
  }

  List<Widget> tree(Json p) {
    final sources = objects(p['sources']);
    final groups = objects(p['outline']?['groups']);
    final shown = groups.isEmpty
        ? [
            {
              'id': 'pending',
              'title': '已接入会话',
              'summary': '等待 Router 整理层次',
              'sourceKeys': sources.map((s) => s['key']).toList()
            }
          ]
        : groups;
    return [
      card(
          child: const Row(children: [
        Icon(Icons.person_outline, size: 20),
        SizedBox(width: 10),
        Text('你 · 项目负责人')
      ])),
      const Center(child: Icon(Icons.south, size: 17, color: Colors.grey)),
      const SizedBox(height: 10),
      card(
          color: const Color(0xfff5f8fb),
          child: Row(children: [
            const Icon(Icons.hub_outlined, size: 20),
            const SizedBox(width: 10),
            Expanded(
                child: Text(
                    '个人 Router\n${snapshot['router']?['model'] ?? 'DeepSeek'}',
                    style: const TextStyle(fontSize: 13)))
          ])),
      ...shown.map((g) {
        final ids = (g['sourceKeys'] as List? ?? []).cast<String>();
        final ss = sources.where((s) => ids.contains(s['key'])).toList();
        final count = ids.where(selected.contains).length;
        return card(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Checkbox(
                tristate: true,
                value: count == 0
                    ? false
                    : count == ids.length
                        ? true
                        : null,
                onChanged: (_) => setState(() {
                      if (count == ids.length) {
                        selected.removeAll(ids);
                      } else {
                        selected.addAll(ids);
                      }
                    })),
            Expanded(
                child: Text(g['title'],
                    style: const TextStyle(fontWeight: FontWeight.w600)))
          ]),
          if ((g['summary'] ?? '').toString().isNotEmpty)
            Padding(
                padding: const EdgeInsets.only(left: 12, bottom: 8),
                child: Text(g['summary'],
                    style: const TextStyle(
                        fontSize: 12, color: Colors.grey, height: 1.6))),
          ...ss.map((s) => sourceNode(p, s)),
        ]));
      }),
      if (objects(p['outline']?['relations']).isNotEmpty)
        card(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Router 建议的关联',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
          ...objects(p['outline']?['relations']).map((r) => Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                  '${sources.where((s) => s['key'] == r['from']).firstOrNull?['title'] ?? '会话'} → ${sources.where((s) => s['key'] == r['to']).firstOrNull?['title'] ?? '会话'}\n${r['label']}',
                  style: const TextStyle(fontSize: 12, height: 1.6))))
        ])),
    ];
  }

  Widget sourceNode(Json p, Json s) => Container(
      margin: const EdgeInsets.only(left: 12, top: 8),
      padding: const EdgeInsets.fromLTRB(10, 8, 8, 12),
      decoration: BoxDecoration(
          border:
              Border(left: BorderSide(color: Theme.of(context).dividerColor))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(
              width: 32,
              height: 32,
              child: Checkbox(
                  value: selected.contains(s['key']),
                  onChanged: (v) => setState(() => v == true
                      ? selected.add(s['key'])
                      : selected.remove(s['key'])))),
          Expanded(
              child: TextButton(
                  style: TextButton.styleFrom(
                      alignment: Alignment.centerLeft,
                      padding: const EdgeInsets.symmetric(horizontal: 4)),
                  onPressed: () => original(p, s),
                  child: Text(s['title'] ?? '原会话',
                      style: const TextStyle(fontSize: 13))))
        ]),
        Text('${s['toolId']} · ${s['model'] ?? '沿用原会话模型'}',
            style: const TextStyle(fontSize: 11, color: Colors.grey)),
        const SizedBox(height: 5),
        Text(stateLabel(s),
            style: TextStyle(fontSize: 11, color: stateColor(s))),
        const SizedBox(height: 7),
        Text(s['latest'] ?? '暂无回复',
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 12, height: 1.6)),
        const SizedBox(height: 9),
        Row(children: [
          const Icon(Icons.dns_outlined, size: 14, color: Colors.grey),
          const SizedBox(width: 6),
          Expanded(
              child: Text('${s['worker']} · ${date(s['lastObserved'])} 观察',
                  style: const TextStyle(fontSize: 10, color: Colors.grey)))
        ]),
      ]));
  List<Widget> timeline(Json p) {
    final events = objects(p['events']).reversed.toList(),
        sources = objects(p['sources']);
    return [
      heading('最新变化',
          action: Text('${events.length} 条记录',
              style: const TextStyle(fontSize: 11, color: Colors.grey))),
      if (events.isEmpty) empty('等待原会话同步'),
      ...events.map((e) {
        final source =
            sources.where((s) => s['key'] == e['sourceKey']).firstOrNull;
        return Container(
            padding: const EdgeInsets.only(left: 14, bottom: 22),
            decoration: BoxDecoration(
                border: Border(
                    left: BorderSide(color: Theme.of(context).dividerColor))),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(date(e['at']),
                  style: const TextStyle(fontSize: 11, color: Colors.grey)),
              const SizedBox(height: 6),
              Text(e['title'],
                  style: const TextStyle(
                      fontSize: 13, fontWeight: FontWeight.w500)),
              if ((e['detail'] ?? '').toString().isNotEmpty)
                Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(e['detail'],
                        maxLines: 4,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 12, height: 1.6, color: Colors.grey))),
              if (source != null)
                TextButton(
                    onPressed: () => original(p, source),
                    child:
                        const Text('查看原会话证据', style: TextStyle(fontSize: 11))),
            ]));
      }),
    ];
  }

  Future<void> organize(Json p) async {
    setState(() => busy = true);
    try {
      await command({'operation': 'tracking_organize', 'projectId': p['id']});
      await refresh();
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> original(Json p, Json source) async {
    await Navigator.push(
        context,
        MaterialPageRoute(
            builder: (_) => _OriginalPage(
                load: () => command({
                      'operation': 'tracking_original',
                      'projectId': p['id'],
                      'sourceKey': source['key']
                    }))));
  }

  Future<void> discuss(Json p, {bool scoped = false}) async {
    await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        showDragHandle: true,
        builder: (_) => _RouterDiscussion(
            model: snapshot['router']?['model'] ?? 'DeepSeek',
            contextNames: objects(p['sources'])
                .where((s) => !scoped || selected.contains(s['key']))
                .map((s) => s['title'].toString())
                .toList(),
            ask: (q) => command({
                  'operation': 'tracking_discuss',
                  'projectId': p['id'],
                  'question': q,
                  'sourceKeys': scoped ? selected.toList() : []
                })));
  }
}

class _ImportDialog extends StatefulWidget {
  final Future<Json> Function(Json) command;
  final Json? project;
  const _ImportDialog({required this.command, this.project});
  @override
  State<_ImportDialog> createState() => _ImportDialogState();
}

class _ImportDialogState extends State<_ImportDialog> {
  List<Json> workers = [], rows = [], projects = [];
  final selected = <String, Json>{};
  final name = TextEditingController(), goal = TextEditingController();
  String? worker, error;
  bool loading = true, saving = false;
  @override
  void initState() {
    super.initState();
    name.text = widget.project?['name'] ?? '';
    goal.text = widget.project?['goal'] ?? '';
    for (final s in objects(widget.project?['sources'])) {
      selected[s['key']] = s;
    }
    load();
  }

  @override
  void dispose() {
    name.dispose();
    goal.dispose();
    super.dispose();
  }

  Future<void> load({String? id}) async {
    setState(() => loading = true);
    try {
      final r = await widget.command(
          {'operation': 'tracking_catalog', if (id != null) 'worker': id});
      if (!mounted) return;
      workers = objects(r['workers']);
      worker = id ?? worker ?? workers.firstOrNull?['id'];
      if (id == null && worker != null) {
        await load(id: worker);
        return;
      }
      setState(() {
        rows = objects(r['sessions']);
        projects = objects(r['projects']);
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> save() async {
    setState(() => saving = true);
    try {
      final r = await widget.command({
        'operation': 'tracking_import',
        if (widget.project != null) 'projectId': widget.project!['id'],
        'name': name.text,
        'goal': goal.text,
        'sources': selected.values
            .map((s) => {'worker': s['worker'], 'session': s['session']})
            .toList()
      });
      if (mounted) Navigator.pop(context, r['project']);
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final groups = <String, List<Json>>{};
    for (final row in rows) {
      final group = '${row['toolId']}|${row['projectId']}';
      groups.putIfAbsent(group, () => []).add(row);
    }
    return AlertDialog(
        title: const Text('勾选项目或会话'),
        content: SizedBox(
            width: 600,
            child: SingleChildScrollView(
                child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  if (widget.project == null) ...[
                    TextField(
                        controller: name,
                        decoration: const InputDecoration(labelText: '项目名称'),
                        maxLength: 100),
                    const SizedBox(height: 8),
                    TextField(
                        controller: goal,
                        decoration:
                            const InputDecoration(labelText: '项目目标（可选）'),
                        maxLines: 2),
                    const SizedBox(height: 16)
                  ],
                  if (workers.isNotEmpty)
                    DropdownButtonFormField<String>(
                        isExpanded: true,
                        value: worker,
                        decoration: const InputDecoration(labelText: '已授权电脑'),
                        items: workers
                            .map((w) => DropdownMenuItem<String>(
                                value: w['id'],
                                child: Text(w['name'] ?? w['id'])))
                            .toList(),
                        onChanged:
                            loading || saving ? null : (v) => load(id: v)),
                  if (loading)
                    const Padding(
                        padding: EdgeInsets.all(20),
                        child: Center(child: CircularProgressIndicator())),
                  if (error != null)
                    Text(error!,
                        style: const TextStyle(
                            color: Colors.redAccent, fontSize: 12)),
                  ...groups.entries.map((entry) {
                    final ss = entry.value,
                        count = ss
                            .where((s) => selected.containsKey(s['key']))
                            .length;
                    final project = projects
                        .where((p) => p['id'] == ss.first['projectId'])
                        .firstOrNull;
                    final label = project?['name'] ??
                        (ss.first['cwd']
                            ?.toString()
                            .split(RegExp(r'[/\\]'))
                            .lastOrNull) ??
                        '未归类会话';
                    return ExpansionTile(
                        initiallyExpanded: groups.length < 4,
                        tilePadding: EdgeInsets.zero,
                        title: Row(children: [
                          Checkbox(
                              tristate: true,
                              value: count == 0
                                  ? false
                                  : count == ss.length
                                      ? true
                                      : null,
                              onChanged: saving
                                  ? null
                                  : (_) => setState(() {
                                        for (final s in ss) {
                                          if (count == ss.length) {
                                            selected.remove(s['key']);
                                          } else {
                                            selected[s['key']] = s;
                                          }
                                        }
                                      })),
                          Expanded(
                              child: Text('${ss.first['toolId']} · $label',
                                  style: const TextStyle(fontSize: 12)))
                        ]),
                        subtitle: Text('${ss.length} 条对话 · 已选 $count',
                            style: const TextStyle(fontSize: 11)),
                        children: ss
                            .map((s) => CheckboxListTile(
                                dense: true,
                                controlAffinity:
                                    ListTileControlAffinity.leading,
                                value: selected.containsKey(s['key']),
                                title: Text(s['title'],
                                    style: const TextStyle(fontSize: 12)),
                                subtitle: Text(s['status'] ?? '',
                                    style: const TextStyle(fontSize: 10)),
                                onChanged: saving
                                    ? null
                                    : (v) => setState(() => v == true
                                        ? selected[s['key']] = s
                                        : selected.remove(s['key']))))
                            .toList());
                  }),
                  const SizedBox(height: 10),
                  Text('已选 ${selected.length} 条。只读取所选会话；新增会话需要另行勾选，不会改名或执行任务。',
                      style: const TextStyle(fontSize: 11, color: Colors.grey)),
                ]))),
        actions: [
          TextButton(
              onPressed: saving ? null : () => Navigator.pop(context),
              child: const Text('取消')),
          FilledButton(
              onPressed: saving || selected.isEmpty ? null : save,
              child: Text(saving ? '保存中…' : '保存并整理'))
        ]);
  }
}

class _OriginalPage extends StatefulWidget {
  final Future<Json> Function() load;
  const _OriginalPage({required this.load});
  @override
  State<_OriginalPage> createState() => _OriginalPageState();
}

class _OriginalPageState extends State<_OriginalPage> {
  late final Future<Json> data = widget.load();
  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('原会话证据')),
      body: FutureBuilder<Json>(
          future: data,
          builder: (context, s) {
            if (s.hasError) return Center(child: Text(s.error.toString()));
            if (!s.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final task = s.data!['task'];
            return ListView(padding: const EdgeInsets.all(20), children: [
              Text(task['title'] ?? '', style: const TextStyle(fontSize: 18)),
              Text('${s.data!['worker']} · 只读查看',
                  style: const TextStyle(fontSize: 11, color: Colors.grey)),
              const SizedBox(height: 20),
              ...objects(task['messages'])
                  .map((m) => MessageBlock(message: m, api: null))
            ]);
          }));
}

class _RouterDiscussion extends StatefulWidget {
  final String model;
  final List<String> contextNames;
  final Future<Json> Function(String) ask;
  const _RouterDiscussion(
      {required this.model, required this.contextNames, required this.ask});
  @override
  State<_RouterDiscussion> createState() => _RouterDiscussionState();
}

class _RouterDiscussionState extends State<_RouterDiscussion> {
  final question = TextEditingController();
  String? answer, error;
  bool busy = false;
  @override
  void dispose() {
    question.dispose();
    super.dispose();
  }

  Future<void> send() async {
    if (question.text.trim().isEmpty) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final r = await widget.ask(question.text.trim());
      if (mounted) setState(() => answer = r['discussion']?['answer']);
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
      padding: EdgeInsets.fromLTRB(
          20, 0, 20, MediaQuery.viewInsetsOf(context).bottom + 20),
      child: ConstrainedBox(
          constraints:
              BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * .8),
          child: SingleChildScrollView(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                Text('与 Router 讨论 · ${widget.model}',
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 12),
                Text('上下文：${widget.contextNames.join('、')}',
                    maxLines: 4,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, color: Colors.grey)),
                const SizedBox(height: 16),
                TextField(
                    controller: question,
                    maxLines: 3,
                    enabled: !busy,
                    decoration: const InputDecoration(
                        hintText: '例如：这些分支之间是什么关系？现在卡在哪里？')),
                const SizedBox(height: 12),
                Row(children: [
                  const Expanded(
                      child: Text('本轮只讨论，不自动执行电脑操作',
                          style: TextStyle(fontSize: 11, color: Colors.grey))),
                  FilledButton(
                      onPressed: busy ? null : send,
                      child: Text(busy ? '思考中…' : '发送'))
                ]),
                if (error != null)
                  Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(error!,
                          style: const TextStyle(color: Colors.redAccent))),
                if (answer != null)
                  Padding(
                      padding: const EdgeInsets.only(top: 18),
                      child: SelectableText(answer!,
                          style: const TextStyle(fontSize: 14, height: 1.7))),
              ]))));
}
