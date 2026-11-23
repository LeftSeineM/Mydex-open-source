import 'package:flutter/material.dart';
import '../controller.dart';

class NewTaskProjectPicker extends StatelessWidget {
  final AppController controller;
  const NewTaskProjectPicker({super.key, required this.controller});
  @override
  Widget build(BuildContext context) {
    final c = controller;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: DropdownButtonFormField<String>(
        key: const ValueKey('new-task-project'),
        value: c.visibleProjects.any((p) => p['id'] == c.projectId)
            ? c.projectId
            : '',
        isExpanded: true,
        decoration: const InputDecoration(
          labelText: '新对话的项目',
          prefixIcon: Icon(Icons.folder_outlined, size: 18),
          contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          isDense: true,
        ),
        items: [
          const DropdownMenuItem(value: '', child: Text('不指定项目')),
          ...c.visibleProjects.map((p) => DropdownMenuItem<String>(
                value: p['id'],
                child: Text(p['name'] ?? '项目',
                    maxLines: 1, overflow: TextOverflow.ellipsis),
              )),
        ],
        onChanged: c.sending
            ? null
            : (id) {
                c.chooseProject(id == '' ? null : id);
                c.newTask();
              },
      ),
    );
  }
}
