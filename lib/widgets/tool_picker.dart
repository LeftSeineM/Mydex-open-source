import 'package:flutter/material.dart';
import '../controller.dart';

class ToolPicker extends StatelessWidget {
  final AppController controller;
  const ToolPicker({super.key, required this.controller});
  @override
  Widget build(BuildContext context) {
    final c = controller;
    final items = c.deviceTools;
    if (items.isEmpty) return const SizedBox.shrink();
    return DropdownButtonFormField<String>(
      value: items.any((t) => t['id'] == c.toolId) ? c.toolId : null,
      isExpanded: true,
      decoration: const InputDecoration(
          labelText: 'Coding 工具',
          prefixIcon: Icon(Icons.terminal_rounded, size: 18),
          contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 10)),
      items: items
          .map((t) => DropdownMenuItem<String>(
              value: t['id'],
              child: Text(t['name'],
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13))))
          .toList(),
      onChanged: (v) {
        if (v != null) c.chooseTool(v);
      },
    );
  }
}
