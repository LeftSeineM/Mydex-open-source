import 'package:flutter/material.dart';
import '../models.dart';

Color statusColor(String? status, {bool dark = false}) => switch (status) {
      'Running' => dark ? const Color(0xff9cb9e3) : const Color(0xff41658a),
      'AwaitingApproval' =>
        dark ? const Color(0xffdfb778) : const Color(0xff916015),
      'Completed' => dark ? const Color(0xff91b9a0) : const Color(0xff477a5b),
      'Failed' => dark ? const Color(0xffdb9391) : const Color(0xffad4946),
      _ => dark ? const Color(0xff9a9ea5) : const Color(0xff626870)
    };

class StatusDot extends StatelessWidget {
  final Color color;
  final double size;
  const StatusDot(this.color, {super.key, this.size = 7});
  @override
  Widget build(BuildContext context) => Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle));
}

class TaskStatus extends StatelessWidget {
  final String? status;
  const TaskStatus(this.status, {super.key});
  @override
  Widget build(BuildContext context) {
    final color = statusColor(status,
        dark: Theme.of(context).brightness == Brightness.dark);
    return Row(mainAxisSize: MainAxisSize.min, children: [
      StatusDot(color),
      const SizedBox(width: 7),
      Text(statusLabel(status), style: TextStyle(fontSize: 11, color: color))
    ]);
  }
}
