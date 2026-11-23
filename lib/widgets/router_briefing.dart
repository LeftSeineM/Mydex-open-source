import 'package:flutter/material.dart';
import '../models.dart';
import 'router_tree.dart';

/// A projection of persisted facts. Opening this view never marks the Router's
/// briefing as read, assigns inferred roles, or dispatches work.
class RouterBriefing extends StatelessWidget {
  final Json job;
  final List<Json> tasks;
  final ValueChanged<Json> onNode;
  final VoidCallback onOrganize, onSummarize, onAttention;
  const RouterBriefing(
      {super.key,
      required this.job,
      required this.tasks,
      required this.onNode,
      required this.onOrganize,
      required this.onSummarize,
      required this.onAttention});

  @override
  Widget build(BuildContext context) {
    final nodes = RouterTree.branches(job, tasks);
    final branches = tasks
        .where((t) => t['job'] == job['id'] && t['state'] != 'superseded')
        .toList();
    final attention = branches.where(RouterTree.needsAttention).length;
    final reading =
        job['routerReading'] is Map ? job['routerReading'] as Map : {};
    final updates = <Json>[];
    for (final task in branches) {
      final observed = task['observed'];
      if (observed is! Map) continue;
      for (final update
          in (observed['recentUpdates'] as List? ?? []).whereType<Map>()) {
        updates.add({...Map<String, dynamic>.from(update), 'task': task});
      }
    }
    updates.sort(
        (a, b) => ((b['at'] as num?) ?? 0).compareTo((a['at'] as num?) ?? 0));
    String time(dynamic at) => at is num
        ? DateTime.fromMillisecondsSinceEpoch(at.toInt())
            .toLocal()
            .toString()
            .substring(0, 16)
        : '更新时间待确认';
    return ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
        children: [
          Text('项目简报', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 6),
          Text('${job['name']}',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          Text(reading['unread'] is num && reading['unread'] > 0
              ? '${reading['unread']} 条项目事件尚未由 Router 确认已读'
              : reading['lastReadAt'] != null
                  ? 'Router 已读至 ${time(reading['lastReadAt'])}'
                  : 'Router 尚未确认已读'),
          const Text('打开简报不会替 Router 标记已读；状态来自电脑保存的观察记录。',
              style: TextStyle(fontSize: 12)),
          const SizedBox(height: 12),
          Wrap(spacing: 8, runSpacing: 8, children: [
            FilledButton.icon(
                onPressed: onOrganize,
                icon: const Icon(Icons.groups_outlined),
                label: const Text('梳理分工')),
            OutlinedButton.icon(
                onPressed: onSummarize,
                icon: const Icon(Icons.summarize_outlined),
                label: const Text('汇总下一步')),
            OutlinedButton(
                onPressed: onAttention, child: Text('待处理 $attention')),
          ]),
          const Text('以上操作先生成 Router 草稿，确认发送后才开始整理。',
              style: TextStyle(fontSize: 12)),
          const Divider(height: 28),
          Text('分工与节点', style: Theme.of(context).textTheme.titleMedium),
          for (final node in nodes)
            Card(
                child: ListTile(
                    leading: Icon(node['kind'] == 'resource'
                        ? Icons.dns_outlined
                        : Icons.forum_outlined),
                    title: Text('${node['node']?['title'] ?? '已关联原会话'}'),
                    subtitle: Text(node['kind'] == 'resource'
                        ? '服务器资源 · 点击查询状态'
                        : '${RouterTree.stateLabel(node['state'])}\n${node['package']?['goal'] ?? '尚未登记分工，请让 Router 读取原会话后提出建议'}'),
                    isThreeLine: node['kind'] != 'resource',
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => onNode(node))),
          const Divider(height: 28),
          Text('最近进展 · 原文摘录', style: Theme.of(context).textTheme.titleMedium),
          if (updates.isEmpty)
            const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Text('暂无已登记的进展摘录。已关联会话仍可点开查看；让 Router 汇总后，在原对话查看完整结论。')),
          for (final update in updates.take(8))
            Card(
                child: ListTile(
                    title: Text('${update['excerpt'] ?? ''}',
                        maxLines: 4, overflow: TextOverflow.ellipsis),
                    subtitle: Text(
                        '${time(update['at'])} · 来源 ${update['ref'] ?? '待确认'}'),
                    trailing: const Icon(Icons.open_in_new, size: 18),
                    onTap: () =>
                        onNode(Map<String, dynamic>.from(update['task'])))),
          const SizedBox(height: 12),
          const Text('完成声明需验收；分工建议、授权与执行分别确认。', style: TextStyle(fontSize: 12)),
        ]);
  }
}