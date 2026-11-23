import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/pages/router_workspace.dart';
import 'client_test.dart' show fixture;
import 'router_workspace_test.dart' show WorkspaceApi;

class ProjectRouterApi extends WorkspaceApi {
 bool failDetail=false;
 @override Future<Json> get(String path) async {
  if(path.startsWith('/api/tasks/')) {
   if(failDetail) throw Exception('offline chat');
   return {...await super.get(path),'id':'laptop~desktop:project-router'};
  }
  final r=await super.get(path);
  r['jobs']=[for(final j in r['jobs']) {...j,'router':{'device':'laptop','session':'desktop:project-router'}}];
  return r;
 }
}
void main(){
 testWidgets('project Router overrides global default and organizer remains a reviewed draft',(tester) async {
  final c=fixture(),api=ProjectRouterApi();c.api=api;
  await tester.pumpWidget(MaterialApp(home:RouterWorkspacePage(controller:c)));await tester.pumpAndSettle();
  expect(c.selectedId,'laptop~desktop:project-router');
  await tester.tap(find.byTooltip('项目操作'));await tester.pumpAndSettle();await tester.tap(find.text('让 Router 梳理分工'));await tester.pumpAndSettle();
  expect(c.drafts[c.selectedId],contains('证据来源与更新时间'));
  expect(c.drafts[c.selectedId],contains('不派发、不新建、不审批'));
  expect(api.calls,isEmpty);
  await tester.pumpWidget(const SizedBox());c.dispose();
 });
 testWidgets('offline Router conversation does not erase successfully loaded project',(tester) async {
  final c=fixture(),api=ProjectRouterApi()..failDetail=true;c.api=api;
  await tester.pumpWidget(MaterialApp(home:RouterWorkspacePage(controller:c,initialTree:true)));await tester.pumpAndSettle();
  expect(find.textContaining('1 个原会话'),findsOneWidget);
  expect(find.textContaining('项目已加载'),findsOneWidget);
  expect(find.textContaining('0 个项目'),findsNothing);
  await tester.pumpWidget(const SizedBox());c.dispose();
 });
}
