import 'dart:async';
import 'package:flutter/material.dart';
import '../controller.dart';
import '../models.dart';

Future<void> showSideChats(BuildContext context, AppController c) async {
  final parent = c.sideChatParent ?? c.selectedId;
  if (parent == null || c.toolId != 'codex') return;
  await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      builder: (_) => FractionallySizedBox(
          heightFactor: .65,
          child: _SideChatsPanel(controller: c, parent: parent)));
}

class _SideChatsPanel extends StatefulWidget {
  final AppController controller;
  final String parent;
  const _SideChatsPanel({required this.controller, required this.parent});
  @override
  State<_SideChatsPanel> createState() => _SideChatsPanelState();
}

class _SideChatsPanelState extends State<_SideChatsPanel> {
  late final String? selectedAtOpen = widget.controller.selectedId;
  late final String? deviceAtOpen = widget.controller.deviceId;
  Timer? timer;
  Json state = {};
  bool loading = true;
  String? error;
  bool get current =>
      mounted &&
      selectedAtOpen == widget.controller.selectedId &&
      deviceAtOpen == widget.controller.deviceId;

  @override
  void initState() {
    super.initState();
    load();
    timer = Timer.periodic(const Duration(seconds: 10), (_) {
      if (current && !loading) load();
    });
  }

  Future<void> load() async {
    if (!current) return;
    setState(() {
      loading = true;
      error = null;
    });
    final api = widget.controller.api;
    try {
      if (api == null) throw StateError('请先连接电脑。');
      final result = await api
          .get('/api/tasks/${Uri.encodeComponent(widget.parent)}/controls');
      if (current && identical(api, widget.controller.api)) {
        setState(() => state = result);
      }
    } catch (e) {
      if (current) setState(() => error = e.toString());
    } finally {
      if (current) setState(() => loading = false);
    }
  }

  void open(Json side) {
    if (!current) return;
    final raw = side['id']?.toString() ?? '';
    final split = widget.parent.indexOf('~');
    if (split < 1 ||
        !RegExp(r'^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$')
            .hasMatch(raw)) {
      return;
    }
    final target = '${widget.parent.substring(0, split)}~desktop:$raw';
    if (target == widget.parent) return;
    final c = widget.controller;
    c.parentChats[target] = widget.parent;
    c.sideChatParents[target] = widget.parent;
    Navigator.pop(context);
    if (c.selectedId != target) unawaited(c.select(target));
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sides = objects(state['sideChats']);
    return Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 12, 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Expanded(
                child: Text('侧边聊天',
                    style:
                        TextStyle(fontSize: 18, fontWeight: FontWeight.w600))),
            IconButton(
                tooltip: '刷新侧聊',
                onPressed: loading ? null : load,
                icon: const Icon(Icons.refresh_rounded, size: 20)),
            IconButton(
                tooltip: '关闭侧聊列表',
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close_rounded, size: 20)),
          ]),
          Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                  '当前会话：${widget.controller.details[widget.parent]?["title"] ?? "当前对话"}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: Colors.grey))),
          if (loading) const LinearProgressIndicator(minHeight: 2),
          if (error != null)
            Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(error!,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error))),
          Expanded(
              child: sides.isEmpty
                  ? Center(
                      child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Text(
                              loading
                                  ? '正在读取侧聊…'
                                  : error != null
                                      ? '可点击右上角刷新重试。'
                                      : state['capabilities']?['sideChats'] ==
                                              true
                                          ? '暂无可用侧聊\n请先在电脑 Codex 创建侧聊，并保持打开。'
                                          : '这台电脑暂未提供侧聊列表。\n请确认电脑端 Mydex 已更新。',
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                  fontSize: 13,
                                  height: 1.7,
                                  color: Colors.grey))))
                  : ListView.builder(
                      itemCount: sides.length,
                      itemBuilder: (_, i) {
                        final side = sides[i];
                        return ListTile(
                            contentPadding: const EdgeInsets.only(right: 8),
                            title: Text(side['title']?.toString() ?? '侧聊',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 14)),
                            subtitle: Text(
                                side['ephemeral'] == true
                                    ? '临时侧聊 · 桌面关闭后失效'
                                    : '已保存侧聊',
                                style: const TextStyle(fontSize: 11)),
                            trailing: const Icon(Icons.chevron_right, size: 18),
                            onTap: () => open(side));
                      })),
        ]));
  }
}
