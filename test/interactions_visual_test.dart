import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/main.dart';
import 'client_test.dart' show fixture;

// Synthetic conversation only; safe to use these references in public docs.
void main() {
  testWidgets('bottom interactions and permission selector visual references',
      (tester) async {
    await tester.runAsync(() async {
      for (final entry in {
        'MaterialIcons':
            '${Platform.environment['FLUTTER_ROOT']}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
        'sans-serif': 'C:/Windows/Fonts/msyh.ttc',
      }.entries) {
        final file = File(entry.value);
        if (file.existsSync()) {
          await (FontLoader(entry.key)
                ..addFont(
                    Future.value(ByteData.sublistView(file.readAsBytesSync()))))
              .load();
        }
      }
    });
    await tester.binding.setSurfaceSize(const Size(390, 844));
    final c = fixture();
    c.details[c.selectedId]!['canApprove'] = true;
    c.details[c.selectedId]!['permissions'] = {
      'label': '需要时询问我',
      'reviewer': '由我审批'
    };
    c.details[c.selectedId]!['approvals'] = [
      {'id': 'demo', 'title': '允许修改项目文件？', 'description': '将为当前项目补充测试和说明文档。'}
    ];
    await tester.pumpWidget(MydexApp(controller: c));
    await tester.pump(const Duration(milliseconds: 400));
    await expectLater(find.byType(MaterialApp),
        matchesGoldenFile('goldens/permissions-bottom.png'));
    await tester.tap(find.byKey(const ValueKey('permission-mode')));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp),
        matchesGoldenFile('goldens/permissions-selector.png'));
    await tester.tap(find.text('只读'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    c.details[c.selectedId]!['approvals'] = [
      {
        'id': 'question',
        'kind': 'user-input',
        'questions': [
          {
            'id': 'plan',
            'question': '下一步优先做哪项？',
            'options': [
              {'label': '补充测试', 'description': '先验证关键功能'},
              {'label': '完善界面', 'description': '先优化手机布局'}
            ]
          }
        ]
      }
    ];
    c.notifyListeners();
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp),
        matchesGoldenFile('goldens/questions-bottom.png'));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  });
}
