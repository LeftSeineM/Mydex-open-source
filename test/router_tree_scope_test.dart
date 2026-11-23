import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/pages/router_workspace.dart';
import 'client_test.dart' show fixture;
import 'router_workspace_test.dart' show WorkspaceApi;

void main(){testWidgets('selection becomes a reviewable Router draft without sending',(tester)async{
 await tester.binding.setSurfaceSize(const Size(390,1100));
 final c=fixture(),api=WorkspaceApi();c.api=api;
 c.devices=[{'id':'laptop','name':'测试电脑','online':true,'desktopOnline':true}];
 c.tools=[{'id':'codex','deviceId':'laptop','name':'Codex','capabilities':{'send':true}}];
 await tester.pumpWidget(MaterialApp(home:RouterWorkspacePage(controller:c)));await tester.pumpAndSettle();
 await tester.tap(find.byTooltip('执行网络'));await tester.pumpAndSettle();
 await tester.tap(find.byType(Checkbox).first);await tester.pumpAndSettle();
 await tester.ensureVisible(find.text('问 Router'));await tester.tap(find.text('问 Router'));await tester.pumpAndSettle();
 expect(c.selectedId,'laptop~desktop:router-fixture');
 expect(c.drafts[c.selectedId],contains('laptop~desktop:worker'));
 expect(c.drafts[c.selectedId],contains('不是执行或审批授权'));
 expect(api.calls,isEmpty);
 expect(tester.takeException(),isNull);
 await tester.pumpWidget(const SizedBox());c.dispose();await tester.binding.setSurfaceSize(null);
});}
