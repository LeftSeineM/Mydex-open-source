// Browser-only implementation selected by a conditional export.
// ignore_for_file: avoid_web_libraries_in_flutter
import 'dart:html' as html;
import 'package:flutter/material.dart';
import '../services/api.dart';

class UpdateTile extends StatelessWidget {
  final GatewayApi? api;
  const UpdateTile({super.key, this.api});
  @override
  Widget build(BuildContext context) => Column(children: [ListTile(
      leading: const Icon(Icons.computer), title: const Text('账号与电脑配对'),
      subtitle: const Text('添加、解除绑定电脑或退出登录'),
      onTap: () => html.window.location.assign('/connect/')), ListTile(
      leading: const Icon(Icons.public_rounded),
      title: const Text('Mydex 网页版'),
      subtitle: const Text('更新无需安装包。请先等待发送和审批完成，再刷新页面。'),
      trailing: TextButton(onPressed: () => html.window.location.reload(),
          child: const Text('刷新')))]);
}
