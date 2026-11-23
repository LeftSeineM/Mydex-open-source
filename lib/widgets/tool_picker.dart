import 'package:flutter/material.dart';
import '../controller.dart';
import '../pages/router_workspace.dart';

class ToolPicker extends StatefulWidget {
  final AppController controller;
  const ToolPicker({super.key, required this.controller});
  @override
  State<ToolPicker> createState() => _ToolPickerState();
}

class _ToolPickerState extends State<ToolPicker> {
  int revision = 0;
  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final items = c.deviceTools;
    if (items.isEmpty && !AppController.superagentTest) {
      return const SizedBox.shrink();
    }
    return DropdownButtonFormField<String>(
      key: ValueKey('coding-tool:$revision:${c.toolId}'),
      value: items.any((t) => t['id'] == c.toolId) ? c.toolId : null,
      isExpanded: true,
      decoration: const InputDecoration(
          labelText: 'Coding 工具',
          prefixIcon: Icon(Icons.terminal_rounded, size: 18),
          contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 10)),
      items: [
        ...items.map((t) => DropdownMenuItem<String>(
            value: t['id'],
            child: Text(t['name'],
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 13)))),
        if (AppController.superagentTest)
          const DropdownMenuItem<String>(
            value: '__mydex_router__',
            child: Row(children: [
              Icon(Icons.account_tree_outlined, size: 17),
              SizedBox(width: 8),
              Text('Router · 项目工作台', style: TextStyle(fontSize: 13)),
            ]),
          ),
      ],
      onChanged: c.sending
          ? null
          : (v) async {
              if (v == '__mydex_router__') {
                // Router is a workspace, not a fabricated backend coding tool.
                // Its native conversation still supplies its real model and controls.
                await Navigator.of(context).push(MaterialPageRoute<void>(
                    builder: (_) => RouterWorkspacePage(controller: c)));
                if (mounted) setState(() => revision++);
              } else if (v != null) {
                c.chooseTool(v);
              }
            },
    );
  }
}