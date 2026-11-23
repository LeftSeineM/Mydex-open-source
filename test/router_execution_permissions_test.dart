import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/widgets/router_execution_permissions.dart';

void main() {
  for (final width in [390.0, 760.0]) {
    testWidgets('grant all stays within supported scope and cancel never grants at $width', (tester) async {
      await tester.binding.setSurfaceSize(Size(width, 940));
      Json? result;
      final job = <String,dynamic>{'id':'project','scope':['allowed','readonly'],
        'workspaceScope':['workspace'],'execution':{'revision':4,'sessions':[],'workspaces':[]}};
      final catalog = <String,dynamic>{'sessions':[
        {'key':'allowed','title':'可执行Worker','capabilities':{'send':'supported'}},
        {'key':'readonly','title':'远端只读Worker','capabilities':{'send':'unsupported'}},
        {'key':'unselected','title':'范围外Worker','capabilities':{'send':'supported'}}],
        'workspaces':[{'key':'workspace','name':'测试目录','toolId':'deepseek','device':'local','path':'D:/Test'}]};
      await tester.pumpWidget(MaterialApp(home:Builder(builder:(context)=>Scaffold(
        body:TextButton(onPressed:() async {result=await showRouterExecutionPermissions(context,job:job,catalog:catalog);},child:const Text('打开'))))));
      await tester.tap(find.text('打开'));await tester.pumpAndSettle();
      expect(find.text('范围外Worker'),findsNothing);
      final readonly=tester.widget<CheckboxListTile>(find.ancestor(of:find.text('远端只读Worker'),matching:find.byType(CheckboxListTile)));
      expect(readonly.onChanged,isNull);
      await tester.tap(find.text('授权全部可执行范围'));await tester.pumpAndSettle();
      await tester.tap(find.text('取消'));await tester.pumpAndSettle();expect(result,isNull);
      await tester.tap(find.text('打开'));await tester.pumpAndSettle();
      await tester.tap(find.text('授权全部可执行范围'));await tester.pumpAndSettle();
      await tester.tap(find.text('保存授权'));await tester.pumpAndSettle();
      expect(result,{'jobId':'project','expectedRevision':4,'sessions':['allowed'],
        'workspaces':['workspace'],'maxNewWindows':3,'inheritCreatedWorkers':true});
      expect(tester.takeException(),isNull);
      await tester.pumpWidget(const SizedBox());await tester.binding.setSurfaceSize(null);
    });
  }
}
