import '../widgets/spacing.dart';
import 'package:flutter/material.dart';
import '../controller.dart';
import '../widgets/status.dart';
import '../widgets/tool_picker.dart';
import '../widgets/connection_picker.dart';

/// Mobile landing follows the official Projects / Recents hierarchy.
class ProjectsPage extends StatelessWidget {
  final AppController controller;
  const ProjectsPage({super.key, required this.controller});
  @override
  Widget build(BuildContext context) {
    final c = controller;
    final projects = c.visibleProjects;
    final selected = projects.where((p) => p['id'] == c.projectId).firstOrNull;
    final colors = Theme.of(context).colorScheme;
    return RefreshIndicator(
      onRefresh: c.refresh,
      child: ListView(
          padding:
              compactInsets(context, const EdgeInsets.fromLTRB(24, 8, 24, 32)),
          children: [
            ConnectionPicker(controller: c),
            if (c.isSuperagent)
              const Padding(
                padding: EdgeInsets.only(top: 16),
                child: Text('私有测试 · 小主机协调\n6.1 sol · 低推理强度。任务自动保存；向电脑派发前需要你批准。',
                    style: TextStyle(
                        fontSize: 12, height: 1.6, color: Colors.grey)),
              ),
            SizedBox(height: compactGap(context, 24)),
            Text(selected?['name'] ?? c.toolName,
                style: const TextStyle(
                    fontSize: 34,
                    fontWeight: FontWeight.w400,
                    letterSpacing: -.8)),
            SizedBox(height: compactGap(context, 20)),
            if (c.devices.length > 1)
              Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: c.devices
                      .map((device) => ChoiceChip(
                            selected: device['id'] == c.deviceId,
                            showCheckmark: false,
                            avatar: StatusDot(device['online'] == true &&
                                    device['desktopOnline'] == true
                                ? const Color(0xff91b9a0)
                                : const Color(0xff777b82)),
                            label: Text(device['name'],
                                style: const TextStyle(fontSize: 12)),
                            onSelected: (_) => c.chooseDevice(device['id']),
                            side: BorderSide(
                                color: colors.onSurface.withValues(alpha: .08)),
                          ))
                      .toList()),
            if (c.devices.length > 1) SizedBox(height: compactGap(context, 28)),
            ToolPicker(controller: c),
            if (c.toolId != 'codex')
              Padding(
                  padding:
                      compactInsets(context, const EdgeInsets.only(top: 10)),
                  child: Text(
                      c.deviceTools
                              .where((t) => t['id'] == c.toolId)
                              .firstOrNull?['note'] ??
                          '',
                      style: TextStyle(
                          fontSize: 12, color: colors.onSurfaceVariant))),
            SizedBox(height: compactGap(context, 24)),
            if (selected == null) ...[
              const Text('项目',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
              SizedBox(height: compactGap(context, 12)),
              ...projects.map((project) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.folder_outlined, size: 22),
                    minLeadingWidth: 24,
                    title: Text(project['name'],
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 16)),
                    trailing: Icon(Icons.chevron_right,
                        size: 18,
                        color: colors.onSurface.withValues(alpha: .3)),
                    onTap: () => c.chooseProject(project['id']),
                  )),
              if (projects.isEmpty)
                Padding(
                    padding: EdgeInsets.symmetric(vertical: 16),
                    child: Text('当前工具暂无项目',
                        style: TextStyle(color: Colors.grey, fontSize: 13))),
              SizedBox(height: compactGap(context, 28)),
            ] else ...[
              Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                      onPressed: () => c.chooseProject(null),
                      icon: const Icon(Icons.arrow_back, size: 16),
                      label: const Text('所有项目'))),
              SizedBox(height: compactGap(context, 12)),
            ],
            Row(children: [
              const Expanded(
                  child: Text('最近对话',
                      style: TextStyle(
                          fontSize: 16, fontWeight: FontWeight.w500))),
              IconButton(
                  tooltip: '新对话',
                  onPressed: c.newTask,
                  icon: const Icon(Icons.edit_square, size: 19)),
            ]),
            SizedBox(height: compactGap(context, 8)),
            ...c.visibleTasks.map((task) => ListTile(
                  contentPadding: compactInsets(
                      context, const EdgeInsets.symmetric(vertical: 5)),
                  title: Text(task['title'] ?? '未命名会话',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 15, height: 1.45)),
                  subtitle: Padding(
                      padding:
                          compactInsets(context, const EdgeInsets.only(top: 7)),
                      child: TaskStatus(task['status'])),
                  trailing: const Icon(Icons.chevron_right,
                      size: 18, color: Colors.grey),
                  onTap: () => c.select(task['id']),
                )),
            if (c.visibleTasks.isEmpty)
              Padding(
                  padding: compactInsets(
                      context, const EdgeInsets.symmetric(vertical: 24)),
                  child: Text('从一个问题开始。',
                      style: TextStyle(
                          color: colors.onSurface.withValues(alpha: .45)))),
          ]),
    );
  }
}
