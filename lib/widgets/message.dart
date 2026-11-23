import 'spacing.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import '../models.dart';
import '../services/api.dart';
import 'status.dart';

class MessageBlock extends StatefulWidget {
  final Json message;
  final GatewayApi? api;
  final ValueChanged<String>? onOpenThread;
  const MessageBlock(
      {super.key, required this.message, required this.api, this.onOpenThread});
  @override
  State<MessageBlock> createState() => _MessageBlockState();
}

class _MessageBlockState extends State<MessageBlock> {
  bool expanded = false;
  Json get message => widget.message;
  GatewayApi? get api => widget.api;
  void _openContent(BuildContext context) => Navigator.push(
      context,
      MaterialPageRoute(
          builder: (_) =>
              _ContentPage(api: api!, path: message['contentPath'])));
  @override
  Widget build(BuildContext context) {
    final m = message;
    final user = m['role'] == 'user';
    final text = m['text']?.toString() ?? '';
    final long = text.length > 1000 || '\n'.allMatches(text).length > 18;
    final preview = text.split('\n').take(10).join('\n');
    final visible = long && !expanded
        ? '${preview.substring(0, preview.length.clamp(0, 420)).trimRight()}…'
        : text;
    final colors = Theme.of(context).colorScheme;
    if (m['type'] == 'subagent') {
      final agents = objects(m['agents']);
      final operation = switch (m['operation']) {
        'spawnAgent' || 'started' => '创建子 Agent',
        'sendInput' ||
        'sendMessage' ||
        'followupTask' ||
        'interacted' =>
          '向子 Agent 发送任务',
        'resumeAgent' => '继续子 Agent',
        'listAgents' => '查看子 Agent',
        'wait' => '等待子 Agent',
        'closeAgent' => '结束子 Agent',
        'interruptAgent' || 'interrupted' => '中断子 Agent',
        'completed' => '子 Agent 已完成',
        _ => '子 Agent 活动',
      };
      String state(dynamic value) => switch (value) {
            'running' || 'inProgress' => '运行中',
            'pendingInit' => '准备中',
            'completed' => '已完成',
            'errored' || 'failed' => '失败',
            'interrupted' => '已中断',
            'shutdown' => '已结束',
            _ => '',
          };
      final prompt = m['prompt']?.toString() ?? '';
      return Padding(
        padding: compactInsets(context, const EdgeInsets.only(bottom: 12)),
        child: Card(
          elevation: 0,
          color: colors.onSurface.withValues(alpha: .035),
          child: ExpansionTile(
            leading: const Icon(Icons.account_tree_outlined, size: 19),
            title: Text(operation,
                style:
                    const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
            subtitle: Text([
              if (agents.isNotEmpty) '${agents.length} 个子 Agent',
              if (state(m['status']).isNotEmpty) state(m['status'])
            ].join(' · ')),
            children: [
              if ((m['model']?.toString() ?? '').isNotEmpty)
                Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                    child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                            [
                              m['model'],
                              if ((m['effort']?.toString() ?? '').isNotEmpty)
                                m['effort']
                            ].join(' · '),
                            style: const TextStyle(fontSize: 12)))),
              if (prompt.isNotEmpty)
                Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                    child: Align(
                        alignment: Alignment.centerLeft,
                        child: SelectableText(prompt))),
              for (final agent in agents)
                ListTile(
                    trailing: widget.onOpenThread != null &&
                            (agent['id']?.toString() ?? '').isNotEmpty
                        ? const Icon(Icons.chevron_right)
                        : null,
                    onTap: widget.onOpenThread == null ||
                            (agent['id']?.toString() ?? '').isEmpty
                        ? null
                        : () => widget.onOpenThread!(agent['id'].toString()),
                    dense: true,
                    title: Text((agent['name']?.toString().isNotEmpty ?? false)
                        ? agent['name'].toString()
                        : '子 Agent'),
                    subtitle: Text([
                      if (state(agent['status']).isNotEmpty)
                        state(agent['status']),
                      if ((agent['message']?.toString() ?? '').isNotEmpty)
                        agent['message'].toString()
                    ].join(' · '))),
            ],
          ),
        ),
      );
    }
    // Empty stream placeholders should not leave duplicate labels or blank gaps.
    if (text.isEmpty && m['type'] != 'step' && m['type'] != 'image') {
      return const SizedBox.shrink();
    }
    if (m['type'] == 'image' && api != null) {
      return ScreenshotCard(api: api!, path: m['imagePath'] ?? m['url']);
    }
    if (m['type'] == 'step') {
      return Container(
          margin: compactInsets(context, const EdgeInsets.only(bottom: 12)),
          decoration: BoxDecoration(
              border:
                  Border.all(color: colors.onSurface.withValues(alpha: .09)),
              borderRadius: BorderRadius.circular(12)),
          child: ExpansionTile(
              shape: const Border(),
              collapsedShape: const Border(),
              dense: true,
              leading: Icon(
                  m['status'] == 'completed'
                      ? Icons.check_circle_outline
                      : Icons.code,
                  size: 18,
                  color: colors.onSurface.withValues(alpha: .5)),
              title: Text(m['title'] ?? '执行步骤',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12)),
              children: [
                if (m['contentPath'] != null && api != null)
                  TextButton(
                      onPressed: () => _openContent(context),
                      child: const Text('分段查看完整日志')),
                Padding(
                    padding: compactInsets(
                        context, const EdgeInsets.fromLTRB(16, 0, 16, 16)),
                    child: Align(
                        alignment: Alignment.centerLeft,
                        child: SelectableText(text,
                            style: TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 12,
                                height: compactLineHeight(context, 1.6),
                                color:
                                    colors.onSurface.withValues(alpha: .75)))))
              ]));
    }
    return Padding(
        padding: EdgeInsets.only(bottom: compactGap(context, user ? 20 : 14)),
        child: Column(
            crossAxisAlignment:
                user ? CrossAxisAlignment.end : CrossAxisAlignment.start,
            children: [
              if (!user && m['hideAgentLabel'] != true)
                Padding(
                    padding: compactInsets(
                        context, const EdgeInsets.only(bottom: 8)),
                    child: Row(children: [
                      Icon(Icons.terminal_rounded,
                          size: 18,
                          color: colors.onSurface.withValues(alpha: .8)),
                      const SizedBox(width: 8),
                      Text(m['agentName'] ?? 'Agent',
                          style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: colors.onSurface.withValues(alpha: .6)))
                    ])),
              Container(
                  constraints: const BoxConstraints(maxWidth: 760),
                  padding: user
                      ? compactInsets(
                          context,
                          const EdgeInsets.symmetric(
                              horizontal: 18, vertical: 13))
                      : EdgeInsets.zero,
                  decoration: user
                      ? BoxDecoration(
                          color: colors.onSurface.withValues(alpha: .07),
                          borderRadius: BorderRadius.circular(20))
                      : null,
                  child: user
                      ? SelectableText(visible,
                          style: TextStyle(
                              fontSize: 15,
                              height: compactLineHeight(context, 1.6),
                              color: colors.onSurface))
                      : MarkdownBody(
                          data: visible, selectable: true, softLineBreak: true,
                          styleSheet: MarkdownStyleSheet.fromTheme(
                                  Theme.of(context))
                              .copyWith(
                                  blockSpacing: compactGap(context, 8),
                                  listIndent: compactGap(context, 24),
                                  p: TextStyle(
                                      fontSize: 15,
                                      height: compactLineHeight(context, 1.75),
                                      color: colors.onSurface),
                                  code: TextStyle(
                                      fontFamily: 'monospace',
                                      fontSize: 12,
                                      color: colors.primary,
                                      backgroundColor: colors.onSurface
                                          .withValues(alpha: .06)),
                                  codeblockDecoration: BoxDecoration(
                                      color: colors.onSurface
                                          .withValues(alpha: .04),
                                      borderRadius: BorderRadius.circular(10)),
                                  blockquoteDecoration: BoxDecoration(
                                      border: Border(
                                          left: BorderSide(
                                              color: colors.primary,
                                              width: 2)))),
                          // Markdown must not cause requests to third-party image hosts.
                          imageBuilder: (uri, title, alt) {
                            try {
                              api?.uri(uri.toString());
                              if (api != null) {
                                return ScreenshotCard(
                                    api: api!, path: uri.toString());
                              }
                            } catch (_) {}
                            return const Text('[图片需由当前后端提供]',
                                style: TextStyle(color: Colors.grey));
                          },
                          onTapLink: (label, href, title) {
                            if (href != null) {
                              Clipboard.setData(ClipboardData(text: href));
                              ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(content: Text('链接已复制')));
                            }
                          },
                        )),
              if (m['contentPath'] != null && api != null)
                TextButton(
                    onPressed: () => _openContent(context),
                    child: const Text('分段查看完整内容')),
              if (long)
                TextButton.icon(
                    key: ValueKey('expand-message:${m['id']}'),
                    onPressed: () => setState(() => expanded = !expanded),
                    icon: Icon(expanded ? Icons.unfold_less : Icons.unfold_more,
                        size: 16),
                    label:
                        Text(expanded ? '收起全文' : '展开全文 · ${text.length} 字符')),
              if (!user && text.isNotEmpty)
                Padding(
                    padding:
                        compactInsets(context, const EdgeInsets.only(top: 4)),
                    child: IconButton(
                        tooltip: m['contentPath'] != null ? '复制当前预览' : '复制回复',
                        visualDensity: VisualDensity.compact,
                        icon: const Icon(Icons.copy_outlined, size: 15),
                        onPressed: () =>
                            Clipboard.setData(ClipboardData(text: text)))),
            ]));
  }
}

class ScreenshotCard extends StatefulWidget {
  final GatewayApi api;
  final String path;
  const ScreenshotCard({super.key, required this.api, required this.path});
  @override
  State<ScreenshotCard> createState() => _ScreenshotCardState();
}

class _ScreenshotCardState extends State<ScreenshotCard> {
  late Future<Uint8List> image;
  @override
  void initState() {
    super.initState();
    image = widget.api.bytes(widget.path);
  }

  @override
  void didUpdateWidget(covariant ScreenshotCard old) {
    super.didUpdateWidget(old);
    if (old.path != widget.path || old.api != widget.api) {
      image = widget.api.bytes(widget.path);
    }
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<Uint8List>(
      future: image,
      builder: (context, s) {
        if (s.hasError) {
          return Padding(
              padding: compactInsets(context, const EdgeInsets.all(12)),
              child: TextButton.icon(
                  onPressed: () =>
                      setState(() => image = widget.api.bytes(widget.path)),
                  icon: const Icon(Icons.refresh),
                  label: const Text('截图加载失败，点击重试')));
        }
        if (!s.hasData) {
          return const SizedBox(
              height: 160,
              child: Center(child: CircularProgressIndicator(strokeWidth: 2)));
        }
        return Padding(
            padding: compactInsets(context, const EdgeInsets.only(bottom: 16)),
            child: ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: Material(
                    child: InkWell(
                        onTap: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                                builder: (_) => Scaffold(
                                    backgroundColor: Colors.black,
                                    appBar: AppBar(
                                        backgroundColor: Colors.black,
                                        foregroundColor: Colors.white,
                                        title: const Text('截图预览')),
                                    body: Center(
                                        child: InteractiveViewer(
                                            minScale: .5,
                                            maxScale: 8,
                                            child: Image.memory(s.data!)))))),
                        child: Stack(children: [
                          Image.memory(s.data!,
                              fit: BoxFit.contain,
                              errorBuilder: (_, __, ___) => Padding(
                                  padding: EdgeInsets.all(20),
                                  child: Text('无法解码图片'))),
                          const Positioned(
                              right: 12,
                              bottom: 12,
                              child: Icon(Icons.zoom_in, color: Colors.white))
                        ])))));
      });
}

class ApprovalCard extends StatelessWidget {
  final Json approval;
  final bool enabled, busy;
  final void Function(String) onDecision;
  const ApprovalCard(
      {super.key,
      required this.approval,
      required this.enabled,
      required this.busy,
      required this.onDecision});
  @override
  Widget build(BuildContext context) => Container(
      margin: compactInsets(context, const EdgeInsets.only(bottom: 16)),
      padding: compactInsets(context, const EdgeInsets.all(18)),
      decoration: BoxDecoration(
          color: statusColor('AwaitingApproval').withValues(alpha: .08),
          border: Border.all(
              color: statusColor('AwaitingApproval').withValues(alpha: .35)),
          borderRadius: BorderRadius.circular(16)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(Icons.shield_outlined,
              size: 20, color: statusColor('AwaitingApproval')),
          const SizedBox(width: 10),
          Expanded(
              child: Text(approval['title'] ?? '需要你的批准',
                  style: const TextStyle(fontWeight: FontWeight.w600)))
        ]),
        SizedBox(height: compactGap(context, 12)),
        Text(approval['description'] ?? ''),
        if (approval['details'] != null)
          ExpansionTile(
              tilePadding: EdgeInsets.zero,
              title: const Text('查看操作详情', style: TextStyle(fontSize: 12)),
              children: [
                SelectableText(approval['details'],
                    style:
                        const TextStyle(fontSize: 12, fontFamily: 'monospace'))
              ]),
        SizedBox(height: compactGap(context, 12)),
        Row(children: [
          Expanded(
              child: OutlinedButton(
                  onPressed:
                      enabled && !busy ? () => onDecision('decline') : null,
                  child: const Text('拒绝'))),
          const SizedBox(width: 12),
          Expanded(
              child: FilledButton(
                  onPressed:
                      enabled && !busy ? () => onDecision('accept') : null,
                  child: Text(busy ? '提交中…' : '同意')))
        ]),
      ]));
}

// Read one bounded page at a time; long tool output never floods the conversation.
class _ContentPage extends StatefulWidget {
  final GatewayApi api;
  final String path;
  const _ContentPage({required this.api, required this.path});
  @override
  State<_ContentPage> createState() => _ContentPageState();
}

class _ContentPageState extends State<_ContentPage> {
  String text = '', error = '';
  int offset = 0;
  int? next;
  bool busy = true;
  @override
  void initState() {
    super.initState();
    load(0);
  }

  Future<void> load(int start) async {
    setState(() {
      busy = true;
      error = '';
    });
    try {
      final data = await widget.api.get('${widget.path}&offset=$start');
      if (!mounted) return;
      setState(() {
        text = data['text'] as String;
        offset = start;
        next = data['nextOffset'] as int?;
      });
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('完整内容'), actions: [
        IconButton(
            tooltip: '复制本段',
            onPressed: busy || error.isNotEmpty
                ? null
                : () => Clipboard.setData(ClipboardData(text: text)),
            icon: const Icon(Icons.copy_outlined))
      ]),
      body: SafeArea(
          child: Column(children: [
        if (busy) const LinearProgressIndicator(),
        if (error.isNotEmpty)
          Padding(
              padding: compactInsets(context, const EdgeInsets.all(16)),
              child: Text(error)),
        Expanded(
            child: SingleChildScrollView(
                key: ValueKey(offset),
                padding: compactInsets(context, const EdgeInsets.all(16)),
                child: SelectableText(text,
                    style: const TextStyle(fontSize: 14, height: 1.6)))),
        Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
          TextButton(
              onPressed: busy || offset == 0
                  ? null
                  : () => load((offset - 16000).clamp(0, offset)),
              child: const Text('上一段')),
          Text('第 ${offset ~/ 16000 + 1} 段'),
          TextButton(
              onPressed: busy || next == null ? null : () => load(next!),
              child: const Text('下一段')),
        ])
      ])));
}
