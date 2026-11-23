import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import '../controller.dart';
import '../widgets/router_project_dialog.dart';
import '../widgets/router_execution_permissions.dart';
import '../services/api.dart';
import '../services/router_command_journal.dart';
import '../widgets/interactions.dart' show QuestionCard;

/// Private original-session Router. The phone only renders the gateway's
/// persisted facts and issues authenticated control requests.
class NativeRouterPage extends StatefulWidget {
  final AppController controller;
  final String? initialJobId;
  const NativeRouterPage(
      {super.key, required this.controller, this.initialJobId});
  @override
  State<NativeRouterPage> createState() => _NativeRouterPageState();
}

class _NativeRouterPageState extends State<NativeRouterPage> {
  Map<String, dynamic>? state;
  String? error;
  bool busy = false;
  bool refreshing = false;
  String? selectedJob;
  late final GatewayApi? api;
  Timer? timer;
  final selected = <String>{};
  List<Map<String, dynamic>> rows(dynamic value) => (value as List? ?? [])
      .whereType<Map>()
      .map((m) => Map<String, dynamic>.from(m))
      .toList();
  @override
  void initState() {
    super.initState();
    selectedJob = widget.initialJobId;
    api = widget.controller.api;
    refresh();
    timer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!busy) refresh(silent: true);
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  Future<void> refresh({bool silent = false}) async {
    if (busy || refreshing) return;
    refreshing = true;
    try {
      if (!identical(api, widget.controller.api)) throw StateError('连接已改变');
      final result = await api!.get('/api/router');
      if (mounted) {
        setState(() {
          state = result;
          final available = rows(result['jobs']);
          if (!available.any((j) => j['id'] == selectedJob)) {
            selectedJob =
                available.isEmpty ? null : available.first['id'] as String;
          }
          error = null;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          error = '这台电脑的 Router 尚未启用或连接已断开。请保留原连接，稍后刷新。';
        });
      }
    } finally {
      refreshing = false;
    }
  }

  String journalGroup() {
    if (!identical(api, widget.controller.api)) throw StateError('连接已改变');
    final router = state?['router'];
    if (router is! Map) throw StateError('请先读取 Router 身份');
    final settings = widget.controller.settings;
    return RouterCommandJournal.digest({
      'gateway': settings.baseUrl,
      'credential': settings.token,
      'router': router
    });
  }

  Future<void> recoverCommands() async {
    if (busy) return;
    setState(() {
      busy = true;
    });
    try {
      final group = journalGroup();
      final results = await widget.controller.routerJournal.recover(
          group: group,
          lookup: (id) {
            if (journalGroup() != group) throw StateError('连接已改变');
            return api!.post('/api/router', {
              'operation': 'command_receipt',
              'args': {'requestId': id}
            });
          });
      if (!mounted) return;
      const names = {
        'create_job': '创建项目',
        'assign': '分配任务',
        'dispatch': '派发任务',
        'answer': '回答或审批',
        'cancel': '取消执行',
        'pause': '暂停派发',
        'resume': '恢复派发',
        'accept': '验收',
        'set_execution': '更新授权',
        'revise_task': '调整分支'
      };
      await showDialog<void>(
          context: context,
          builder: (context) => AlertDialog(
                  title: const Text('未决操作核对'),
                  content: SingleChildScrollView(
                      child: Text(results.isEmpty
                          ? '当前 Router 没有待核对的本地操作。'
                          : results
                              .map((r) =>
                                  '${names[r['operation']] ?? '操作'}：${r['status'] == 'resolved' ? '已查到回执，请查看刷新后的状态' : '仍未确认，记录已保留，未重新发送'}')
                              .join('\n\n'))),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context),
                        child: const Text('知道了'))
                  ]));
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('暂时无法核对，已保留操作记录，没有重新发送。')));
      }
    } finally {
      if (mounted) {
        setState(() {
          busy = false;
        });
      }
    }
    if (mounted) await refresh();
  }

  Future<Map<String, dynamic>> command(
      String operation, Map<String, dynamic> args) async {
    if (!identical(api, widget.controller.api)) throw StateError('连接已改变');
    final body = {'operation': operation, 'args': args};
    if ([
      'catalog',
      'read_session',
      'snapshot',
      'events',
      'reconcile',
      'briefing'
    ].contains(operation)) {
      return api!.post('/api/router', body);
    }
    final router = state?['router'];
    if (router is! Map) throw StateError('请先读取 Router 身份');
    final settings = widget.controller.settings;
    final scope = RouterCommandJournal.digest({
      'gateway': settings.baseUrl,
      'credential': settings.token,
      'router': router,
      'target': args['taskId'] ?? args['jobId'] ?? 'new-project',
    });
    String? receiptId;
    if (operation == 'dispatch') {
      final matches =
          rows(state?['tasks']).where((t) => t['id'] == args['taskId']);
      receiptId = matches.firstOrNull?['dispatchId'] as String?;
      if (receiptId == null) throw StateError('请刷新获取任务的稳定派发编号');
    }
    return widget.controller.routerJournal.submit(
      scope: scope,
      body: body,
      receiptId: receiptId,
      group: journalGroup(),
      post: (id) {
        if (!identical(api, widget.controller.api)) throw StateError('连接已改变');
        return api!.post('/api/router', body, requestId: id);
      },
      lookup: (id) {
        if (!identical(api, widget.controller.api)) throw StateError('连接已改变');
        return api!.post('/api/router', {
          'operation': 'command_receipt',
          'args': {'requestId': id},
        });
      },
    );
  }

  Future<void> run(String operation, Map<String, dynamic> args) async {
    if (busy) return;
    setState(() {
      busy = true;
    });
    try {
      await command(operation, args);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('操作未确认。请刷新核对原会话；发送失败时不要重复派发。')));
      }
    } finally {
      if (mounted) {
        setState(() {
          busy = false;
        });
      }
    }
    if (mounted) await refresh();
  }

  Future<void> createProject() async {
    try {
      final catalog = await command('catalog', {});
      if (!mounted) return;
      final result = await showDialog<Map<String, dynamic>>(
          context: context,
          builder: (_) => RouterProjectDialog(
              catalog: catalog,
              defaultRouter: Map<String, dynamic>.from(state!['router'])));
      if (result != null && mounted) await run('create_job', result);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('无法读取原会话，请确认电脑后台已启用 Router。')));
      }
    }
  }

  Future<void> confirmInstance(Map<String, dynamic> task) async {
    try {
      final detail = await command('read_session',
          {'jobId': task['job'], 'sessionKey': task['session']});
      if (!mounted) return;
      final generation = detail['generation'];
      if (generation is! String || generation.isEmpty) {
        throw StateError('原应用暂未提供有效实例身份');
      }
      final messages = rows(detail['messages']);
      final recent =
          messages.skip(messages.length > 3 ? messages.length - 3 : 0);
      final confirmed = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
                  title: const Text('核对重启后的原会话'),
                  content: SizedBox(
                      width: 560,
                      child: SingleChildScrollView(
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                            Text(
                                '${task['node']['toolId']} · ${task['node']['device']}'),
                            Text('原会话：${task['session']}'),
                            const SizedBox(height: 12),
                            const Text(
                                '确认下方仍是这项任务的原对话。确认只恢复观察，不重发任务、不批准操作，也不代表结果已验收。若期间有人更改了要求，后台会阻止直接恢复。'),
                            for (final message in recent)
                              Padding(
                                  padding: const EdgeInsets.only(top: 12),
                                  child: Text('${message['text'] ?? ''}',
                                      maxLines: 6,
                                      overflow: TextOverflow.ellipsis)),
                          ]))),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context, false),
                        child: const Text('暂不恢复')),
                    FilledButton(
                        onPressed: () => Navigator.pop(context, true),
                        child: const Text('确认原会话，恢复观察'))
                  ]));
      if (confirmed == true && mounted) {
        await run('confirm_instance', {
          'taskId': task['id'],
          'previousGeneration': task['node']['generation'],
          'generation': generation
        });
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('无法核对原会话，请确认原应用在线；没有恢复执行或重新发送。')));
      }
    }
  }

  Future<void> configureExecution(Map<String, dynamic> job) async {
    try {
      final catalog = await command('catalog', {});
      if (!mounted) return;
      final args = await showRouterExecutionPermissions(context,
          job: job, catalog: catalog);
      if (args != null && mounted) await run('set_execution', args);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('无法加载执行权限，请检查电脑连接后重试。')));
      }
    }
  }

  Future<void> assign(Map<String, dynamic> job) async {
    final allowed = job['execution']?['sessions'] as List? ?? [];
    if (allowed.isEmpty) return;
    final instruction = TextEditingController(),
        acceptance = TextEditingController();
    String target = allowed.first as String;
    final yes = await showDialog<bool>(
        context: context,
        builder: (context) => StatefulBuilder(
            builder: (context, change) => AlertDialog(
                  title: const Text('分配原会话任务'),
                  content: SizedBox(
                      width: 520,
                      child: SingleChildScrollView(
                          child:
                              Column(mainAxisSize: MainAxisSize.min, children: [
                        DropdownButtonFormField<String>(
                            value: target,
                            isExpanded: true,
                            items: allowed
                                .map((s) => DropdownMenuItem(
                                    value: s as String,
                                    child: Text(s,
                                        overflow: TextOverflow.ellipsis)))
                                .toList(),
                            onChanged: (v) {
                              if (v != null) {
                                change(() {
                                  target = v;
                                });
                              }
                            }),
                        TextField(
                            controller: instruction,
                            maxLines: 4,
                            decoration:
                                const InputDecoration(labelText: '任务与范围')),
                        TextField(
                            controller: acceptance,
                            maxLines: 2,
                            decoration:
                                const InputDecoration(labelText: '验收条件')),
                        const SizedBox(height: 12),
                        const Text('沿用原应用的账号、模型和权限。创建分配后仍需点击“派发”。'),
                      ]))),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context, false),
                        child: const Text('取消')),
                    FilledButton(
                        onPressed: () {
                          if (instruction.text.trim().isNotEmpty &&
                              acceptance.text.trim().isNotEmpty) {
                            Navigator.pop(context, true);
                          }
                        },
                        child: const Text('保存任务'))
                  ],
                )));
    if (yes == true) {
      await run('assign', {
        'jobId': job['id'],
        'sessionKey': target,
        'package': {
          'schemaVersion': 1,
          'contextRevision': job['contextRevision'],
          'goal': instruction.text.trim(),
          'acceptance': acceptance.text.trim(),
          'constraints': ['保持原会话；不要扩大任务范围'],
          'sources': [
            {
              'kind': 'user',
              'ref': 'mobile:${DateTime.now().toUtc().toIso8601String()}'
            }
          ]
        }
      });
    }
  }

  Future<void> inspect(Map<String, dynamic> task) async {
    try {
      final detail = await command('read_session',
          {'jobId': task['job'], 'sessionKey': task['session']});
      if (!mounted) return;
      await showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          builder: (context) => SafeArea(
              child: FractionallySizedBox(
                  heightFactor: .88,
                  child: Column(children: [
                    ListTile(
                        title: Text(
                            '${task['node']['title'] ?? task['node']['toolId']}'),
                        subtitle: const Text('原会话证据 · 执行细节默认折叠'),
                        trailing: IconButton(
                            onPressed: () => Navigator.pop(context),
                            icon: const Icon(Icons.close))),
                    Expanded(
                        child: ListView(
                            padding: const EdgeInsets.all(16),
                            children: rows(detail['messages'])
                                .map((m) => m['type'] == 'step'
                                    ? ExpansionTile(
                                        title: Text('${m['title'] ?? '执行步骤'}'),
                                        children: [
                                            SelectableText('${m['text'] ?? ''}')
                                          ])
                                    : Padding(
                                        padding:
                                            const EdgeInsets.only(bottom: 18),
                                        child: SelectableText(
                                            '${m['role'] == 'user' ? '你' : 'Agent'}\n${m['text'] ?? ''}')))
                                .toList())),
                    ...rows(detail['interactions']).map((i) => Padding(
                        padding: const EdgeInsets.all(12),
                        child: Card(
                            child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Column(children: [
                                  Text(
                                      '${i['title'] ?? i['description'] ?? '原会话需要处理交互'}'),
                                  if (i['kind'] == 'approval')
                                    Row(
                                        mainAxisAlignment:
                                            MainAxisAlignment.end,
                                        children: [
                                          TextButton(
                                              onPressed: () {
                                                Navigator.pop(context);
                                                run('answer', {
                                                  'taskId': task['id'],
                                                  'interactionId': i['id'],
                                                  'revision': i['revision'],
                                                  'response': {
                                                    'decision': 'decline'
                                                  }
                                                });
                                              },
                                              child: const Text('拒绝')),
                                          FilledButton(
                                              onPressed: () {
                                                Navigator.pop(context);
                                                run('answer', {
                                                  'taskId': task['id'],
                                                  'interactionId': i['id'],
                                                  'revision': i['revision'],
                                                  'response': {
                                                    'decision': 'accept'
                                                  }
                                                });
                                              },
                                              child: const Text('同意')),
                                        ])
                                  else if (i['kind'] == 'question' &&
                                      task['node']?['capabilities']
                                              ?['answer'] ==
                                          'supported')
                                    FilledButton(
                                        onPressed: () {
                                          Navigator.pop(context);
                                          answerQuestion(task, i);
                                        },
                                        child: const Text('回答问题'))
                                  else
                                    const Text('原工具未提供此交互接口，请在电脑原会话处理。'),
                                ]))))),
                  ]))));
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('原会话证据暂不可用，未发送任何指令。')));
      }
    }
  }

  Future<void> answerQuestion(
      Map<String, dynamic> task, Map<String, dynamic> interaction) async {
    final answers = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('回答原会话的问题'),
        content: SingleChildScrollView(
            child: QuestionCard(
          request: interaction,
          enabled: true,
          busy: false,
          onSubmit: (answers) => Navigator.pop(context, answers),
        )),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('稍后回答'))
        ],
      ),
    );
    if (answers != null && mounted) {
      await run('answer', {
        'taskId': task['id'],
        'interactionId': interaction['id'],
        'revision': interaction['revision'],
        'response': {'decision': 'answer', 'answers': answers}
      });
    }
  }

  Future<void> reviewResult(Map<String, dynamic> task) async {
    var verdict = '';
    try {
      final detail = await command('read_session',
          {'jobId': task['job'], 'sessionKey': task['session']});
      if (!mounted) return;
      final references = (task['observed']?['evidenceRefs'] ??
              task['observed']?['messageRefs']) as List? ??
          [];
      final evidence = rows(detail['messages'])
          .where((m) =>
              m['role'] == 'agent' &&
              references.contains(m['id']) &&
              '${m['text'] ?? ''}'.trim().isNotEmpty)
          .toList();
      final checked = <String>{};
      final result = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (context) => StatefulBuilder(
            builder: (context, change) => AlertDialog(
                  title: const Text('核对结果后验收'),
                  content: SizedBox(
                      width: 560,
                      height: (MediaQuery.sizeOf(context).height * .5)
                          .clamp(200, 440),
                      child: SingleChildScrollView(
                          child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('验收条件：${task['package']['acceptance'] ?? ''}'),
                          const SizedBox(height: 12),
                          const Text('勾选你已经核对的原会话证据，再填写验收结论。模型说“完成”不会自动通过。'),
                          if (evidence.isEmpty)
                            const Text('暂时没有可核对的原回复，请稍后刷新。'),
                          for (final item in evidence)
                            CheckboxListTile(
                              value: checked.contains(item['id']),
                              title: Text('${item['text']}',
                                  maxLines: 6, overflow: TextOverflow.ellipsis),
                              subtitle: Text('原消息：${item['id']}'),
                              onChanged: (value) => change(() {
                                if (value == true) {
                                  checked.add(item['id'] as String);
                                } else {
                                  checked.remove(item['id']);
                                }
                              }),
                            ),
                          TextField(
                              key: const ValueKey('router-acceptance-verdict'),
                              maxLines: 3,
                              decoration:
                                  const InputDecoration(labelText: '验收说明'),
                              onChanged: (value) =>
                                  change(() => verdict = value)),
                        ],
                      ))),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context),
                        child: const Text('暂不验收')),
                    FilledButton(
                        onPressed: checked.isEmpty || verdict.trim().isEmpty
                            ? null
                            : () => Navigator.pop(context, {
                                  'taskId': task['id'],
                                  'verdict': verdict.trim(),
                                  'evidence': checked
                                      .map((ref) =>
                                          {'ref': ref, 'verified': true})
                                      .toList(),
                                }),
                        child: const Text('确认验收')),
                  ],
                )),
      );
      if (result != null && mounted) await run('accept', result);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('无法核对最新证据，未提交验收。')));
      }
    }
  }

  Future<void> timeline(Map<String, dynamic> job) async {
    try {
      if (!identical(api, widget.controller.api)) throw StateError('连接已改变');
      final response = await api!.bytes(
          '/api/router?operation=events&jobId=${Uri.encodeQueryComponent(job['id'] as String)}&after=0');
      final events = rows(jsonDecode(utf8.decode(response)));
      if (!mounted) return;
      await showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          builder: (context) => SafeArea(
              child: FractionallySizedBox(
                  heightFactor: .85,
                  child: Column(children: [
                    ListTile(
                        title: Text('${job['name']} · 进展时间线'),
                        subtitle: const Text('后端已记录的事件；事件出现不代表任务验收通过'),
                        trailing: IconButton(
                            onPressed: () => Navigator.pop(context),
                            icon: const Icon(Icons.close))),
                    Expanded(
                        child: ListView(
                            padding: const EdgeInsets.all(16),
                            children: [
                          if (events.isEmpty) const Text('暂无已记录事件。'),
                          for (final event in events)
                            ListTile(
                                leading: const Icon(Icons.history, size: 20),
                                title: Text(eventLabel('${event['kind']}')),
                                subtitle: Text(
                                    '${eventTime(event['at'])}\n${event['task'] == null ? '项目事件' : '任务 ${event['task']}'}'),
                                isThreeLine: true),
                          if (events.length == 100)
                            const Text('当前显示最早 100 条记录，完整历史保留在电脑后台。'),
                        ])),
                  ]))));
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('进展记录暂不可用，未发送任何工作指令。')));
      }
    }
  }

  String eventTime(dynamic value) {
    if (value is! num) return '时间未记录';
    final date = DateTime.fromMillisecondsSinceEpoch(value.toInt()).toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${date.year}-${two(date.month)}-${two(date.day)} ${two(date.hour)}:${two(date.minute)}:${two(date.second)}';
  }

  String eventLabel(String kind) =>
      const {
        'job_created': '项目已创建',
        'assignment_queued': '任务已分配',
        'dispatch_submitting': '开始派发',
        'dispatch_acknowledged': '原会话已接收',
        'delivery_unknown': '送达结果待核对',
        'accepted': '任务已验收',
        'human_intervention': '人工介入',
        'cancel_requested': '已请求取消',
        'cancel_confirmed': '取消已确认',
        'native_session_created': '原生会话已创建',
        'native_observed': '原会话进展已更新',
        'observation_unavailable': '暂时无法读取原会话',
        'observation_restored': '原会话读取已恢复',
        'task_package_revised': '分支任务包已修订',
        'execution_authorization_changed': '执行授权已更新',
        'generation_changed': '原应用实例变化 · 等待核对',
        'instance_confirmed': '已核对原会话 · 恢复观察',
      }[kind] ??
      kind;

  String label(String value) =>
      const {
        'queued': '待派发',
        'dispatching': '正在送达',
        'delivery_unknown': '送达待核对',
        'running': '执行中',
        'awaiting_result': '等待结果证据',
        'awaiting_observation': '已接收 · 等待记录同步',
        'completion_claim': '待验收',
        'succeeded': '已验收',
        'waiting_approval': '待审批',
        'waiting_question': '待回答',
        'human_intervention': '人工介入 · 已暂停',
        'cancel_requested': '取消待确认',
        'cancelled': '已取消',
        'failed': '失败',
        'superseded': '已被新版任务替代'
      }[value] ??
      value;
  String sessionTitle(String session, List<Map<String, dynamic>> tasks) {
    final matches = tasks.where((t) => t['session'] == session);
    if (matches.isEmpty) return session;
    final node = matches.first['node'] as Map? ?? {};
    return '${node['title'] ?? node['toolId'] ?? '原会话'} · ${node['device'] ?? ''}';
  }

  Widget taskCard(Map<String, dynamic> task, Map<String, dynamic> job) =>
      Padding(
          padding: const EdgeInsets.only(top: 12),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${task['package']['goal']}',
                style: const TextStyle(fontWeight: FontWeight.w500)),
            Text(
                '${task['node']['toolId']} · ${task['node']['device']} · ${task['observation']?['status'] == 'unavailable' ? '上次状态：' : ''}${label('${task['state']}')}',
                style: const TextStyle(fontSize: 12)),
            if (task['state'] == 'human_intervention' &&
                task['reason'] == 'Worker instance changed')
              TextButton.icon(
                  onPressed: busy ? null : () => confirmInstance(task),
                  icon: const Icon(Icons.fact_check_outlined),
                  label: const Text('核对重启后的连接')),
            if (task['observation']?['status'] == 'unavailable')
              const Text('暂时无法读取原会话，执行结果未知；不会自动重发任务。',
                  style: TextStyle(color: Color(0xff85510b))),
            if (task['observation']?['lastSuccessAt'] is num)
              Text(
                  '最近读取：${DateTime.fromMillisecondsSinceEpoch((task['observation']['lastSuccessAt'] as num).toInt()).toLocal()}',
                  style: const TextStyle(fontSize: 12)),
            if (rows(task['observed']?['recentUpdates']).isNotEmpty)
              ExpansionTile(
                key: PageStorageKey('evidence:${task['id']}'),
                tilePadding: EdgeInsets.zero,
                title: const Text('最新进展 · 原会话摘录'),
                children: [
                  for (final update in rows(task['observed']['recentUpdates']))
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${update['excerpt'] ?? ''}',
                                maxLines: 6, overflow: TextOverflow.ellipsis),
                            Text(
                                '来源：${update['ref']} · ${update['truncated'] == true ? '节选，全文见原对话' : '原会话记录'}',
                                style: const TextStyle(fontSize: 12)),
                          ]),
                    ),
                ],
              ),
            Wrap(spacing: 4, children: [
              if (task['state'] == 'completion_claim')
                TextButton(
                    onPressed:
                        busy || task['observation']?['status'] == 'unavailable'
                            ? null
                            : () => reviewResult(task),
                    child: const Text('核对并验收')),
              TextButton(
                  onPressed: () => inspect(task), child: const Text('查看原对话')),
              if (task['state'] == 'queued')
                TextButton(
                    onPressed: busy ||
                            job['paused'] == true ||
                            !(job['execution']?['sessions'] as List? ?? [])
                                .contains(task['session'])
                        ? null
                        : () => run('dispatch', {'taskId': task['id']}),
                    child: const Text('派发')),
              if (task['state'] == 'delivery_unknown')
                TextButton(
                    onPressed: busy
                        ? null
                        : () => run('reconcile', {'taskId': task['id']}),
                    child: const Text('核对送达')),
              if (['queued', 'running', 'waiting_approval', 'waiting_question']
                  .contains(task['state']))
                TextButton(
                    onPressed: busy ||
                            (task['state'] != 'queued' &&
                                task['node']?['capabilities']?['cancel'] !=
                                    'supported')
                        ? null
                        : () => run('cancel', {'taskId': task['id']}),
                    child: Text(task['state'] != 'queued' &&
                            task['node']?['capabilities']?['cancel'] !=
                                'supported'
                        ? '原工具暂不支持取消'
                        : '取消')),
            ]),
          ]));

  @override
  Widget build(BuildContext context) {
    final jobs = rows(state?['jobs']), tasks = rows(state?['tasks']);
    return Scaffold(
      appBar: AppBar(title: const Text('Mydex-superagent·灰度测试'), actions: [
        IconButton(
            onPressed: busy ? null : () => refresh(),
            icon: const Icon(Icons.refresh))
      ]),
      floatingActionButton: FloatingActionButton.extended(
          onPressed: busy ? null : createProject,
          icon: const Icon(Icons.add),
          label: const Text('接入会话')),
      body: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
          children: [
            const Text('原会话调度台',
                style: TextStyle(fontSize: 26, fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                    onPressed: busy || state == null ? null : recoverCommands,
                    icon: const Icon(Icons.history),
                    label: const Text('核对未决操作'))),
            const Text(
                '你 → 指定 Router → 已勾选的 Worker → 原电脑。轮次结束会进入“待验收”，不会自动判定任务成功。'),
            if (error != null)
              Padding(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: Text(error!,
                      style: TextStyle(
                          color: Theme.of(context).colorScheme.error))),
            if (state != null)
              ListTile(
                  contentPadding: const EdgeInsets.symmetric(vertical: 8),
                  leading: const Icon(Icons.hub_outlined),
                  title: const Text('你的 Router'),
                  subtitle: const Text('打开原对话，讨论目标与分工'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () async {
                    if (!identical(api, widget.controller.api)) return;
                    final router = state!['router'];
                    final c = widget.controller;
                    final opened = await c.openNativeRouter(
                        router['device'] as String,
                        router['session'] as String);
                    if (context.mounted && opened) {
                      Navigator.pop(context);
                    } else if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                          content: Text('指定 Router 原会话暂时无法打开，已保留当前会话。')));
                    }
                  }),
            if (jobs.isNotEmpty)
              Padding(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: DropdownButtonFormField<String>(
                      value: selectedJob,
                      isExpanded: true,
                      decoration: const InputDecoration(
                          labelText: '当前协调项目', border: OutlineInputBorder()),
                      items: jobs
                          .map((job) => DropdownMenuItem<String>(
                              value: job['id'] as String,
                              child: Text('${job['name']}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis)))
                          .toList(),
                      onChanged: busy
                          ? null
                          : (value) => setState(() => selectedJob = value))),
            for (final job in jobs.where((j) => j['id'] == selectedJob))
              Card(
                  margin: const EdgeInsets.only(bottom: 16),
                  child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${job['name']}',
                                style: const TextStyle(
                                    fontSize: 20, fontWeight: FontWeight.w600)),
                            Text(
                                '已选 ${(job['scope'] as List? ?? []).length} 条原会话 · ${tasks.where((t) => t['job'] == job['id']).length} 个任务'),
                            if (job['routerReading'] is Map) ...[
                              const SizedBox(height: 8),
                              Text(job['routerReading']['status'] == 'unread'
                                  ? '有 ${job['routerReading']['unread']} 条进展尚未由 Router 确认读取'
                                  : job['routerReading']['status'] ==
                                          'caught_up'
                                      ? 'Router 已确认读取当前记录（不代表结果已验收）'
                                      : '暂无进展记录'),
                              if (job['routerReading']['lastReadAt'] is num)
                                Text(
                                    '最近确认读取：${eventTime(job['routerReading']['lastReadAt'])}',
                                    style: const TextStyle(fontSize: 12)),
                            ],
                            Wrap(spacing: 8, children: [
                              TextButton(
                                  onPressed: busy
                                      ? null
                                      : () => configureExecution(job),
                                  child: Text(
                                      (job['execution']?['sessions'] as List? ??
                                                  [])
                                              .isEmpty
                                          ? '仅观察 · 设置执行授权'
                                          : '管理执行授权')),
                              TextButton(
                                  onPressed: busy ? null : () => timeline(job),
                                  child: const Text('进展时间线')),
                              TextButton(
                                  onPressed: busy ||
                                          (job['execution']?['sessions']
                                                      as List? ??
                                                  [])
                                              .isEmpty
                                      ? null
                                      : () => assign(job),
                                  child: const Text('分配任务')),
                              TextButton(
                                  onPressed: busy
                                      ? null
                                      : () => run(
                                          job['paused'] == true
                                              ? 'resume'
                                              : 'pause',
                                          {'jobId': job['id']}),
                                  child: Text(
                                      job['paused'] == true ? '恢复派发' : '暂停派发'))
                            ]),
                            for (final session in (job['scope'] as List? ?? []))
                              ExpansionTile(
                                  key: PageStorageKey('${job['id']}:$session'),
                                  initiallyExpanded: true,
                                  tilePadding: EdgeInsets.zero,
                                  leading: const Icon(
                                      Icons.account_tree_outlined,
                                      size: 20),
                                  title: Text(
                                      sessionTitle(session.toString(), tasks),
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis),
                                  subtitle: Text(
                                      '${tasks.where((t) => t['job'] == job['id'] && t['session'] == session).length} 个任务 · 原会话'),
                                  children: [
                                    for (final task in tasks.where((t) =>
                                        t['job'] == job['id'] &&
                                        t['session'] == session))
                                      Container(
                                          margin: const EdgeInsets.only(
                                              left: 10, bottom: 8),
                                          padding:
                                              const EdgeInsets.only(left: 16),
                                          decoration: BoxDecoration(
                                              border: Border(
                                                  left: BorderSide(
                                                      color: Theme.of(context)
                                                          .dividerColor))),
                                          child: taskCard(task, job)),
                                    if (!tasks.any((t) =>
                                        t['job'] == job['id'] &&
                                        t['session'] == session))
                                      const Padding(
                                          padding: EdgeInsets.all(12),
                                          child: Text('已选入项目，尚未分配任务。')),
                                  ]),
                          ]))),
            if (state != null && jobs.isEmpty)
              const Padding(
                  padding: EdgeInsets.symmetric(vertical: 32),
                  child: Text('还没有协调项目。先勾选原会话，再分配任务。')),
          ]),
    );
  }
}
