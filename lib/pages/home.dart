import '../widgets/interactions.dart';
import '../widgets/spacing.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../controller.dart';
import '../models.dart';
import '../widgets/message.dart';
import '../widgets/status.dart';
import 'settings.dart';
import 'projects.dart';
import 'controls.dart';
import 'side_chats.dart';
import '../widgets/new_task_project.dart';
import '../widgets/tool_picker.dart';
import '../widgets/connection_picker.dart';
import 'tracking_board.dart';

class HomePage extends StatefulWidget {
  final AppController controller;
  const HomePage({super.key, required this.controller});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> with WidgetsBindingObserver {
  final scaffold = GlobalKey<ScaffoldState>();
  bool sidebar = true;
  AppController get c => widget.controller;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && c.settings.configured) {
      c.reconnect();
    }
  }

  void settings() => Navigator.push(
      context, MaterialPageRoute(builder: (_) => SettingsPage(controller: c)));
  @override
  Widget build(BuildContext context) => ListenableBuilder(
      listenable: c,
      builder: (context, _) => LayoutBuilder(builder: (context, size) {
            // Unfolded Android foldables often expose only 600–800 logical px.
            final wide = size.maxWidth >= 600;
            final hinge = MediaQuery.of(context)
                .displayFeatures
                .where((feature) =>
                    feature.bounds.height > feature.bounds.width &&
                    feature.bounds.height > size.maxHeight * .5 &&
                    feature.bounds.left >= 200 &&
                    size.maxWidth - feature.bounds.right >= 280)
                .firstOrNull;
            final paneWidth = hinge?.bounds.left ??
                (size.maxWidth * .34).clamp(
                    248.0 +
                        (MediaQuery.textScalerOf(context)
                                    .scale(1)
                                    .clamp(1.0, 2.0) -
                                1) *
                            32,
                    296.0);
            final paneGap =
                hinge != null ? hinge.bounds.width.clamp(1.0, 80.0) : 1.0;
            final current = c.selected;
            return PopScope(
                canPop: !c.composing && c.selectedId == null,
                onPopInvokedWithResult: (didPop, result) {
                  if (!didPop) c.browse();
                },
                child: Scaffold(
                  key: scaffold,
                  drawer: wide || c.isSuperagent
                      ? null
                      : Drawer(
                          width: 310,
                          child: _Sidebar(
                              controller: c,
                              onSettings: settings,
                              onSelect: () =>
                                  scaffold.currentState?.closeDrawer())),
                  appBar: AppBar(
                      toolbarHeight: compactGap(context, 64).clamp(48, 64),
                      leading: IconButton(
                          tooltip: '项目与会话',
                          icon: Icon(
                              !wide && (c.composing || c.selectedId != null)
                                  ? Icons.arrow_back_ios_new_rounded
                                  : Icons.sort_rounded,
                              size: 22),
                          onPressed: () => c.isSuperagent
                              ? c.browse()
                              : !wide && (c.composing || c.selectedId != null)
                                  ? c.browse()
                                  : wide
                                      ? setState(() => sidebar = !sidebar)
                                      : scaffold.currentState?.openDrawer()),
                      title: Row(children: [
                        Expanded(
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                              Row(children: [
                                Expanded(
                                    child: Text(
                                        (c.isSuperagent ? '项目进展台' : null) ??
                                            current?['title'] ??
                                            (c.composing ? '新对话' : 'Mydex'),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                            fontSize: 16,
                                            fontWeight: FontWeight.w600))),
                              ]),
                              SizedBox(height: compactGap(context, 3)),
                              Row(children: [
                                StatusDot(
                                    c.connected
                                        ? const Color(0xff91b9a0)
                                        : const Color(0xffdb9391),
                                    size: 5),
                                const SizedBox(width: 6),
                                Expanded(
                                    child: Text(
                                        c.connected
                                            ? '${_deviceName(c)} · ${c.toolName}'
                                            : c.settings.configured
                                                ? '连接中…'
                                                : '连接你的电脑',
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: TextStyle(
                                            fontSize: 11,
                                            color: Theme.of(context)
                                                .colorScheme
                                                .onSurface
                                                .withValues(alpha: .6))))
                              ])
                            ])),
                        if (current != null && c.toolId == 'codex') ...[
                          const SizedBox(width: 6),
                          TextButton(
                              key: const ValueKey('side-chats-link'),
                              onPressed: () => showSideChats(context, c),
                              style: TextButton.styleFrom(
                                  foregroundColor: const Color(0xff41658a),
                                  backgroundColor: Colors.transparent,
                                  overlayColor: Colors.transparent,
                                  padding:
                                      const EdgeInsets.symmetric(vertical: 2),
                                  minimumSize: Size.zero,
                                  tapTargetSize:
                                      MaterialTapTargetSize.shrinkWrap),
                              child: const Text('侧边聊天',
                                  style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w500),
                                  maxLines: 1,
                                  softWrap: false)),
                        ]
                      ]),
                      actions: [
                        IconButton(
                            tooltip: '新对话',
                            icon: const Icon(Icons.edit_square, size: 20),
                            onPressed: c.toolId == 'codex' ? c.newTask : null),
                        IconButton(
                            tooltip: '连接设置',
                            icon:
                                const Icon(Icons.more_horiz_rounded, size: 22),
                            onPressed: settings),
                        const SizedBox(width: 6)
                      ]),
                  body: SafeArea(
                      top: false,
                      child: Row(children: [
                        if (wide && sidebar && !c.isSuperagent) ...[
                          SizedBox(
                              width: paneWidth,
                              child: _Sidebar(
                                  controller: c,
                                  onSettings: settings,
                                  onSelect: () {})),
                          SizedBox(
                              width: paneGap,
                              child: const VerticalDivider(width: 1))
                        ],
                        Expanded(
                            child: Column(children: [
                          if (c.settings.configured && !c.connected)
                            _Banner(
                                text: '连接已断开，正在重试。已发送任务仍由电脑执行。',
                                icon: Icons.wifi_off,
                                action: c.reconnect),
                          if (c.cached)
                            _Banner(
                                text: '当前显示本地缓存，连接后将同步最新状态。',
                                icon: Icons.history),
                          if (c.error != null)
                            _Banner(
                                text: c.error!,
                                icon: Icons.info_outline,
                                action: c.settings.configured
                                    ? c.refresh
                                    : settings),
                          Expanded(
                              child: !c.initialized
                                  ? const Center(
                                      child: CircularProgressIndicator())
                                  : !c.settings.configured
                                      ? _Welcome(onConnect: settings)
                                      : c.isSuperagent
                                          ? TrackingBoardPage(controller: c)
                                          : c.selectedId == null && !c.composing
                                              ? ProjectsPage(controller: c)
                                              : ConversationPanel(
                                                  key: const ValueKey(
                                                      'active-conversation'),
                                                  controller: c)),
                        ]))
                      ])),
                ));
          }));
}

String _deviceName(AppController c) {
  final id = c.selected?['deviceId'] ?? c.deviceId;
  return c.devices.where((d) => d['id'] == id).firstOrNull?['name'] ?? '选择电脑';
}

class _Sidebar extends StatefulWidget {
  final AppController controller;
  final VoidCallback onSettings, onSelect;
  const _Sidebar(
      {required this.controller,
      required this.onSettings,
      required this.onSelect});
  @override
  State<_Sidebar> createState() => _SidebarState();
}

class _SidebarState extends State<_Sidebar> {
  String query = '';
  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final scheme = Theme.of(context).colorScheme;
    final tasks = c.visibleTasks
        .where((t) => (t['title'] ?? '')
            .toString()
            .toLowerCase()
            .contains(query.toLowerCase()))
        .toList();
    return ColoredBox(
        color: scheme.brightness == Brightness.dark
            ? const Color(0xff121416)
            : const Color(0xfff7f7f8),
        child: SafeArea(
            child: LayoutBuilder(
                builder: (context, constraints) => SingleChildScrollView(
                    child: SizedBox(
                        height: constraints.maxHeight.clamp(
                            680 *
                                MediaQuery.textScalerOf(context)
                                    .scale(1)
                                    .clamp(1.0, 2.0),
                            double.infinity),
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Padding(
                                  padding: compactInsets(context,
                                      const EdgeInsets.fromLTRB(16, 16, 16, 0)),
                                  child: ConnectionPicker(controller: c)),
                              Padding(
                                  padding: EdgeInsets.fromLTRB(20, 16, 20, 12),
                                  child: Row(children: [
                                    Icon(Icons.terminal_rounded, size: 22),
                                    SizedBox(width: 10),
                                    Text('Mydex',
                                        style: TextStyle(
                                            fontSize: 18,
                                            fontWeight: FontWeight.w600))
                                  ])),
                              Padding(
                                  padding: compactInsets(
                                      context,
                                      const EdgeInsets.symmetric(
                                          horizontal: 16)),
                                  child: OutlinedButton.icon(
                                      onPressed: () {
                                        c.newTask();
                                        widget.onSelect();
                                      },
                                      icon: const Icon(Icons.add, size: 18),
                                      label: const Text('新对话'),
                                      style: OutlinedButton.styleFrom(
                                          minimumSize:
                                              const Size(double.infinity, 44),
                                          alignment: Alignment.centerLeft,
                                          side: BorderSide(
                                              color: scheme.onSurface
                                                  .withValues(alpha: .12)),
                                          shape: RoundedRectangleBorder(
                                              borderRadius:
                                                  BorderRadius.circular(12))))),
                              Padding(
                                  padding: compactInsets(
                                      context,
                                      const EdgeInsets.fromLTRB(
                                          16, 14, 16, 10)),
                                  child: Column(children: [
                                    ToolPicker(controller: c),
                                    SizedBox(height: compactGap(context, 12)),
                                    DropdownButtonFormField<String>(
                                        value: c.projectId ?? '',
                                        isExpanded: true,
                                        decoration: const InputDecoration(
                                            contentPadding:
                                                EdgeInsets.symmetric(
                                                    horizontal: 12,
                                                    vertical: 8),
                                            labelText: '项目'),
                                        items: [
                                          const DropdownMenuItem(
                                              value: '',
                                              child: Text('全部项目',
                                                  style:
                                                      TextStyle(fontSize: 12))),
                                          ...c.visibleProjects.map((p) =>
                                              DropdownMenuItem<String>(
                                                  value: p['id'],
                                                  child: Text(p['name'] ?? '项目',
                                                      overflow:
                                                          TextOverflow.ellipsis,
                                                      style: const TextStyle(
                                                          fontSize: 12))))
                                        ],
                                        onChanged: (id) => c.chooseProject(
                                            id == '' ? null : id))
                                  ])),
                              Padding(
                                  padding: compactInsets(context,
                                      const EdgeInsets.fromLTRB(16, 4, 16, 12)),
                                  child: TextField(
                                      onChanged: (v) =>
                                          setState(() => query = v),
                                      style: const TextStyle(fontSize: 12),
                                      decoration: const InputDecoration(
                                          hintText: '搜索会话',
                                          prefixIcon:
                                              Icon(Icons.search, size: 17),
                                          contentPadding: EdgeInsets.symmetric(
                                              horizontal: 12, vertical: 10),
                                          isDense: true))),
                              Expanded(
                                  child: RefreshIndicator(
                                      onRefresh: c.refresh,
                                      child: tasks.isEmpty
                                          ? ListView(children: [
                                              Padding(
                                                  padding: compactInsets(
                                                      context,
                                                      const EdgeInsets.all(24)),
                                                  child: Text(
                                                      query.isEmpty
                                                          ? '这里还没有会话'
                                                          : '没有匹配的会话',
                                                      style: const TextStyle(
                                                          fontSize: 12,
                                                          color: Colors.grey)))
                                            ])
                                          : ListView.builder(
                                              itemCount: tasks.length,
                                              itemBuilder: (context, index) {
                                                final t = tasks[index];
                                                return Padding(
                                                    padding: compactInsets(
                                                        context,
                                                        const EdgeInsets.symmetric(
                                                            horizontal: 10,
                                                            vertical: 2)),
                                                    child: ListTile(
                                                        selected: c.selectedId ==
                                                            t['id'],
                                                        selectedTileColor:
                                                            scheme.onSurface.withValues(
                                                                alpha: .07),
                                                        shape: RoundedRectangleBorder(
                                                            borderRadius:
                                                                BorderRadius.circular(
                                                                    10)),
                                                        title: Text(t['title'] ?? '未命名会话',
                                                            maxLines: 2,
                                                            overflow: TextOverflow
                                                                .ellipsis,
                                                            style: const TextStyle(
                                                                fontSize: 12,
                                                                height: 1.5)),
                                                        subtitle: Padding(
                                                            padding: compactInsets(
                                                                context, const EdgeInsets.only(top: 5)),
                                                            child: TaskStatus(t['status'])),
                                                        onTap: () {
                                                          c.select(t['id']);
                                                          widget.onSelect();
                                                        }));
                                              }))),
                              const Divider(),
                              ListTile(
                                  dense: true,
                                  leading: const Icon(Icons.settings_outlined,
                                      size: 19),
                                  title: const Text('设置',
                                      style: TextStyle(fontSize: 13)),
                                  trailing: Text(
                                      AppController.superagentTest
                                          ? 'Superagent 测试'
                                          : '0.2.22',
                                      style: TextStyle(
                                          fontSize: 10, color: Colors.grey)),
                                  onTap: widget.onSettings),
                            ]))))));
  }
}

class ConversationPanel extends StatefulWidget {
  final AppController controller;
  const ConversationPanel({super.key, required this.controller});
  @override
  State<ConversationPanel> createState() => _ConversationPanelState();
}

class _ConversationPanelState extends State<ConversationPanel> {
  final input = TextEditingController(), scroll = ScrollController();
  String? draftKey, lastId;
  bool following = true;
  int lastLength = 0;
  String? prediction, predictionNotice, predictionStamp;
  bool predicting = false;
  int predictionRequest = 0;
  String get currentStamp =>
      '${c.settings.baseUrl}:${c.selectedId}:${c.selected?["status"]}:${objects(c.selected?["messages"]).map((m) => '${m["id"]}:${m["text"]}').join().hashCode}';
  Future<void> suggest() async {
    final id = c.selectedId, api = c.api;
    if (id == null || api == null || predicting || input.text.isNotEmpty) {
      return;
    }
    final stamp = currentStamp, request = ++predictionRequest;
    setState(() {
      predicting = true;
      prediction = null;
      predictionNotice = null;
    });
    try {
      final result = await api
          .post('/api/tasks/${Uri.encodeComponent(id)}/prediction', {});
      if (!mounted ||
          request != predictionRequest ||
          stamp != currentStamp ||
          input.text.isNotEmpty) {
        return;
      }
      setState(() {
        predictionStamp = stamp;
        prediction =
            result['available'] == true ? result['text'] as String? : null;
        predictionNotice = result['reason'] as String?;
      });
    } catch (_) {
      if (mounted && request == predictionRequest) {
        setState(() => predictionNotice = '暂时无法获取建议，请直接输入');
      }
    } finally {
      if (mounted && request == predictionRequest) {
        setState(() => predicting = false);
      }
    }
  }

  void acceptPrediction() {
    if (prediction == null ||
        input.text.isNotEmpty ||
        !input.value.composing.isCollapsed ||
        predictionStamp != currentStamp) {
      return;
    }
    setState(() {
      input.text = prediction!;
      input.selection = TextSelection.collapsed(offset: input.text.length);
      c.drafts[draftKey!] = input.text;
      prediction = null;
      predictionNotice = null;
    });
  }

  AppController get c => widget.controller;
  @override
  void initState() {
    super.initState();
    scroll.addListener(() {
      final next = scroll.offset < 80;
      if (next != following) setState(() => following = next);
    });
  }

  @override
  void dispose() {
    input.dispose();
    scroll.dispose();
    super.dispose();
  }

  void bottom() {
    if (scroll.hasClients) {
      // Reversed lazy timeline: offset zero is always the latest message.
      // Jump directly even for years of history; never animate through it all.
      scroll.jumpTo(0);
    }
  }

  Future<void> send() async {
    final key = draftKey;
    final text = input.text;
    if (await c.send(text)) {
      if (mounted && key == draftKey) input.clear();
      if (mounted) {
        following = true;
        WidgetsBinding.instance.addPostFrameCallback((_) => bottom());
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = c.selected;
    final id = c.selectedId;
    final key = id ?? 'new:${c.deviceId}:${c.toolId}:${c.projectId}';
    if (draftKey != key) {
      predictionRequest++;
      predicting = false;
      prediction = null;
      predictionNotice = null;
      draftKey = key;
      input.text = c.drafts[key] ?? '';
      following = true;
    }
    final messages = [
      ...objects(t?['olderMessages']),
      ...objects(t?['messages'])
    ];
    final unique = <String, Json>{};
    for (final m in messages) {
      unique[m['id']?.toString() ?? unique.length.toString()] = m;
    }
    final rows = unique.values.toList();
    final length =
        rows.fold<int>(0, (n, m) => n + (m['text']?.toString().length ?? 0)) +
            rows.length;
    if (lastLength != length || lastId != id) {
      lastLength = length;
      lastId = id;
      if (following) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) bottom();
        });
      }
    }
    if (predictionStamp != currentStamp) prediction = null;
    final colors = Theme.of(context).colorScheme;
    return Column(children: [
      if (c.parentChat != null)
        Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              icon: const Icon(Icons.arrow_back, size: 18),
              label: const Text('返回主会话'),
              onPressed: () => c.select(c.parentChat!),
            )),
      Expanded(
          child: Stack(children: [
        if (id == null)
          Center(
              child: SingleChildScrollView(
                  child: Padding(
                      padding: compactInsets(context, const EdgeInsets.all(28)),
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        Icon(Icons.terminal_rounded,
                            size: 40,
                            color: colors.onSurface.withValues(alpha: .8)),
                        SizedBox(height: compactGap(context, 24)),
                        const Text('今天想完成什么？',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                                fontSize: 27,
                                fontWeight: FontWeight.w500,
                                height: 1.35)),
                        SizedBox(height: compactGap(context, 10)),
                        Text('在 ${_deviceName(c)} 上开始，随时用手机继续。',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                                fontSize: 13,
                                color:
                                    colors.onSurface.withValues(alpha: .45))),
                        SizedBox(height: compactGap(context, 32)),
                        Wrap(
                            spacing: 10,
                            runSpacing: 10,
                            alignment: WrapAlignment.center,
                            children: ['解释这个项目', '检查最近的修改', '帮我梳理下一步']
                                .map((text) => ActionChip(
                                    label: Text(text,
                                        style: const TextStyle(fontSize: 12)),
                                    onPressed: () {
                                      input.text = text;
                                      c.drafts[key] = text;
                                    }))
                                .toList())
                      ])))),
        if (id != null)
          Align(
              alignment: Alignment.topCenter,
              child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 840),
                  child: _LatestTimeline(
                      key: ValueKey('timeline:$id'),
                      controller: scroll,
                      padding: EdgeInsets.fromLTRB(
                          MediaQuery.sizeOf(context).width < 420 ? 18 : 28,
                          compactGap(context, 22),
                          MediaQuery.sizeOf(context).width < 420 ? 18 : 28,
                          compactGap(context, 32)),
                      children: <Widget>[
                        if (t?['hasMore'] == true)
                          Center(
                              child: TextButton.icon(
                                  onPressed: c.loading ? null : c.older,
                                  icon: const Icon(Icons.history, size: 16),
                                  label: const Text('加载更早的对话'))),
                        if (rows.isEmpty && !c.loading)
                          Padding(
                              padding: compactInsets(context,
                                  const EdgeInsets.symmetric(vertical: 60)),
                              child: Text(
                                  t == null
                                      ? '暂时无法读取会话，连接恢复后重试。'
                                      : '会话已建立，等待电脑回复。',
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                      color: Colors.grey, fontSize: 13))),
                        ..._messageTimeline(context, rows, c),
                        if (t?['error'] != null)
                          _Banner(text: t!['error'], icon: Icons.error_outline),
                        if (t?['status'] == 'Running')
                          Row(children: [
                            SizedBox(
                                width: 12,
                                height: 12,
                                child: CircularProgressIndicator(
                                    strokeWidth: 1.5, color: colors.primary)),
                            const SizedBox(width: 10),
                            Text('${c.toolName} 正在处理',
                                style: TextStyle(
                                    fontSize: 12,
                                    color:
                                        colors.onSurface.withValues(alpha: .5)))
                          ]),
                      ]))),
        if (c.loading)
          const Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: LinearProgressIndicator(minHeight: 2)),
        if (!following && id != null)
          Positioned(
              bottom: 12,
              left: 0,
              right: 0,
              child: Center(
                  child: FloatingActionButton.small(
                      heroTag: 'latest',
                      tooltip: '回到最新消息',
                      onPressed: () {
                        following = true;
                        bottom();
                      },
                      child: const Icon(Icons.arrow_downward, size: 18)))),
      ])),
      PendingInteractions(controller: c),
      Align(
          alignment: Alignment.bottomCenter,
          child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 840),
              child: Padding(
                  padding: compactInsets(
                      context, const EdgeInsets.fromLTRB(16, 8, 16, 12)),
                  child: Column(children: [
                    if (id == null && c.toolId == 'codex')
                      NewTaskProjectPicker(controller: c),
                    PermissionBar(controller: c),
                    if (t?['status'] == 'AwaitingApproval' &&
                        t?['canApprove'] == false)
                      const Text('当前请求需要在电脑处理', style: TextStyle(fontSize: 12)),
                    if (predictionNotice != null)
                      Padding(
                          padding: compactInsets(
                              context, const EdgeInsets.only(bottom: 6)),
                          child: Text(predictionNotice!,
                              style: const TextStyle(
                                  fontSize: 12, color: Colors.grey))),
                    if (!c.toolCanSend)
                      Padding(
                          padding: compactInsets(
                              context, const EdgeInsets.only(bottom: 8)),
                          child: Text(
                              c.selectedId == null
                                  ? '请先打开一条已有会话；当前工具暂不支持手机新建会话'
                                  : '此条记录当前只读，请确认原电脑应用和会话接口正在运行',
                              style:
                                  TextStyle(fontSize: 12, color: Colors.grey))),
                    if (!c.deviceOnline && c.devices.isNotEmpty)
                      Padding(
                          padding: EdgeInsets.only(bottom: 8),
                          child: Text('当前电脑或工具未连接，草稿会保留',
                              style:
                                  TextStyle(fontSize: 11, color: Colors.grey))),
                    Container(
                        decoration: BoxDecoration(
                            color: colors.brightness == Brightness.dark
                                ? const Color(0xff25282c)
                                : const Color(0xfff7f7f8),
                            border: Border.all(
                                color: colors.onSurface.withValues(alpha: .08)),
                            borderRadius: BorderRadius.circular(24)),
                        child: Column(children: [
                          Focus(
                              onKeyEvent: (_, event) {
                                if (event is KeyDownEvent &&
                                    event.logicalKey ==
                                        LogicalKeyboardKey.tab &&
                                    !HardwareKeyboard.instance.isShiftPressed &&
                                    !HardwareKeyboard
                                        .instance.isControlPressed &&
                                    !HardwareKeyboard.instance.isAltPressed &&
                                    !HardwareKeyboard.instance.isMetaPressed &&
                                    prediction != null &&
                                    input.text.isEmpty &&
                                    input.value.composing.isCollapsed) {
                                  acceptPrediction();
                                  return KeyEventResult.handled;
                                }
                                return KeyEventResult.ignored;
                              },
                              child: TextField(
                                  controller: input,
                                  minLines: 1,
                                  maxLines: 6,
                                  enabled: !c.sending && c.toolCanSend,
                                  onChanged: (s) {
                                    c.drafts[key] = s;
                                    setState(() {
                                      prediction = null;
                                      predictionNotice = null;
                                    });
                                  },
                                  keyboardType: TextInputType.multiline,
                                  textInputAction: TextInputAction.newline,
                                  textAlignVertical: TextAlignVertical.top,
                                  style: TextStyle(
                                      fontSize: 15,
                                      height: compactLineHeight(context, 1.5)),
                                  decoration: InputDecoration(
                                      isDense: compactFactor(context) < 1,
                                      constraints: compactFactor(context) < 1
                                          ? const BoxConstraints(minHeight: 40)
                                          : null,
                                      hintText: prediction ??
                                          (id == null ? '给电脑一个任务…' : '继续这个对话…'),
                                      hintMaxLines: 4,
                                      filled: false,
                                      border: InputBorder.none,
                                      enabledBorder: InputBorder.none,
                                      focusedBorder: InputBorder.none,
                                      contentPadding: compactInsets(
                                          context,
                                          const EdgeInsets.fromLTRB(
                                              16, 12, 16, 6))))),
                          Padding(
                              padding: compactInsets(context,
                                  const EdgeInsets.fromLTRB(16, 0, 10, 10)),
                              child: Row(children: [
                                Expanded(
                                    child: c.toolId == 'codex'
                                        ? Align(
                                            alignment: Alignment.centerLeft,
                                            child: TextButton.icon(
                                                onPressed: () =>
                                                    showControls(context, c),
                                                icon: const Icon(
                                                    Icons.tune_rounded,
                                                    size: 16),
                                                label: const Text('模型与模式',
                                                    style: TextStyle(
                                                        fontSize: 12)),
                                                style: TextButton.styleFrom(
                                                    padding: compactInsets(
                                                        context,
                                                        const EdgeInsets.symmetric(
                                                            horizontal: 6)),
                                                    minimumSize: const Size(44, 36))))
                                        : Text(c.toolName, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12))),
                                if (c.settings.predictions &&
                                    id != null &&
                                    t?['status'] == 'Completed' &&
                                    c.toolCanSend &&
                                    input.text.isEmpty)
                                  TextButton(
                                      onPressed: predicting
                                          ? null
                                          : prediction != null
                                              ? acceptPrediction
                                              : suggest,
                                      child: Text(
                                          predicting
                                              ? '思考中…'
                                              : prediction != null
                                                  ? '采用'
                                                  : '建议下一步',
                                          style:
                                              const TextStyle(fontSize: 12))),
                                const SizedBox(width: 8),
                                if (t?['canInterrupt'] == true)
                                  IconButton(
                                      tooltip: '停止当前会话',
                                      onPressed: c.connected &&
                                              c.deviceOnline &&
                                              !c.stopping.contains(id)
                                          ? c.interrupt
                                          : null,
                                      icon: const Icon(
                                          Icons.stop_circle_outlined)),
                                IconButton.filled(
                                    tooltip: '发送',
                                    onPressed: c.connected &&
                                            c.deviceOnline &&
                                            c.toolCanSend &&
                                            !c.sending
                                        ? send
                                        : null,
                                    style: IconButton.styleFrom(
                                        backgroundColor: colors.onSurface,
                                        foregroundColor: colors.surface,
                                        minimumSize: const Size(44, 44)),
                                    icon: c.sending
                                        ? SizedBox(
                                            width: 17,
                                            height: 17,
                                            child: CircularProgressIndicator(
                                                strokeWidth: 2,
                                                color: colors.surface))
                                        : const Icon(Icons.arrow_upward,
                                            size: 20))
                              ])),
                        ])),
                  ])))),
    ]);
  }
}

// Build only the visible Markdown blocks. Offset zero always anchors the newest.
class _LatestTimeline extends StatelessWidget {
  final ScrollController controller;
  final EdgeInsets padding;
  final List<Widget> children;
  const _LatestTimeline(
      {super.key,
      required this.controller,
      required this.padding,
      required this.children});
  @override
  Widget build(BuildContext context) => ListView.builder(
      controller: controller,
      reverse: true,
      padding: padding,
      itemCount: children.length,
      itemBuilder: (_, i) => children[children.length - 1 - i]);
}

List<Widget> _messageTimeline(
    BuildContext context, List<Json> rows, AppController c) {
  final groups = <String, List<Json>>{};
  final keys = <String>[];
  int turn = 0;
  for (final m in rows) {
    if (m['role'] == 'user') turn++;
    final key = m['turnId']?.toString() ?? 'turn-$turn';
    keys.add(key);
    if (m['type'] == 'step') (groups[key] ??= []).add(m);
  }
  final emitted = <String>{};
  final widgets = <Widget>[];
  final labeledTurns = <String>{};
  for (var i = 0; i < rows.length; i++) {
    final m = rows[i];
    final key = keys[i];
    if (m['type'] == 'step') {
      if (!emitted.add(key)) continue;
      final steps = groups[key]!;
      widgets.add(Padding(
          key: ValueKey('activity:${c.selectedId}:$key'),
          padding: compactInsets(context, const EdgeInsets.only(bottom: 8)),
          child: ExpansionTile(
              key: ValueKey('activity-panel:${c.selectedId}:$key'),
              minTileHeight: compactGap(context, 56).clamp(48, 56),
              tilePadding: EdgeInsets.zero,
              shape: const Border(),
              collapsedShape: const Border(),
              leading: const Icon(Icons.history_toggle_off_rounded, size: 18),
              title: Text(
                  '运行过程${steps.first['durationMs'] is num ? ' · ${((steps.first['durationMs'] as num) / 1000).round()} 秒' : ''} · ${steps.length} 个步骤',
                  style: const TextStyle(fontSize: 13)),
              children: steps
                  .map((s) => MessageBlock(
                      key: ValueKey(s['id']),
                      message: {...s, 'agentName': c.toolName},
                      api: c.api))
                  .toList())));
    } else {
      widgets.add(MessageBlock(
          key: ValueKey(m['id']),
          onOpenThread: (raw) {
            final parent = c.selectedId;
            final separator = parent?.indexOf('~') ?? -1;
            if (parent == null ||
                separator < 1 ||
                !RegExp(r'^[a-zA-Z0-9-]{1,100}$').hasMatch(raw)) {
              return;
            }
            final child = '${parent.substring(0, separator)}~desktop:$raw';
            c.parentChats[child] = parent;
            c.select(child);
          },
          message: {
            ...m,
            'agentName': c.toolName,
            'hideAgentLabel': m['role'] != 'user' && !labeledTurns.add(key)
          },
          api: c.api));
    }
  }
  return widgets;
}

class _Welcome extends StatelessWidget {
  final VoidCallback onConnect;
  const _Welcome({required this.onConnect});
  @override
  Widget build(BuildContext context) => Center(
      child: Padding(
          padding: compactInsets(context, const EdgeInsets.all(32)),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.terminal_rounded, size: 52),
            SizedBox(height: compactGap(context, 30)),
            const Text('工作不止于桌面',
                textAlign: TextAlign.center,
                style: TextStyle(
                    fontSize: 28, fontWeight: FontWeight.w500, height: 1.35)),
            SizedBox(height: compactGap(context, 14)),
            const Text('你的项目、对话与进展，\n现在都可以随身查看。',
                textAlign: TextAlign.center,
                style:
                    TextStyle(fontSize: 15, color: Colors.grey, height: 1.8)),
            SizedBox(height: compactGap(context, 36)),
            FilledButton.icon(
                onPressed: onConnect,
                icon: const Icon(Icons.link),
                label: const Text('连接我的电脑')),
            SizedBox(height: compactGap(context, 20)),
            const Text('无需第三方账号 · 无需 Google Play',
                style: TextStyle(fontSize: 11, color: Colors.grey))
          ])));
}

class _Banner extends StatelessWidget {
  final String text;
  final IconData icon;
  final VoidCallback? action;
  const _Banner({required this.text, required this.icon, this.action});
  @override
  Widget build(BuildContext context) => Container(
      width: double.infinity,
      color: Theme.of(context).colorScheme.primary.withValues(alpha: .06),
      padding: compactInsets(
          context, const EdgeInsets.symmetric(horizontal: 16, vertical: 9)),
      child: Row(children: [
        Icon(icon, size: 16, color: Colors.grey),
        const SizedBox(width: 10),
        Expanded(
            child:
                Text(text, style: const TextStyle(fontSize: 11, height: 1.5))),
        if (action != null)
          IconButton(
              tooltip: '重试',
              onPressed: action,
              icon: const Icon(Icons.refresh, size: 17))
      ]));
}
