import 'package:flutter/material.dart';
import '../models.dart';

/// Presentation of persisted original-session identities, never invented jobs.
class RouterTree extends StatelessWidget {
  final Json job;
  final List<Json> tasks, devices;
  final Set<String> selected;
  final ValueChanged<String> onSelect;
  final ValueChanged<Json> onNode;
  final VoidCallback onAsk, onRouter;
  const RouterTree(
      {super.key,
      required this.job,
      required this.tasks,
      required this.devices,
      required this.selected,
      required this.onSelect,
      required this.onNode,
      required this.onAsk,
      required this.onRouter});

  static List<Json> branches(Json job, List<Json> tasks) {
    final bySession = <String, Json>{};
    for (final key in job['scope'] as List? ?? []) {
      final registered = (job['nodes'] as List? ?? [])
          .whereType<Map>()
          .where((n) => n['key'] == key)
          .firstOrNull;
      bySession[key.toString()] = {
        'session': key.toString(),
        'state': 'observing',
        'node': registered == null
            ? {'title': '已关联原会话', 'device': key.toString().split('~').first}
            : Map<String, dynamic>.from(registered)
      };
    }
    for (final task in tasks.where((t) => t['job'] == job['id'])) {
      if (task['state'] == 'superseded') continue;
      final key = task['session']?.toString();
      if (key != null) bySession[key] = task;
    }
    return [
      ...bySession.values,
      ...(job['resources'] as List? ?? [])
          .whereType<Map>()
          .map((r) => <String, dynamic>{
                'kind': 'resource',
                'resourceId': r['id'],
                'resource': Map<String, dynamic>.from(r),
                'node': {
                  'title': r['name'],
                  'device': r['id'],
                  'hostName': r['name']
                },
              })
    ];
  }

  static String stateLabel(dynamic state) =>
      const {
        'observing': '仅观察',
        'queued': '排队中',
        'running': '运行中',
        'awaiting_observation': '等待观察',
        'waiting_approval': '待审批',
        'waiting_question': '待回答',
        'human_intervention': '待人工核对',
        'delivery_unknown': '送达待确认',
        'completion_claim': '待验收',
        'accepted': '已验收',
        'failed': '失败',
        'cancel_requested': '取消待确认',
        'cancelled': '已取消',
        'completed': '轮次已结束',
        'succeeded': '轮次已结束',
      }[state] ??
      '状态待核对';

  static bool needsAttention(Json task) => const {
        'waiting_approval',
        'waiting_question',
        'human_intervention',
        'delivery_unknown',
        'completion_claim',
        'failed',
        'cancel_requested'
      }.contains(task['state']);

  static Color stateColor(Json task) {
    if (task['state'] == 'accepted') return const Color(0xff28765a);
    if (needsAttention(task)) return const Color(0xff946013);
    if (task['state'] == 'running') return const Color(0xff3d6591);
    return const Color(0xff65717e);
  }

  @override
  Widget build(BuildContext context) {
    final nodes = branches(job, tasks);
    final scoped = tasks
        .where((t) => t['job'] == job['id'] && t['state'] != 'superseded')
        .toList();
    final accepted = scoped.where((t) => t['state'] == 'accepted').length;
    return Padding(
        padding: const EdgeInsets.all(16),
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            const Expanded(
                child: Text('执行网络',
                    style:
                        TextStyle(fontSize: 19, fontWeight: FontWeight.w600))),
            Text('${nodes.length} 个节点',
                style: Theme.of(context).textTheme.bodySmall)
          ]),
          const SizedBox(height: 4),
          const Text('点节点看原始记录，勾选后带着范围问 Router',
              style: TextStyle(fontSize: 12, color: Color(0xff71808d))),
          const SizedBox(height: 16),
          if (scoped.isNotEmpty)
            Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Wrap(spacing: 12, runSpacing: 8, children: [
                  _metric('$accepted / ${scoped.length}', '任务已验收'),
                  _metric(
                      '${scoped.where((t) => t['state'] == 'running').length}',
                      '执行中'),
                  _metric('${scoped.where(needsAttention).length}', '需留意'),
                ])),
          const Text('你 · 目标、纠偏与验收',
              style: TextStyle(fontSize: 12, color: Color(0xff71808d))),
          const SizedBox(height: 10),
          Material(
              color: Theme.of(context).colorScheme.surface,
              borderRadius: BorderRadius.circular(16),
              shape: null,
              child: InkWell(
                  onTap: onRouter,
                  borderRadius: BorderRadius.circular(16),
                  child: Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                          border: Border.all(color: const Color(0xffc6d8e5)),
                          borderRadius: BorderRadius.circular(16)),
                      child: Row(children: [
                        const Icon(Icons.hub_outlined,
                            color: Color(0xff3d5f7c)),
                        const SizedBox(width: 12),
                        Expanded(
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                              Text('Router · ${job['name'] ?? '项目协调'}',
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w600)),
                              const Text('讨论目标 · 梳理分工 · 协调执行',
                                  style: TextStyle(
                                      fontSize: 12, color: Color(0xff71808d))),
                            ])),
                        const Icon(Icons.chevron_right, size: 18)
                      ])))),
          Container(
              margin: const EdgeInsets.only(left: 16),
              padding: const EdgeInsets.fromLTRB(14, 18, 0, 0),
              decoration: const BoxDecoration(
                  border: Border(left: BorderSide(color: Color(0xffcbd7e0)))),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (nodes.isEmpty)
                      const Padding(
                          padding: EdgeInsets.all(20),
                          child: Text('还没有关联 Worker 原会话。')),
                    for (final n in nodes)
                      Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: _card(context, n)),
                  ])),
          Row(children: [
            Expanded(
                child: Text('已选 ${selected.length} 个 Worker',
                    style: const TextStyle(fontSize: 12))),
            FilledButton.icon(
                onPressed: selected.isEmpty ? null : onAsk,
                icon: const Icon(Icons.north_east, size: 17),
                label: const Text('问 Router'))
          ]),
        ]));
  }

  Widget _metric(String value, String label) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
          color: const Color(0xffeef2f5),
          borderRadius: BorderRadius.circular(10)),
      child: Text('$value  $label', style: const TextStyle(fontSize: 12)));

  Widget _card(BuildContext context, Json task) {
    final resource = task['kind'] == 'resource',
        node = task['node'] as Map? ?? {};
    final key = task['session']?.toString();
    final checked = key != null && selected.contains(key);
    final updates =
        (task['observed']?['recentUpdates'] as List? ?? []).whereType<Map>();
    final summary = resource
        ? '按需查询服务器和作业，不需要安装 Agent'
        : updates.lastOrNull?['excerpt']?.toString() ??
            task['package']?['goal']?.toString() ??
            '已关联原会话，点开查看最新记录。';
    final color = stateColor(task);
    return Material(
        color: checked
            ? const Color(0xffeef4f8)
            : Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
            onTap: () => onNode(task),
            borderRadius: BorderRadius.circular(14),
            child: Container(
                padding: const EdgeInsets.fromLTRB(14, 8, 14, 14),
                decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                        color: checked
                            ? const Color(0xff698da8)
                            : const Color(0xffdfe4e8))),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                                color: color.withValues(alpha: .09),
                                borderRadius: BorderRadius.circular(7)),
                            child: Text(
                                resource ? '资源节点' : stateLabel(task['state']),
                                style: TextStyle(fontSize: 12, color: color))),
                        const Spacer(),
                        if (!resource)
                          Checkbox(
                              value: checked,
                              onChanged: (_) => onSelect(key!),
                              semanticLabel: '勾选 ${node['title'] ?? '原会话'}')
                        else
                          const SizedBox(
                              height: 44,
                              child: Icon(Icons.dns_outlined, size: 20))
                      ]),
                      Text(
                          '${node['title'] ?? task['package']?['goal'] ?? '已关联原会话'}',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 15,
                              height: 1.4,
                              fontWeight: FontWeight.w600)),
                      const SizedBox(height: 8),
                      Text(summary,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 13,
                              height: 1.5,
                              color: Color(0xff65717e))),
                      const SizedBox(height: 10),
                      Row(children: [
                        Expanded(
                            child: Text(
                                resource
                                    ? '点此查询'
                                    : '${node['toolId'] ?? '原对话'}${node['model'] == null ? '' : ' · ${node['model']}'}',
                                style: const TextStyle(
                                    fontSize: 12, color: Color(0xff71808d)))),
                        if (needsAttention(task))
                          const Text('需要你处理',
                              style: TextStyle(
                                  fontSize: 11, color: Color(0xff946013))),
                        const Icon(Icons.chevron_right,
                            size: 16, color: Color(0xff71808d))
                      ]),
                    ]))));
  }
}