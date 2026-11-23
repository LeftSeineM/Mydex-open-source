import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/main.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/api.dart';
import 'package:mydex_mobile/widgets/interactions.dart';
import 'client_test.dart' show fixture;

class ConfirmedPermissionsApi extends GatewayApi {
  ConfirmedPermissionsApi() : super(const ConnectionSettings());
  @override
  Future<Json> get(String path) async => path.endsWith('/models')
      ? {'models': []}
      : {
          'permissions': {'mode': 'ask', 'label': '需要时询问我'}
        };
}

void main() {
  test('confirmed desktop settings replace stale detail permissions', () async {
    final c = fixture();
    c.api = ConfirmedPermissionsApi();
    c.details[c.selectedId]!['permissions'] = {'mode': 'full'};
    await c.loadControls();
    expect(c.selected?['permissions']['mode'], 'ask');
    c.dispose();
  });
  testWidgets(
      'questions need explicit answers and preserve choice plus free text',
      (tester) async {
    Json? submitted;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: QuestionCard(request: {
      'questions': [
        {
          'id': 'choice',
          'question': '是否继续？',
          'options': [
            {'label': '继续', 'description': '继续当前任务'}
          ]
        },
        {'id': 'text', 'question': '填写说明'}
      ]
    }, enabled: true, busy: false, onSubmit: (v) => submitted = v))));
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull);
    await tester.tap(find.text('继续'));
    await tester.enterText(find.byKey(const ValueKey('answer:text')), '仅修改文档');
    await tester.pump();
    await tester.tap(find.text('提交回答'));
    expect(submitted?['choice']['answers'], ['继续']);
    expect(submitted?['text']['answers'], ['仅修改文档']);
  });
  testWidgets('pending request stays above composer even with long history',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    final c = fixture();
    c.details[c.selectedId]!['messages'] = List.generate(
        100,
        (i) =>
            {'id': '$i', 'role': 'agent', 'type': 'text', 'text': '历史消息 $i'});
    c.details[c.selectedId]!['canApprove'] = true;
    c.details[c.selectedId]!['permissions'] = {
      'label': '完全访问',
      'reviewer': '由我审批'
    };
    c.details[c.selectedId]!['approvals'] = [
      {'id': 'pending', 'title': '允许本次修改？', 'description': '等待确认'}
    ];
    await tester.pumpWidget(MydexApp(controller: c));
    await tester.pump();
    expect(find.text('允许本次修改？').hitTestable(), findsOneWidget);
    expect(tester.getTopLeft(find.byType(PendingInteractions)).dy,
        lessThan(tester.getTopLeft(find.byType(PermissionBar)).dy));
    expect(find.textContaining('权限：完全访问'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  });
}
