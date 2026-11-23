import 'package:flutter/material.dart';
import '../controller.dart';
import '../models.dart';

Future<void> showUsage(BuildContext context, AppController c) =>
    showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        showDragHandle: true,
        builder: (_) => FractionallySizedBox(
            heightFactor: .65, child: UsagePanel(controller: c)));

class UsagePanel extends StatefulWidget {
  final AppController controller;
  const UsagePanel({super.key, required this.controller});
  @override
  State<UsagePanel> createState() => _UsagePanelState();
}

class _UsagePanelState extends State<UsagePanel> {
  late String tool = widget.controller.toolId;
  Json? data;
  bool loading = false;
  int revision = 0;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    final c = widget.controller, api = widget.controller.api;
    final device = c.deviceId, request = ++revision;
    setState(() {
      loading = true;
      data = null;
    });
    try {
      final result = await api!.get(
          '/api/devices/${Uri.encodeComponent(device!)}/usage?tool=${Uri.encodeComponent(tool)}');
      if (mounted &&
          request == revision &&
          device == c.deviceId &&
          identical(api, c.api)) {
        setState(() => data = result);
      }
    } catch (_) {
      if (mounted && request == revision) {
        setState(() => data = {'message': '暂时无法查询，请确认连接并更新电脑端 Mydex 后重试'});
      }
    } finally {
      if (mounted && request == revision) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          const Expanded(
              child: Text('额度与用量',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600))),
          IconButton(
              tooltip: '刷新额度',
              onPressed: loading ? null : load,
              icon: const Icon(Icons.refresh))
        ]),
        DropdownButtonFormField<String>(
            value: tool,
            isExpanded: true,
            items: {
              for (final t in widget.controller.deviceTools)
                t['id'].toString(): t['name'].toString(),
              'codex': 'Codex'
            }
                .entries
                .map((t) => DropdownMenuItem(
                    value: t.key,
                    child: Text(t.value, overflow: TextOverflow.ellipsis)))
                .toList(),
            onChanged: (id) {
              if (id != null) {
                tool = id;
                load();
              }
            }),
        const SizedBox(height: 12),
        const Text('读取所选电脑的账号。订阅百分比不等于 API 余额。',
            style: TextStyle(fontSize: 12, color: Colors.grey)),
        if (loading) const LinearProgressIndicator(),
        Expanded(
            child: ListView(children: [
          if (data?['message'] is String)
            Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Text(data!['message'])),
          if (data?['credits'] is Map &&
              (data!['credits']['unlimited'] == true ||
                  data!['credits']['balance'] is String))
            Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text(data!['credits']['unlimited'] == true
                    ? '额外额度：不限额'
                    : '额外额度余额：${data!["credits"]["balance"]}（接口原值）')),
          ...objects(data?['windows']).map((w) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${w['label']} · 剩余 ${w['remainingPercent']}%'),
                    const SizedBox(height: 8),
                    LinearProgressIndicator(
                        value: (w['remainingPercent'] as num).toDouble() / 100),
                    Text('已用 ${w['usedPercent']}%',
                        style: const TextStyle(fontSize: 12)),
                    if (w['resetsAt'] is String)
                      Text(
                          '重置时间：${DateTime.tryParse(w['resetsAt'])?.toLocal().toString() ?? '未知'}',
                          style: const TextStyle(fontSize: 12)),
                  ]))),
          if (data?['source'] is String)
            Text(data!['source'],
                style: const TextStyle(fontSize: 12, color: Colors.grey)),
          if (data?['updatedAt'] is String)
            Text('查询时间：${DateTime.tryParse(data!['updatedAt'])?.toLocal()}',
                style: const TextStyle(fontSize: 12, color: Colors.grey)),
        ])),
      ]));
}
