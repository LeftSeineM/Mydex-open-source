import 'package:flutter/material.dart';
import '../controller.dart';
import '../models.dart';
import 'message.dart';

/// Pending requests remain by the composer, independent of history scroll.
class PendingInteractions extends StatelessWidget {
  final AppController controller;
  const PendingInteractions({super.key, required this.controller});
  @override
  Widget build(BuildContext context) {
    final c = controller, id = c.selectedId;
    final pending = objects(c.selected?['approvals'])
        .where((a) => a['resolved'] == null)
        .toList();
    if (pending.isEmpty) return const SizedBox.shrink();
    final available = MediaQuery.sizeOf(context).height -
        MediaQuery.viewInsetsOf(context).bottom;
    return Align(
        alignment: Alignment.bottomCenter,
        child: ConstrainedBox(
          constraints: BoxConstraints(
              maxWidth: 840,
              maxHeight: (available * .33).clamp(100, 300).toDouble()),
          child: SingleChildScrollView(
            key: ValueKey('pending:$id'),
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Column(
                mainAxisSize: MainAxisSize.min,
                children: pending.map((a) {
                  final key = ValueKey('$id:request:${a['id']}');
                  final busy = c.approving.contains('$id:${a['id']}');
                  return a['kind'] == 'user-input'
                      ? QuestionCard(
                          key: key,
                          request: a,
                          enabled: c.connected,
                          busy: busy,
                          onSubmit: (answers) =>
                              c.approve(a, 'answer', answers: answers))
                      : ApprovalCard(
                          key: key,
                          approval: a,
                          enabled: c.connected,
                          busy: busy,
                          onDecision: (decision) => c.approve(a, decision));
                }).toList()),
          ),
        ));
  }
}

class QuestionCard extends StatefulWidget {
  final Json request;
  final bool enabled, busy;
  final ValueChanged<Json> onSubmit;
  const QuestionCard(
      {super.key,
      required this.request,
      required this.enabled,
      required this.busy,
      required this.onSubmit});
  @override
  State<QuestionCard> createState() => _QuestionCardState();
}

class _QuestionCardState extends State<QuestionCard> {
  final Map<String, String> answers = {};
  @override
  Widget build(BuildContext context) {
    final questions = objects(widget.request['questions']);
    final active = widget.enabled && !widget.busy;
    final complete = questions.isNotEmpty &&
        questions.every((q) => (answers[q['id']] ?? '').trim().isNotEmpty);
    return Card(
        child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('需要你的回答',
                    style: TextStyle(fontWeight: FontWeight.w600)),
                for (final q in questions) ...[
                  const SizedBox(height: 10),
                  Text(q['question'] ?? ''),
                  for (final option in objects(q['options']))
                    RadioListTile<String>(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        title: Text(option['label'] ?? ''),
                        subtitle: (option['description'] ?? '').isEmpty
                            ? null
                            : Text(option['description']),
                        value: option['label'],
                        groupValue: answers[q['id']],
                        onChanged: active
                            ? (v) => setState(() => answers[q['id']] = v!)
                            : null),
                  if (objects(q['options']).isEmpty || q['isOther'] == true)
                    TextField(
                        key: ValueKey('answer:${q['id']}'),
                        enabled: active,
                        obscureText: q['isSecret'] == true,
                        maxLength: 12000,
                        decoration: InputDecoration(
                            labelText: objects(q['options']).isEmpty
                                ? '填写回答'
                                : '或填写其他回答',
                            counterText: ''),
                        onChanged: (v) => setState(() => answers[q['id']] = v)),
                ],
                const SizedBox(height: 10),
                FilledButton(
                    onPressed: active && complete
                        ? () => widget.onSubmit({
                              for (final q in questions)
                                q['id']: {
                                  'answers': [answers[q['id']]]
                                }
                            })
                        : null,
                    child: Text(widget.busy ? '提交中…' : '提交回答')),
              ],
            )));
  }
}

class PermissionBar extends StatefulWidget {
  final AppController controller;
  const PermissionBar({super.key, required this.controller});
  @override
  State<PermissionBar> createState() => _PermissionBarState();
}

class _PermissionBarState extends State<PermissionBar> {
  bool busy = false;
  static const labels = {
    'ask': '需要时询问我',
    'auto-review': '替我审批',
    'full': '完全访问',
    'read-only': '只读'
  };
  Future<void> choose() async {
    final c = widget.controller, task = c.selectedId;
    final mode = await showModalBottomSheet<String>(
        context: context,
        builder: (ctx) => SafeArea(
                child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Padding(
                    padding: EdgeInsets.all(16), child: Text('权限模式 · 用于后续消息')),
                for (final entry in labels.entries)
                  ListTile(
                      title: Text(entry.value),
                      subtitle: Text({
                        'ask': '限制在工作区，需要额外权限时询问你',
                        'auto-review': '限制在工作区，由桌面自动审查权限申请',
                        'full': '不使用文件沙箱，操作不再逐次询问',
                        'read-only': '只读沙箱，需要额外权限时询问你'
                      }[entry.key]!),
                      onTap: () => Navigator.pop(ctx, entry.key)),
              ],
            )));
    if (!mounted || mode == null || task != c.selectedId) return;
    final confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
              title: Text('切换为“${labels[mode]}”？'),
              content: Text(mode == 'full'
                  ? '后续消息可在电脑上执行不受文件沙箱限制的操作，且不会逐次询问你。'
                  : '仅修改当前会话的后续消息，不自动回答已经弹出的请求。'),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(ctx, false),
                    child: const Text('取消')),
                FilledButton(
                    onPressed: () => Navigator.pop(ctx, true),
                    child: const Text('确认切换'))
              ],
            ));
    if (!mounted || confirmed != true || task != c.selectedId) return;
    setState(() => busy = true);
    final ok = await c
        .control('settings', {'permissionMode': mode, 'confirmed': true});
    if (!mounted) return;
    setState(() => busy = false);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content:
            Text(ok ? '电脑已确认，权限设置用于后续消息' : c.controlsError ?? '切换未确认，请刷新后核对')));
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    if (c.toolId != 'codex' || c.selectedId == null) {
      return const SizedBox.shrink();
    }
    final permissions =
        c.selected?['permissions'] ?? c.controlState['permissions'];
    return Align(
        alignment: Alignment.centerLeft,
        child: TextButton.icon(
          key: const ValueKey('permission-mode'),
          onPressed: !busy && c.connected && c.selected?['canApprove'] == true
              ? choose
              : null,
          icon: const Icon(Icons.shield_outlined, size: 16),
          label: Text(
              busy
                  ? '正在确认权限…'
                  : '权限：${permissions?['label'] ?? '状态未知'} · ${permissions?['reviewer'] ?? '未读取'}（后续消息）',
              style: const TextStyle(fontSize: 12)),
        ));
  }
}
