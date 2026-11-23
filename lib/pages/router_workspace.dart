import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import '../controller.dart';
import '../models.dart';
import 'home.dart' show ConversationPanel;
import 'native_router.dart';
import '../widgets/router_tree.dart';
import '../widgets/router_briefing.dart';
import '../widgets/router_execution_permissions.dart';
import '../services/router_command_journal.dart';

/// User-selected layout A: the original Router conversation is the primary
/// surface. Progress and Worker controls stay available without replacing it.
class RouterWorkspacePage extends StatefulWidget {
  final AppController controller;
  final bool initialTree;
  const RouterWorkspacePage(
      {super.key, required this.controller, this.initialTree = false});
  @override
  State<RouterWorkspacePage> createState() => _RouterWorkspacePageState();
}

class _RouterWorkspacePageState extends State<RouterWorkspacePage> {
  AppController get c => widget.controller;
  Json? snapshot;
  String? routerId, error;
  bool loading = false;
  Timer? timer;
  String? address, credential;
  String? projectId;
  bool showTree = false;
  bool permissionsBusy = false;
  int composerRevision = 0;
  final chosen = <String>{};
  String? snapshotDigest;
  @override
  void initState() {
    super.initState();
    showTree = widget.initialTree;
    load(open: true);
    timer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed &&
          ModalRoute.of(context)?.isCurrent == true) {
        load();
      }
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  Future<void> load({bool open = false}) async {
    if (loading) return;
    final api = c.api;
    if (api == null) return;
    if (!open &&
        (address != c.settings.baseUrl || credential != c.settings.token)) {
      if (mounted) setState(() => error = '连接已更换，请重新打开 Router。');
      return;
    }
    loading = true;
    if (open && mounted) setState(() => error = null);
    try {
      final result = await api.get('/api/router');
      if (!mounted || !identical(api, c.api)) return;
      final available = objects(result['jobs']);
      final activeJob =
          available.where((j) => j['id'] == projectId).firstOrNull ??
              available.firstOrNull;
      final identity = activeJob?['router'] ?? result['router'];
      if (identity is! Map ||
          identity['device'] is! String ||
          identity['session'] is! String) {
        throw StateError('Router 身份不可用');
      }
      final id = '${identity['device']}~${identity['session']}';
      final shouldOpen = open || routerId != id;
      if (!mounted || !identical(api, c.api)) return;
      final digest = jsonEncode(result);
      // Do not rebuild the entire graph/conversation on unchanged polls.
      if (!open && digest == snapshotDigest && error == null) return;
      setState(() {
        snapshotDigest = digest;
        snapshot = result;
        routerId = id;
        error = null;
        final jobs = objects(result['jobs']);
        if (!jobs.any((j) => j['id'] == projectId)) {
          projectId = jobs.firstOrNull?['id'] as String?;
          chosen.clear();
        }
        final job = jobs.where((j) => j['id'] == projectId).firstOrNull;
        final eligible = job == null
            ? <String>{}
            : RouterTree.branches(job, objects(result['tasks']))
                .map((t) => t['session'].toString())
                .toSet();
        chosen.removeWhere((s) => !eligible.contains(s));
        address = c.settings.baseUrl;
        credential = c.settings.token;
      });
      // Project facts remain visible even when opening the original chat fails.
      if (shouldOpen &&
          !await c.openNativeRouter(identity['device'], identity['session']) &&
          mounted) {
        setState(() => error = '项目已加载，Router 原对话暂未连接。请重试。');
      }
    } catch (_) {
      if (mounted) setState(() => error = '暂时无法读取 Router，请检查电脑连接后重试。');
    } finally {
      loading = false;
      if (open && mounted) setState(() {});
    }
  }

  Future<void> progress() async {
    await Navigator.push(
        context,
        MaterialPageRoute(
            builder: (_) =>
                NativeRouterPage(controller: c, initialJobId: projectId)));
    if (mounted) await load();
  }

  Future<void> editPermissions(Json job) async {
    if (permissionsBusy) return;
    final api = c.api;
    if (api == null) return;
    final settings = c.settings;
    final identity = snapshot?['router'];
    final selectedProject = projectId;
    bool sameConnection() =>
        mounted &&
        identical(api, c.api) &&
        settings.baseUrl == c.settings.baseUrl &&
        settings.token == c.settings.token &&
        selectedProject == projectId;
    setState(() => permissionsBusy = true);
    try {
      final catalog =
          await api.post('/api/router', {'operation': 'catalog', 'args': {}});
      if (!mounted || !sameConnection()) return;
      final args = await showRouterExecutionPermissions(context,
          job: job, catalog: catalog);
      if (args == null || !sameConnection()) return;
      final body = {'operation': 'set_execution', 'args': args};
      final group = RouterCommandJournal.digest({
        'gateway': settings.baseUrl,
        'credential': settings.token,
        'router': identity
      });
      await c.routerJournal.submit(
          scope: RouterCommandJournal.digest({
            'gateway': settings.baseUrl,
            'credential': settings.token,
            'router': identity,
            'target': job['id']
          }),
          group: group,
          body: body,
          post: (id) {
            if (!sameConnection()) throw StateError('连接已改变');
            return api.post('/api/router', body, requestId: id);
          },
          lookup: (id) {
            if (!sameConnection()) throw StateError('连接已改变');
            return api.post('/api/router', {
              'operation': 'command_receipt',
              'args': {'requestId': id}
            });
          });
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Router 执行权限已保存')));
      }
      await load();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('权限尚未确认，请刷新核对；不会自动重复提交。')));
      }
    } finally {
      if (mounted) setState(() => permissionsBusy = false);
    }
  }

  Future<void> inspectNode(Json task) async {
    final api = c.api;
    if (api == null ||
        address != c.settings.baseUrl ||
        credential != c.settings.token) {
      return;
    }
    try {
      if (task['kind'] == 'resource') {
        final detail = await api.post('/api/router', {
          'operation': 'read_resource',
          'args': {'jobId': projectId, 'resourceId': task['resourceId']}
        });
        if (!mounted || !identical(api, c.api)) return;
        await showDialog<void>(
            context: context,
            builder: (context) => AlertDialog(
                    title: Text('${task['node']?['title']}'),
                    content: SizedBox(
                        width: 420,
                        child: SingleChildScrollView(
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                              Text(detail['status'] == 'unavailable'
                                  ? '本次查询失败，请稍后重试'
                                  : '已读取服务器状态'),
                              const SizedBox(height: 10),
                              Text(detail['gpuQueryOkay'] == true
                                  ? 'GPU 实时查询成功'
                                  : 'GPU 实时状态尚未确认'),
                              for (final line in detail['gpu'] as List? ?? [])
                                Text('$line',
                                    style: const TextStyle(fontSize: 12)),
                              const SizedBox(height: 12),
                              for (final row in objects(detail['jobs']))
                                Padding(
                                    padding: const EdgeInsets.only(bottom: 12),
                                    child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text('${row['name']}',
                                              style: const TextStyle(
                                                  fontWeight: FontWeight.w600)),
                                          Text(
                                              '状态文件更新：${row['modifiedAt'] ?? '未知'}',
                                              style: const TextStyle(
                                                  fontSize: 12)),
                                          Text(
                                              '${row['status']?['phase'] ?? row['status']?['current_job'] ?? '已取得状态文件'}'),
                                        ])),
                              const Text('状态快照和 GPU 负载不等于实验已成功。',
                                  style: TextStyle(fontSize: 12)),
                              ExpansionTile(
                                  title: const Text('查看查询证据'),
                                  children: [
                                    SelectableText(
                                        const JsonEncoder.withIndent('  ')
                                            .convert(detail),
                                        style: const TextStyle(fontSize: 11))
                                  ]),
                            ]))),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text('关闭'))
                    ]));
        return;
      }
      final detail = await api.post('/api/router', {
        'operation': 'read_session',
        'args': {'jobId': projectId, 'sessionKey': task['session']}
      });
      if (!mounted || !identical(api, c.api)) return;
      await showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          builder: (context) => SafeArea(
              child: SizedBox(
                  height: MediaQuery.sizeOf(context).height * .8,
                  child: Column(children: [
                    ListTile(
                        title:
                            Text('${task['node']?['title'] ?? 'Worker 原对话'}'),
                        subtitle: Text(RouterTree.stateLabel(task['state'])),
                        trailing: IconButton(
                            tooltip: '关闭',
                            onPressed: () => Navigator.pop(context),
                            icon: const Icon(Icons.close))),
                    Expanded(
                        child: ListView(
                            padding: const EdgeInsets.all(16),
                            children: [
                          ExpansionTile(
                              title: const Text('技术身份与诊断'),
                              children: [
                                SelectableText('原会话：${task['session']}'),
                                Text('工具：${task['node']?['toolId'] ?? '未知'}'),
                                Text(
                                    '来源：${task['node']?['hostName'] ?? task['node']?['device'] ?? '未知'}'),
                              ]),
                          const SizedBox(height: 12),
                          for (final message in objects(detail['messages']))
                            Padding(
                                padding: const EdgeInsets.only(bottom: 16),
                                child: SelectableText(
                                    '${message['role'] == 'user' ? '用户' : 'Worker'}\n${message['text'] ?? ''}')),
                          if (objects(detail['messages']).isEmpty)
                            const Text('没有可读取的消息。'),
                        ])),
                  ]))));
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('暂时无法读取原会话，没有创建替代任务。')));
      }
    }
  }

  void askSelected(Json job, List<Json> tasks) {
    if (routerId == null || c.selectedId != routerId || chosen.isEmpty) return;
    final nodes = RouterTree.branches(job, tasks)
        .where((n) => chosen.contains(n['session']));
    final scope = nodes
        .map((n) => '• ${n['node']?['title'] ?? '原会话'} [${n['session']}]')
        .join('\n');
    // User reviews the scope in the existing composer; selection never sends.
    final previous = c.drafts[routerId] ?? '';
    c.drafts[routerId!] =
        '本次关注项目「${job['name']}」(${job['id']})中的这些分支：\n$scope\n请先读取最新简报与原会话。具体目标以我接下来写的要求为准；执行须遵守项目已保存的权限，审批仍需我明确决定。\n${previous.isEmpty ? '' : previous}';
    setState(() {
      composerRevision++;
      showTree = false;
    });
  }

  Future<void> briefing(Json job, List<Json> tasks) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheet) => SizedBox(
          height: MediaQuery.sizeOf(sheet).height * .85,
          child: RouterBriefing(
              job: job,
              tasks: tasks,
              onNode: (node) {
                Navigator.pop(sheet);
                inspectNode(node);
              },
              onOrganize: () {
                Navigator.pop(sheet);
                organize(job, tasks);
              },
              onSummarize: () {
                Navigator.pop(sheet);
                organize(job, tasks, summarize: true);
              },
              onAttention: () {
                Navigator.pop(sheet);
                progress();
              })),
    );
  }

  void organize(Json job, List<Json> tasks, {bool summarize = false}) {
    if (routerId == null || c.selectedId != routerId) return;
    final nodes = RouterTree.branches(job, tasks);
    final scope = nodes
        .map((n) =>
            '• ${n['node']?['title'] ?? '节点'} [${n['session'] ?? n['resourceId']}] (${n['kind'] ?? 'worker'})')
        .join('\n');
    c.drafts[routerId!] =
        '请作为项目「${job['name']}」(${job['id']})的组织者，${summarize ? '汇总进展、阻塞、待我决定的事项和下一步' : '梳理以下已选节点的分工'}：\n$scope\n'
        '先读取本项目 briefing，再用 read_session 读取选中原会话；服务器只使用已注册的 read_resource 查询。'
        '根据实际记录归纳每个节点的职责、正在做的工作、输出、上下游依赖和阻塞，并注明证据来源与更新时间。'
        '区分已确认事实和推断，不足时标记待确认，不凭标题猜测。服务器是资源/作业节点，不需要安装 Agent。'
        '给我一份简明分工表与下一步建议，作为后续协调的交接记录。分工推断须由我确认，不能直接当成已授权安排。'
        '说明实际读到的记录范围，briefing 有 hasMore 时继续翻页，只对实际读过的页确认已读。'
        '本次仅研究，不派发、不新建、不审批。';
    setState(() {
      composerRevision++;
      showTree = false;
    });
  }

  void chooseProject(String id) {
    setState(() {
      projectId = id;
      chosen.clear();
      showTree = false;
    });
    load(open: true);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final jobs = objects(snapshot?['jobs']),
            tasks = objects(snapshot?['tasks']);
        final job = jobs.where((j) => j['id'] == projectId).firstOrNull;
        final scoped = tasks
            .where((t) => t['job'] == projectId && t['state'] != 'superseded')
            .toList();
        final attention = scoped.where(RouterTree.needsAttention).length;
        final nodes = job == null ? <Json>[] : RouterTree.branches(job, tasks);
        final connectedIdentity =
            address == c.settings.baseUrl && credential == c.settings.token;
        final readAt = job?['routerReading']?['lastReadAt'];
        String time(dynamic value) => value is num
            ? DateTime.fromMillisecondsSinceEpoch(value.toInt())
                .toLocal()
                .toString()
                .substring(11, 16)
            : '尚未确认';
        Widget tray() => Padding(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 0),
            child: Material(
                color: const Color(0xfffffbf4),
                borderRadius: BorderRadius.circular(12),
                child: ListTile(
                    dense: true,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                        side: const BorderSide(color: Color(0xffead6b5))),
                    leading: const Icon(Icons.pending_actions,
                        color: Color(0xff946013)),
                    title: Text('$attention 项需要你决定',
                        style: const TextStyle(
                            fontSize: 13, fontWeight: FontWeight.w600)),
                    subtitle: const Text('审批 · 问题 · 验收与异常',
                        style: TextStyle(fontSize: 11)),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: progress)));
        Widget conversation() => routerId != null &&
                connectedIdentity &&
                c.selectedId == routerId
            ? Center(
                child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 680),
                    child: ConversationPanel(
                        key:
                            ValueKey('router-chat:$routerId:$composerRevision'),
                        controller: c,
                        agentLabel: 'Router',
                        beforeComposer: attention > 0 ? tray() : null)))
            : loading
                ? const Center(child: CircularProgressIndicator())
                : Center(
                    child: TextButton(
                        onPressed: () => load(open: true),
                        child: const Text('打开指定 Router 原对话')));
        Widget tree() => ColoredBox(
            color: const Color(0xfff6f7f9),
            child: job == null
                ? Center(
                    child: TextButton(
                        onPressed: progress,
                        child: const Text('接入原会话，创建 Router 项目')))
                : SingleChildScrollView(
                    child: RouterTree(
                        job: job,
                        tasks: tasks,
                        devices: c.devices,
                        selected: chosen,
                        onSelect: (id) => setState(() => chosen.contains(id)
                            ? chosen.remove(id)
                            : chosen.add(id)),
                        onNode: inspectNode,
                        onRouter: () => setState(() => showTree = false),
                        onAsk: () => askSelected(job, tasks))));
        return Scaffold(
          drawer: Drawer(
              backgroundColor: const Color(0xfff6f7f9),
              child: SafeArea(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                    Padding(
                        padding: const EdgeInsets.all(20),
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(c.connectionName,
                                  style: const TextStyle(
                                      fontSize: 16,
                                      fontWeight: FontWeight.w600)),
                              Text(c.connected ? '电脑连接在线' : '电脑连接待恢复',
                                  style: const TextStyle(
                                      fontSize: 12, color: Color(0xff71808d))),
                              const SizedBox(height: 24),
                              const Text('>_  Mydex',
                                  style: TextStyle(
                                      fontSize: 24,
                                      fontWeight: FontWeight.w600)),
                              const SizedBox(height: 20),
                              SegmentedButton<bool>(
                                  segments: const [
                                    ButtonSegment(
                                        value: false, label: Text('原会话')),
                                    ButtonSegment(
                                        value: true, label: Text('Router 项目'))
                                  ],
                                  selected: const {
                                    true
                                  },
                                  onSelectionChanged: (_) {
                                    Navigator.pop(context);
                                    Navigator.pop(context);
                                  }),
                              const SizedBox(height: 16),
                              OutlinedButton.icon(
                                  onPressed: () {
                                    Navigator.pop(context);
                                    progress();
                                  },
                                  icon: const Icon(Icons.add),
                                  label: const Text('新建 / 管理 Router 项目')),
                              const SizedBox(height: 12),
                              const Text('以项目组织原会话，账号和执行仍留在电脑。',
                                  style: TextStyle(
                                      fontSize: 12, color: Color(0xff71808d))),
                            ])),
                    Expanded(
                        child: ListView(children: [
                      for (final j in jobs)
                        Padding(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 3),
                            child: ListTile(
                                shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(12)),
                                selected: j['id'] == projectId,
                                selectedTileColor: const Color(0xffe9edf1),
                                title: Text('${j['name']}',
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                        fontSize: 14,
                                        fontWeight: FontWeight.w600)),
                                subtitle: Text(
                                    '${(j['scope'] as List? ?? []).length} 个原会话',
                                    style: const TextStyle(fontSize: 12)),
                                onTap: () {
                                  Navigator.pop(context);
                                  chooseProject(j['id']);
                                }))
                    ])),
                    const Padding(
                        padding: EdgeInsets.all(20),
                        child: Text('Mydex · 私测',
                            style: TextStyle(
                                fontSize: 12, color: Color(0xff71808d)))),
                  ]))),
          appBar: AppBar(
              title: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${job?['name'] ?? 'Router 项目'}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w600)),
                    Text(
                        '${c.connectionName} · Router · ${readAt == null ? '尚未确认已读' : '已读到 ${time(readAt)}'}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 11, color: Color(0xff71808d))),
                  ]),
              actions: [
                IconButton(
                    tooltip: '项目简报',
                    onPressed: job == null ? null : () => briefing(job, tasks),
                    icon: const Icon(Icons.dashboard_outlined)),
                IconButton(
                    tooltip: showTree ? 'Router 对话' : '执行网络',
                    onPressed: () => setState(() => showTree = !showTree),
                    icon: Icon(showTree
                        ? Icons.chat_bubble_outline
                        : Icons.account_tree_outlined)),
                PopupMenuButton<String>(
                    tooltip: '项目操作',
                    onSelected: (v) {
                      if (v == 'manage') progress();
                      if (v == 'permissions' && job != null) {
                        editPermissions(job);
                      }
                      if (v == 'organize' && job != null) organize(job, tasks);
                      if (v == 'refresh') load(open: true);
                      if (v == 'catalog') c.refreshCatalog(force: true);
                      if (v == 'native') Navigator.pop(context);
                    },
                    itemBuilder: (_) => [
                          PopupMenuItem(
                              value: 'permissions',
                              enabled: job != null && !permissionsBusy,
                              child: const Text('执行权限')),
                          const PopupMenuItem(
                              value: 'manage', child: Text('项目进展与审批')),
                          PopupMenuItem(
                              value: 'organize',
                              enabled: job != null && c.selectedId == routerId,
                              child: const Text('让 Router 梳理分工')),
                          const PopupMenuItem(
                              value: 'refresh', child: Text('刷新项目')),
                          const PopupMenuItem(
                              value: 'catalog', child: Text('检查工具与项目')),
                          const PopupMenuItem(
                              value: 'native', child: Text('电脑原会话')),
                        ]),
              ]),
          body: SafeArea(
              child: Column(children: [
            Padding(
                padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
                child: Material(
                    color: const Color(0xfff3f5f7),
                    borderRadius: BorderRadius.circular(12),
                    child: InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: () => setState(() => showTree = !showTree),
                        child: Padding(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 10),
                            child: Row(children: [
                              const Icon(Icons.hub_outlined,
                                  size: 17, color: Color(0xff3d5f7c)),
                              const SizedBox(width: 8),
                              Expanded(
                                  child: Text(
                                      job == null
                                          ? '${jobs.length} 个项目 · 点击管理'
                                          : '${nodes.where((n) => n['kind'] != 'resource').length} 个原会话 · ${nodes.where((n) => n['kind'] == 'resource').length} 个资源',
                                      style: const TextStyle(fontSize: 12))),
                              if (attention > 0)
                                Text('$attention 项等你  ',
                                    style: const TextStyle(
                                        fontSize: 12,
                                        color: Color(0xff946013))),
                              Text(showTree ? '对话' : '网络',
                                  style: const TextStyle(
                                      fontSize: 12, color: Color(0xff3d5f7c))),
                              const Icon(Icons.chevron_right, size: 17),
                            ]))))),
            if (error != null)
              Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Row(children: [
                    Expanded(
                        child:
                            Text(error!, style: const TextStyle(fontSize: 12))),
                    TextButton(
                        onPressed: loading ? null : () => load(open: true),
                        child: const Text('重试'))
                  ])),
            if (showTree && snapshot?['catalogUpdatedAt'] is num)
              Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(
                      '目录同步 ${time(snapshot!['catalogUpdatedAt'])}${snapshot?['catalogRefreshing'] == true ? ' · 后台刷新中' : ''}',
                      style: const TextStyle(
                          fontSize: 11, color: Color(0xff71808d)))),
            if (showTree && job != null)
              Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Row(children: [
                    Expanded(
                        child: Text(
                            '${(job['execution']?['sessions'] as List? ?? []).length} 个会话可执行 · '
                            '${(job['execution']?['workspaces'] as List? ?? []).length} 个工作区可新建',
                            style: const TextStyle(fontSize: 12))),
                    TextButton(
                        onPressed:
                            permissionsBusy ? null : () => editPermissions(job),
                        child: Text(permissionsBusy ? '正在读取…' : '执行权限')),
                  ])),
            Expanded(
                child: LayoutBuilder(
                    builder: (context, box) => box.maxWidth >= 720
                        ? Row(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                                SizedBox(
                                    width: box.maxWidth * .46,
                                    child: conversation()),
                                const VerticalDivider(width: 1),
                                Expanded(child: tree())
                              ])
                        : showTree
                            ? tree()
                            : conversation())),
          ])),
        );
      });
}