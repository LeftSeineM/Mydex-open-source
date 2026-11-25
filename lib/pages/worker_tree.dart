import 'dart:async';
import 'package:flutter/material.dart';
import '../controller.dart';
import '../models.dart';

/// Read-only view of the Workers a desktop Router dispatched: tree, spend,
/// briefs and receipts. Acceptance and dispatch stay on the computer.
class WorkerTreePage extends StatefulWidget {
  final AppController controller;
  const WorkerTreePage({super.key, required this.controller});
  @override
  State<WorkerTreePage> createState() => _WorkerTreePageState();
}

const _blue = Color(0xff355e79), _green = Color(0xff2f715a);
const _warn = Color(0xff865b18), _red = Color(0xffa0413b);

class _Look {
  final String label;
  final Color color;
  final int flow; // 1 brief flowing down, -1 receipt flowing up, 0 still
  const _Look(this.label, this.color, [this.flow = 0]);
}

_Look _look(Json j) {
  final review = j['review'];
  switch (j['state']) {
    case 'queued':
      return const _Look('排队中', Colors.grey, 1);
    case 'running':
      return const _Look('运行中', _blue, 1);
    case 'done':
      if (review is Map) {
        return review['passed'] == true
            ? const _Look('已验收', _green)
            : const _Look('未通过', _warn);
      }
      return const _Look('待抽测', _green, -1);
    case 'lost':
      return const _Look('结果未知', _warn);
    case 'cancelled':
      return const _Look('已取消', Colors.grey);
    default:
      return const _Look('失败', _red);
  }
}

String _money(Object? v) => '¥${((v as num?) ?? 0).toStringAsFixed(4)}';

class _WorkerTreePageState extends State<WorkerTreePage> {
  Json? board;
  String? error;
  String? expanded;
  Timer? timer;

  @override
  void initState() {
    super.initState();
    load();
    timer = Timer.periodic(const Duration(seconds: 5), (_) => load());
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  Future<void> load() async {
    final api = widget.controller.api;
    if (api == null) {
      setState(() => error = '尚未连接电脑');
      return;
    }
    try {
      final result = await api.get('/api/workers');
      if (mounted) {
        setState(() {
          board = result;
          error = null;
        });
      }
    } catch (_) {
      if (mounted) setState(() => error = '读取失败。请确认电脑端 Mydex Agent 已更新到 0.1.34 或更高版本');
    }
  }

  List<Json> get jobs =>
      ((board?['jobs'] as List?) ?? []).map((e) => Json.from(e as Map)).toList();

  @override
  Widget build(BuildContext context) {
    final list = jobs, ids = list.map((j) => j['id']).toSet();
    final roots =
        list.where((j) => j['parent'] == null || !ids.contains(j['parent'])).toList();
    final running = list.where((j) => _look(j).flow == 1).length;
    final review = list.where((j) => _look(j).label == '待抽测').length;
    expanded ??= roots
        .cast<Json?>()
        .firstWhere((j) => _hasActive(j!, list), orElse: () => roots.lastOrNull)?['id'];
    return Scaffold(
      appBar: AppBar(
          title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Worker 任务树', style: TextStyle(fontSize: 16)),
            Text('${list.length} 个任务，$running 个在跑，$review 个等抽测',
                style: Theme.of(context).textTheme.bodySmall),
          ]),
          actions: [
            IconButton(
                tooltip: '刷新', icon: const Icon(Icons.refresh), onPressed: load)
          ]),
      body: RefreshIndicator(
        onRefresh: load,
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
          if (error != null)
            Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(error!, style: const TextStyle(color: _red))),
          if (board != null && board!['available'] != true)
            const Padding(
                padding: EdgeInsets.symmetric(vertical: 40),
                child: Text('这台电脑还没有派出过 Worker。在电脑上让 Router 派活后，任务会出现在这里。',
                    textAlign: TextAlign.center)),
          if (board?['available'] == true) ...[
            _spend(context, list),
            const SizedBox(height: 16),
            _routerNode(context),
            for (final r in roots) ..._branch(context, r, list, 0),
            const SizedBox(height: 24),
            _process(context, list),
          ],
        ]),
      ),
    );
  }

  bool _hasActive(Json j, List<Json> all) =>
      _look(j).flow != 0 ||
      all.where((c) => c['parent'] == j['id']).any((c) => _hasActive(c, all));

  Widget _spend(BuildContext context, List<Json> list) {
    final spent = (board!['spentCny'] as num?) ?? 0;
    final budget = ((board!['limits'] as Map?)?['budgetCny'] as num?) ?? 0;
    final strong = board!['allStrongCny'] as num?;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Text('已花 ${_money(spent)}',
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
        const Spacer(),
        Text('预算 ¥$budget', style: Theme.of(context).textTheme.bodySmall),
      ]),
      const SizedBox(height: 6),
      LinearProgressIndicator(
          value: budget > 0 ? (spent / budget).clamp(0, 1).toDouble() : 0,
          minHeight: 4,
          borderRadius: BorderRadius.circular(2)),
      if (strong != null)
        Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text('同样的 token 全按强档单价算约 ${_money(strong)}。单价是估算值。',
                style: Theme.of(context).textTheme.bodySmall)),
      const SizedBox(height: 12),
      Wrap(spacing: 6, runSpacing: 6, children: [
        for (final j in list)
          Tooltip(
            message: '${j['title']}：${_look(j).label}',
            child: InkWell(
                customBorder: const CircleBorder(),
                onTap: () => _open(context, j),
                child: Container(
                    width: 14,
                    height: 14,
                    decoration: BoxDecoration(
                        shape: BoxShape.circle, color: _look(j).color))),
          )
      ]),
    ]);
  }

  Widget _routerNode(BuildContext context) => Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
          color: _blue.withAlpha(20),
          border: Border.all(color: _blue.withAlpha(90)),
          borderRadius: BorderRadius.circular(12)),
      child: const Row(children: [
        Icon(Icons.hub_outlined, color: _blue, size: 20),
        SizedBox(width: 8),
        Expanded(
            child: Text('Router 在电脑上拆分任务、写简报、抽测验收',
                style: TextStyle(fontWeight: FontWeight.w600))),
      ]));

  List<Widget> _branch(BuildContext context, Json j, List<Json> all, int depth) {
    final children = all.where((c) => c['parent'] == j['id']).toList();
    final open = depth > 0 || expanded == j['id'];
    return [
      Padding(
        padding: EdgeInsets.only(left: depth * 20.0),
        child: IntrinsicHeight(
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SizedBox(width: 22, child: _Wire(look: _look(j), cost: j['costCny'] as num?)),
            Expanded(
                child: Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: _node(context, j, children.length, open, depth))),
          ]),
        ),
      ),
      if (open)
        for (final c in children) ..._branch(context, c, all, depth + 1),
    ];
  }

  Widget _node(BuildContext context, Json j, int childCount, bool open, int depth) {
    final look = _look(j), tiers = (board!['tiers'] as Map?) ?? {};
    final tier = (tiers[j['tier']] as Map?)?['label'] ?? j['tier'] ?? '';
    return Material(
      color: Theme.of(context).colorScheme.surface,
      shape: RoundedRectangleBorder(
          side: BorderSide(color: look.color.withAlpha(look.flow == 0 ? 70 : 160)),
          borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _open(context, j),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                  child: Text('${j['title']}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w600))),
              Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                      color: look.color.withAlpha(28),
                      borderRadius: BorderRadius.circular(6)),
                  child: Text(look.label,
                      style: TextStyle(fontSize: 12, color: look.color))),
            ]),
            const SizedBox(height: 4),
            Text('$tier ${j['model'] ?? ''}，${_money(j['costCny'])}',
                style: Theme.of(context).textTheme.bodySmall),
            if (childCount > 0 && depth == 0)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                    style: TextButton.styleFrom(
                        padding: EdgeInsets.zero,
                        minimumSize: const Size(0, 32),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap),
                    onPressed: () =>
                        setState(() => expanded = open ? '' : j['id'] as String),
                    child: Text(open ? '收起 $childCount 项' : '展开 $childCount 项')),
              ),
          ]),
        ),
      ),
    );
  }

  Widget _process(BuildContext context, List<Json> list) {
    final titles = {for (final j in list) j['id']: j['title']};
    final rows = ((board!['ledger'] as List?) ?? []).reversed.take(30).toList();
    String text(Map e) {
      final t = '「${titles[e['id']] ?? e['id']}」';
      switch (e['event']) {
        case 'dispatched':
          return '派出$t，交给${e['model']}。${e['why'] ?? ''}';
        case 'started':
          return '$t开始运行';
        case 'done':
          return '$t交回回执，花费 ${_money(e['costCny'])}，等 Router 抽测';
        case 'accepted':
          return 'Router 抽测$t通过：${e['check'] ?? ''}';
        case 'rejected':
          return 'Router 抽测$t未通过：${e['check'] ?? ''}';
        case 'lost':
          return '$t在后台重启时中断，结果未知';
        default:
          return '$t${e['event']}${e['error'] != null ? '：${e['error']}' : ''}';
      }
    }

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('过程', style: Theme.of(context).textTheme.titleSmall),
      const SizedBox(height: 8),
      for (final e in rows.whereType<Map>())
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(_time(e['at']), style: Theme.of(context).textTheme.bodySmall),
            Text(text(e),
                style: TextStyle(
                    color: e['event'] == 'rejected' || e['event'] == 'lost'
                        ? _warn
                        : null)),
          ]),
        ),
    ]);
  }

  String _time(Object? at) {
    final t = at is String ? DateTime.tryParse(at)?.toLocal() : null;
    if (t == null) return '';
    String two(int n) => n.toString().padLeft(2, '0');
    return '${t.month}/${t.day} ${two(t.hour)}:${two(t.minute)}:${two(t.second)}';
  }

  void _open(BuildContext context, Json j) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (_) => FractionallySizedBox(
          heightFactor: .85,
          child: _JobSheet(controller: widget.controller, job: j, look: _look(j))));
}

/// Connector from the parent: thickness follows spend, a dot travels along it
/// while a brief or receipt is in flight. Still when animations are disabled.
class _Wire extends StatefulWidget {
  final _Look look;
  final num? cost;
  const _Wire({required this.look, this.cost});
  @override
  State<_Wire> createState() => _WireState();
}

class _WireState extends State<_Wire> with SingleTickerProviderStateMixin {
  late final AnimationController motion =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 1600));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sync();
  }

  @override
  void didUpdateWidget(_Wire old) {
    super.didUpdateWidget(old);
    _sync();
  }

  void _sync() {
    final still = MediaQuery.of(context).disableAnimations || widget.look.flow == 0;
    if (still) {
      motion.stop();
    } else if (!motion.isAnimating) {
      motion.repeat();
    }
  }

  @override
  void dispose() {
    motion.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => CustomPaint(
      painter: _WirePainter(motion, widget.look,
          1.5 + ((widget.cost ?? 0).toDouble() * 200).clamp(0, 3.5)));
}

class _WirePainter extends CustomPainter {
  final Animation<double> t;
  final _Look look;
  final double width;
  _WirePainter(this.t, this.look, this.width) : super(repaint: t);

  @override
  void paint(Canvas canvas, Size size) {
    final x = size.width / 2, y = 10 + 22.0;
    final line = Paint()
      ..color = const Color(0xffb8c4ce)
      ..strokeWidth = width
      ..style = PaintingStyle.stroke;
    final path = Path()
      ..moveTo(x, 0)
      ..lineTo(x, y - 8)
      ..quadraticBezierTo(x, y, x + 8, y)
      ..lineTo(size.width, y);
    canvas.drawPath(path, line);
    if (look.flow == 0 || !t.isAnimating) return;
    final metric = path.computeMetrics().first;
    final progress = look.flow > 0 ? t.value : 1 - t.value;
    final pos = metric.getTangentForOffset(metric.length * progress)?.position;
    if (pos != null) canvas.drawCircle(pos, 3.5, Paint()..color = look.color);
  }

  @override
  bool shouldRepaint(_WirePainter old) =>
      old.look.flow != look.flow || old.width != width;
}

class _JobSheet extends StatefulWidget {
  final AppController controller;
  final Json job;
  final _Look look;
  const _JobSheet({required this.controller, required this.job, required this.look});
  @override
  State<_JobSheet> createState() => _JobSheetState();
}

class _JobSheetState extends State<_JobSheet> {
  Json? detail;
  String? error;

  @override
  void initState() {
    super.initState();
    () async {
      try {
        final d = await widget.controller.api!.get(
            '/api/workers/job?id=${Uri.encodeQueryComponent(widget.job['id'] as String)}');
        if (mounted) setState(() => detail = d);
      } catch (_) {
        if (mounted) setState(() => error = '读取失败，请稍后重试');
      }
    }();
  }

  @override
  Widget build(BuildContext context) {
    final j = widget.job, review = j['review'];
    Widget body(String? text, String empty) => detail == null
        ? Center(
            child: error != null ? Text(error!) : const CircularProgressIndicator())
        : SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: SelectableText(text?.trim().isNotEmpty == true ? text! : empty,
                style: const TextStyle(height: 1.55)));
    final receipt = detail?['receipt'] as String? ?? detail?['partial'] as String?;
    final why = [
      '理由：${j['why'] ?? 'Router 没有写理由'}',
      '档位：${j['tier']}，模型：${j['provider']}/${j['model']}',
      '花费：${_money(j['costCny'])}',
      if (j['error'] != null) '错误：${j['error']}',
      if (review is Map)
        'Router 抽测：${review['passed'] == true ? '通过' : '未通过'}。${review['check'] ?? ''}'
      else if (j['state'] == 'done')
        '回执是 Worker 的自述，Router 尚未抽测。',
    ].join('\n\n');
    final files = [
      if (j['workdir'] != null) '工作目录：${j['workdir']}',
      ...((detail?['files'] as List?) ?? []).map((f) => '$f'),
    ].join('\n');
    return DefaultTabController(
      length: 4,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(children: [
            Expanded(
                child: Text('${j['title']}',
                    style: Theme.of(context).textTheme.titleMedium)),
            Text(widget.look.label, style: TextStyle(color: widget.look.color)),
          ]),
        ),
        const TabBar(isScrollable: true, tabAlignment: TabAlignment.start, tabs: [
          Tab(text: '简报'),
          Tab(text: '回执'),
          Tab(text: '为什么交给它'),
          Tab(text: '交接文件'),
        ]),
        Expanded(
          child: TabBarView(children: [
            body(detail?['brief'] as String?, '没有简报文件'),
            body(receipt, '还没有交回回执'),
            body(why, ''),
            body(files, '没有交接文件'),
          ]),
        ),
      ]),
    );
  }
}
