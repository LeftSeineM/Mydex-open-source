import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/widgets/router_tree.dart';
import 'package:mydex_mobile/models.dart';

void main(){
  final job=<String,dynamic>{'id':'p','scope':['main~a','main~b']};
  final tasks=<Json>[
    {'id':'old','job':'p','session':'main~a','state':'superseded','node':{'device':'wrong'}},
    {'id':'a','job':'p','session':'main~a','state':'human_intervention','node':{'device':'main','toolId':'deepseek','title':'验证分支'}},
  ];
  testWidgets('CAP shows two original conversations and one query-only resource', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390,900));
    Json? clicked;
    final cap={...job,'name':'梳理 CAP 分层框架','nodes':[
      {'key':'main~a','title':'麻将','hostId':'mini','hostName':'小主机','device':'main'},
      {'key':'main~b','title':'搭塔','hostId':'mini','hostName':'小主机','device':'main'}],
      'resources':[{'id':'cap-gpu','name':'CAP GPU 服务器'}]};
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:RouterTree(job:cap,tasks:[],devices:[],selected:{},onSelect:(_){},onNode:(n)=>clicked=n,onAsk:(){},onRouter:(){})))));
    expect(find.byType(Checkbox),findsNWidgets(2));
    expect(find.text('麻将'),findsOneWidget);expect(find.text('搭塔'),findsOneWidget);
    await tester.ensureVisible(find.text('点此查询'));await tester.tap(find.text('点此查询'));expect(clicked?['resourceId'],'cap-gpu');
    expect(clicked?['session'],isNull);expect(tester.takeException(),isNull);
    await tester.pumpWidget(const SizedBox());await tester.binding.setSurfaceSize(null);
  });
  test('scope retains unassigned sessions; obsolete tasks do not replace current branches',(){
    final nodes=RouterTree.branches(job,tasks);expect(nodes.length,2);
    expect(nodes.first['id'],'a');expect(nodes.last['state'],'observing');
    expect(RouterTree.stateLabel('human_intervention'),'待人工核对');
  });
  for(final width in [320.0,390.0,760.0]){
    testWidgets('real identity selection and details at $width',(tester)async{
      await tester.binding.setSurfaceSize(Size(width,900));
      final chosen=<String>{};String? inspected;var asked=false;
      await tester.pumpWidget(MaterialApp(home:Scaffold(body:StatefulBuilder(builder:(context,set)=>RouterTree(
        job:job,tasks:tasks,devices:[{'id':'main','name':'我的电脑'}],selected:chosen,
        onSelect:(id)=>set(()=>chosen.contains(id)?chosen.remove(id):chosen.add(id)),
        onNode:(node)=>inspected=node['session'],onAsk:()=>asked=true,onRouter:(){})))));
      await tester.tap(find.byType(Checkbox).first);await tester.pump();
      expect(chosen,{'main~a'});await tester.tap(find.text('问 Router'));expect(asked,isTrue);
      await tester.tap(find.text('验证分支'));expect(inspected,'main~a');
      expect(find.text('A100 GPU'),findsNothing);expect(find.text('我的电脑'),findsNothing);
      expect(tester.takeException(),isNull);await tester.pumpWidget(const SizedBox());await tester.binding.setSurfaceSize(null);
    });
  }
}
