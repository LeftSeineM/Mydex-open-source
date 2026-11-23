import 'usage.dart';
import 'package:flutter/material.dart';
import 'dart:async';
import '../controller.dart';
import '../models.dart';

Future<void> showControls(BuildContext context, AppController c) async {
  c.loadControls();
  await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (_) => ControlsPanel(controller: c));
}

class ControlsPanel extends StatefulWidget {
  final AppController controller;
  const ControlsPanel({super.key, required this.controller});
  @override
  State<ControlsPanel> createState() => _ControlsPanelState();
}

class _ControlsPanelState extends State<ControlsPanel> {
  Timer? refreshTimer;
  @override
  void initState() {
    super.initState();
    refreshTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (tab != 0 && !busy && !c.controlsLoading && c.selectedId != null) {
        c.loadControls();
      }
    });
  }

  int tab = 0;
  bool busy = false;
  String? model, effort;
  bool? fast;
  final objective = TextEditingController(),
      budget = TextEditingController(),
      queued = TextEditingController();
  bool populated = false;
  AppController get c => widget.controller;
  @override
  void dispose() {
    refreshTimer?.cancel();
    objective.dispose();
    budget.dispose();
    queued.dispose();
    super.dispose();
  }

  Future<void> submit(String action, Json body) async {
    setState(() => busy = true);
    final ok = await c.control(action, body);
    if (!mounted) return;
    setState(() => busy = false);
    if (ok) {
      if (action == 'queue') queued.clear();
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(c.controlNotice ?? '已保存到电脑')));
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final state = c.controlState;
        final caps = state['capabilities'] ?? {};
        final goal = state['goal'];
        if (!c.controlsLoading && !populated) {
          model = state['model'] ??
              c.models.where((m) => m['isDefault'] == true).firstOrNull?['id'];
          effort = state['effort'];
          fast = state['fast'] == true;
          objective.text = goal?['objective'] ?? '';
          budget.text = goal?['tokenBudget']?.toString() ?? '';
          populated = true;
        }
        final selected = c.models.where((m) => m['id'] == model).firstOrNull;
        final efforts =
            (selected?['efforts'] as List?)?.cast<String>() ?? <String>[];
        if (!efforts.contains(effort)) {
          effort = selected?['defaultEffort'] ?? efforts.firstOrNull;
        }
        final queue = objects(state['queue']);
        return FractionallySizedBox(
            heightFactor: .82,
            child: Padding(
                padding: EdgeInsets.fromLTRB(
                    20, 0, 20, 16 + MediaQuery.viewInsetsOf(context).bottom),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Text('会话控制',
                          style: TextStyle(
                              fontSize: 21, fontWeight: FontWeight.w600)),
                      Align(
                          alignment: Alignment.centerRight,
                          child: TextButton(
                              onPressed: () => showUsage(context, c),
                              child: const Text('额度与用量'))),
                      const SizedBox(height: 18),
                      SegmentedButton<int>(
                          segments: const [
                            ButtonSegment(value: 0, label: Text('模型')),
                            ButtonSegment(value: 1, label: Text('队列')),
                            ButtonSegment(value: 2, label: Text('目标'))
                          ],
                          selected: {
                            tab
                          },
                          onSelectionChanged: (s) =>
                              setState(() => tab = s.first)),
                      const SizedBox(height: 16),
                      if (c.controlsLoading)
                        const LinearProgressIndicator(minHeight: 2),
                      if (c.controlsError != null)
                        Padding(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            child: Text(c.controlsError!,
                                style: TextStyle(
                                    color:
                                        Theme.of(context).colorScheme.error))),
                      Expanded(
                          child: ListView(
                              children: tab == 0
                                  ? [
                                      DropdownButtonFormField<String>(
                                          value: c.models
                                                  .any((m) => m['id'] == model)
                                              ? model
                                              : null,
                                          isExpanded: true,
                                          decoration: const InputDecoration(
                                              labelText: '这台电脑上的模型'),
                                          items: c.models
                                              .map((m) =>
                                                  DropdownMenuItem<String>(
                                                      value: m['id'],
                                                      child: Text(m['name'],
                                                          overflow: TextOverflow
                                                              .ellipsis)))
                                              .toList(),
                                          onChanged: busy
                                              ? null
                                              : (v) => setState(() {
                                                    model = v;
                                                    effort = null;
                                                    fast = false;
                                                  })),
                                      const SizedBox(height: 16),
                                      DropdownButtonFormField<String>(
                                          value: effort,
                                          isExpanded: true,
                                          decoration: const InputDecoration(
                                              labelText: '思考强度'),
                                          items: efforts
                                              .map((e) => DropdownMenuItem(
                                                  value: e, child: Text(e)))
                                              .toList(),
                                          onChanged: busy
                                              ? null
                                              : (v) =>
                                                  setState(() => effort = v)),
                                      const SizedBox(height: 12),
                                      SwitchListTile(
                                          contentPadding: EdgeInsets.zero,
                                          title: const Text('快速模式'),
                                          subtitle: Text(c.selectedId == null
                                              ? '创建会话后可设置快速模式'
                                              : selected?['fast'] == true
                                                  ? '使用电脑提供的 Fast 档位，可能增加用量'
                                                  : '当前模型未提供快速模式'),
                                          value: fast == true,
                                          onChanged: !busy &&
                                                  c.selectedId != null &&
                                                  selected?['fast'] == true
                                              ? (v) => setState(() => fast = v)
                                              : null),
                                      const SizedBox(height: 16),
                                      FilledButton(
                                          onPressed: busy ||
                                                  model == null ||
                                                  c.controlsLoading ||
                                                  caps['settings'] != true
                                              ? null
                                              : () => submit('settings', {
                                                    'model': model,
                                                    'effort': effort,
                                                    'fast': fast == true
                                                  }),
                                          child:
                                              Text(busy ? '保存中…' : '应用到后续发言')),
                                      const SizedBox(height: 12),
                                      const Text('保留正在生成的回复，模型设置用于后续发言。',
                                          style: TextStyle(
                                              fontSize: 12,
                                              color: Colors.grey)),
                                      const SizedBox(height: 20),
                                      const Text('桌面侧聊',
                                          style: TextStyle(
                                              fontWeight: FontWeight.w600)),
                                      if (caps['sideChatCreate'] == true)
                                        OutlinedButton.icon(
                                          icon: const Icon(
                                              Icons.add_comment_outlined),
                                          label: Text(busy ? '正在创建…' : '新建侧聊'),
                                          onPressed: busy
                                              ? null
                                              : () async {
                                                  setState(() => busy = true);
                                                  final opened =
                                                      await c.createSideChat();
                                                  if (!context.mounted) return;
                                                  if (opened) {
                                                    Navigator.pop(context);
                                                  } else {
                                                    setState(
                                                        () => busy = false);
                                                  }
                                                },
                                        ),
                                      if (caps['sideChats'] == true &&
                                          caps['sideChatCreate'] != true)
                                        Text(
                                            state['sideChatCreateNote']
                                                    ?.toString() ??
                                                '手机新建侧聊暂不可用，可打开下方已有侧聊。',
                                            style: const TextStyle(
                                                fontSize: 12,
                                                color: Colors.grey)),
                                      if (caps['sideChats'] != true &&
                                          !c.controlsLoading)
                                        const Text('当前电脑暂未提供侧聊列表。')
                                      else if (caps['sideChats'] == true &&
                                          objects(state['sideChats']).isEmpty)
                                        const Text('当前会话没有已保存的侧聊。')
                                      else
                                        ...objects(state['sideChats'])
                                            .map((side) => ListTile(
                                                  leading: const Icon(
                                                      Icons.forum_outlined),
                                                  title: Text(
                                                      side['title']
                                                              ?.toString() ??
                                                          '侧聊',
                                                      maxLines: 2,
                                                      overflow: TextOverflow
                                                          .ellipsis),
                                                  subtitle: Text(
                                                      side['ephemeral'] == true
                                                          ? '临时侧聊 · 桌面关闭后失效'
                                                          : '已保存侧聊',
                                                      style: const TextStyle(
                                                          fontSize: 11)),
                                                  trailing: const Icon(
                                                      Icons.chevron_right),
                                                  onTap: () {
                                                    final id = c.selectedId;
                                                    final separator =
                                                        id?.indexOf('~') ?? -1;
                                                    if (id == null ||
                                                        separator < 1) {
                                                      return;
                                                    }
                                                    final child =
                                                        '${id.substring(0, separator)}~desktop:${side['id']}';
                                                    c.parentChats[child] = id;
                                                    c.sideChatParents[child] =
                                                        id;
                                                    Navigator.pop(context);
                                                    c.select(child);
                                                  },
                                                )),
                                      if (state['sideChatsHasMore'] == true)
                                        const Text('仅显示前 100 条侧聊。'),
                                    ]
                                  : tab == 1
                                      ? [
                                          if (c.selectedId == null)
                                            const Text('请先创建或打开一个会话。')
                                          else if (caps['queue'] != true &&
                                              !c.controlsLoading)
                                            const Text(
                                                '这台电脑的 Codex 版本未提供可用队列接口。')
                                          else ...[
                                            Text('待执行 · ${queue.length}',
                                                style: const TextStyle(
                                                    fontWeight:
                                                        FontWeight.w600)),
                                            const SizedBox(height: 12),
                                            ...queue.map((q) => Card(
                                                elevation: 0,
                                                child: ListTile(
                                                    title: Text(q['text'] ?? '',
                                                        maxLines: 3,
                                                        overflow: TextOverflow
                                                            .ellipsis),
                                                    trailing: IconButton(
                                                        tooltip: '移出队列',
                                                        icon: const Icon(
                                                            Icons.close,
                                                            size: 18),
                                                        onPressed: busy
                                                            ? null
                                                            : () => submit(
                                                                    'queue', {
                                                                  'action':
                                                                      'remove',
                                                                  'queueId':
                                                                      q['id']
                                                                }))))),
                                            if (queue.isEmpty)
                                              const Padding(
                                                  padding: EdgeInsets.symmetric(
                                                      vertical: 20),
                                                  child: Text('队列为空',
                                                      style: TextStyle(
                                                          color: Colors.grey))),
                                            TextField(
                                                controller: queued,
                                                minLines: 2,
                                                maxLines: 5,
                                                decoration:
                                                    const InputDecoration(
                                                        hintText:
                                                            '下一条要执行的指令…')),
                                            const SizedBox(height: 12),
                                            FilledButton.icon(
                                                onPressed: busy
                                                    ? null
                                                    : () => submit('queue', {
                                                          'action': 'add',
                                                          'instruction':
                                                              queued.text
                                                        }),
                                                icon: const Icon(
                                                    Icons.playlist_add),
                                                label: const Text('加入电脑队列')),
                                          ]
                                        ]
                                      : [
                                          if (c.selectedId == null)
                                            const Text('请先创建或打开一个会话。')
                                          else if (caps['goal'] != true &&
                                              !c.controlsLoading)
                                            const Text(
                                                '这台电脑的 Codex 版本未提供可用目标接口。')
                                          else ...[
                                            if (goal != null)
                                              Padding(
                                                  padding:
                                                      const EdgeInsets.only(
                                                          bottom: 16),
                                                  child: Text(
                                                      '状态：${goal['status']} · 已用 ${goal['tokensUsed'] ?? 0} tokens')),
                                            TextField(
                                                controller: objective,
                                                minLines: 3,
                                                maxLines: 6,
                                                maxLength: 4000,
                                                decoration:
                                                    const InputDecoration(
                                                        labelText: '要完成的目标')),
                                            const SizedBox(height: 12),
                                            TextField(
                                                controller: budget,
                                                keyboardType:
                                                    TextInputType.number,
                                                decoration:
                                                    const InputDecoration(
                                                        labelText:
                                                            'Token 预算（可选）',
                                                        helperText:
                                                            '留空不新增预算限制')),
                                            const SizedBox(height: 20),
                                            FilledButton(
                                                onPressed: busy
                                                    ? null
                                                    : () => submit('goal', {
                                                          'status': 'active',
                                                          'objective':
                                                              objective.text,
                                                          if (budget.text
                                                              .trim()
                                                              .isNotEmpty)
                                                            'tokenBudget':
                                                                int.tryParse(budget
                                                                        .text
                                                                        .trim()) ??
                                                                    -1
                                                        }),
                                                child: const Text('设置 / 继续目标')),
                                            if (goal != null)
                                              Row(children: [
                                                Expanded(
                                                    child: TextButton(
                                                        onPressed: busy
                                                            ? null
                                                            : () => submit(
                                                                    'goal', {
                                                                  'status':
                                                                      'paused'
                                                                }),
                                                        child: const Text(
                                                            '暂停目标'))),
                                                Expanded(
                                                    child: TextButton(
                                                        onPressed: busy
                                                            ? null
                                                            : () => submit(
                                                                    'goal', {
                                                                  'status':
                                                                      'complete'
                                                                }),
                                                        child:
                                                            const Text('标记完成')))
                                              ]),
                                          ]
                                        ])),
                    ])));
      });
}
