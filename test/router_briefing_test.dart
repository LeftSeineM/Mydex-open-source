import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/widgets/router_briefing.dart';
import 'package:mydex_mobile/pages/router_workspace.dart';
import 'client_test.dart' show fixture;
import 'router_workspace_test.dart' show WorkspaceApi;

void main() {
  testWidgets('briefing isolates project facts and preserves source navigation', (tester) async {
    String? opened;
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:RouterBriefing(
      job:{'id':'one','name':'项目','scope':['pc~chat'], 'routerReading':{'unread':2}},
      tasks:[{'id':'t','job':'one','session':'pc~chat','state':'waiting_approval',
        'package':{'goal':'验证边界'}, 'node':{'title':'边界分支'},
        'observed':{'recentUpdates':[{'ref':'message-1','excerpt':'找到碰撞证据','at':1}]}},
        {'id':'foreign','job':'other','state':'failed','observed':{'recentUpdates':[{'excerpt':'不该显示'}]}}],
      onNode:(node)=>opened=node['session'],onOrganize:(){},onSummarize:(){},onAttention:(){}))));
    expect(find.text('待处理 1'),findsOneWidget);
    expect(find.text('找到碰撞证据'),findsOneWidget);
    expect(find.text('不该显示'),findsNothing);
    expect(find.textContaining('2 条项目事件'),findsOneWidget);
    await tester.ensureVisible(find.text('找到碰撞证据'));
    await tester.tap(find.text('找到碰撞证据'));
    expect(opened,'pc~chat');
  });

  testWidgets('organizer action creates scoped draft without sending or acknowledging', (tester) async {
    final c=fixture(),api=WorkspaceApi();c.api=api;
    await tester.pumpWidget(MaterialApp(home:RouterWorkspacePage(controller:c)));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('项目简报'));await tester.pumpAndSettle();
    await tester.tap(find.text('汇总下一步'));await tester.pumpAndSettle();
    expect(c.drafts[c.selectedId],contains('laptop~desktop:worker'));
    expect(c.drafts[c.selectedId],contains('本次仅研究，不派发'));
    expect(api.calls,isEmpty);
    await tester.pumpWidget(const SizedBox());c.dispose();
  });
}
