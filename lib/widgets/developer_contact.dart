import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

const developerEmail = '348897402@qq.com';

/// Explicit copy only: never collect or attach diagnostics or credentials.
class DeveloperContactTile extends StatelessWidget {
  const DeveloperContactTile({super.key});

  @override
  Widget build(BuildContext context) => ListTile(
        contentPadding: EdgeInsets.zero,
        leading: const Icon(Icons.mail_outline),
        title: const Text('联系开发者'),
        subtitle: const Text(developerEmail),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => showDialog<void>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('联系开发者'),
            content: const Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SelectableText(developerEmail),
                SizedBox(height: 16),
                Text('版本更新、使用问题或建议都可以发邮件反馈。建议注明应用版本、设备和复现步骤。'),
                SizedBox(height: 12),
                Text('请勿发送访问令牌、API Key、配对信息或未经处理的私人对话。应用不会自动发送邮件或日志。'),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('关闭'),
              ),
              FilledButton(
                onPressed: () async {
                  try {
                    await Clipboard.setData(
                        const ClipboardData(text: developerEmail));
                    if (!dialogContext.mounted) return;
                    Navigator.pop(dialogContext);
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('邮箱已复制，请在邮件应用中发送反馈')));
                    }
                  } catch (_) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('复制失败，可长按邮箱手动复制')));
                    }
                  }
                },
                child: const Text('复制邮箱'),
              ),
            ],
          ),
        ),
      );
}
