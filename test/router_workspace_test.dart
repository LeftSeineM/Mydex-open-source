import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/pages/router_workspace.dart';
import 'package:mydex_mobile/pages/native_router.dart';
import 'package:mydex_mobile/pages/home.dart' show ConversationPanel;
import 'client_test.dart' show fixture;
import 'native_router_test.dart' show RouterFixtureApi;

class PermissionsWorkspaceApi extends WorkspaceApi {
  @override Future<Json> post(String path, Json body, {String? requestId}) async {
    if(body['operation']=='catalog') return {'sessions':[
      {'key':'laptop~desktop:worker','title':'测试 Worker','toolId':'codex',
        'device':'laptop','capabilities':{'send':'supported'}}], 'workspaces':[]};
    return super.post(path,body,requestId:requestId);
  }
}

class WorkspaceApi extends RouterFixtureApi {
  @override Future<Json> get(String path) async {
    if(path.startsWith('/api/tasks/'))return {
      'id':'laptop~desktop:router-fixture','deviceId':'laptop','toolId':'codex',
      'source':'desktop','status':'Completed','readOnly':false,'title':'抓取验证 · Router',
      'messages':[
        {'id':'u1','role':'user','text':'先检查标定和碰撞边界，把两个分支的进展汇总给我。'},
        {'id':'a1','role':'agent','text':'标定分支已有结果，碰撞检查仍待核对。你可以继续在这里调整目标，或展开项目查看原对话与证据。'}],
      'approvals':<Json>[], 'steps':<Json>[]};
    return super.get(path);
  }
}

void main(){
  testWidgets('execution network edits the exact project grant without leaving the page',(tester) async {
    await tester.binding.setSurfaceSize(const Size(390,940));
    final c=fixture(),api=PermissionsWorkspaceApi();c.api=api;
    c.devices=[{'id':'laptop','name':'测试电脑','online':true,'desktopOnline':true}];
    c.tools=[{'id':'codex','deviceId':'laptop','name':'Codex','capabilities':{'send':true,'create':true}}];
    await tester.pumpWidget(MaterialApp(theme:ThemeData(fontFamily:'sans-serif',colorScheme:ColorScheme.fromSeed(seedColor:const Color(0xff486781))),home:RepaintBoundary(key:const ValueKey('network-capture'),
      child:RouterWorkspacePage(controller:c,initialTree:true))));
    await tester.pumpAndSettle();
    expect(find.text('执行权限'),findsOneWidget);
    final boundary=tester.renderObject<RenderRepaintBoundary>(find.byKey(const ValueKey('network-capture')));
    await tester.runAsync(() async {
      final image=await boundary.toImage(pixelRatio:1.5);final data=await image.toByteData(format:ui.ImageByteFormat.png);
      final file=File('build/router-review/network-permissions-390.png');
      await file.parent.create(recursive:true);await file.writeAsBytes(data!.buffer.asUint8List());
    });
    await tester.tap(find.text('执行权限'));await tester.pumpAndSettle();
    expect(find.text('Router 执行权限'),findsOneWidget);
    await tester.tap(find.text('全部改为仅观察'));await tester.pumpAndSettle();
    await tester.tap(find.text('保存授权'));await tester.pumpAndSettle();
    final grant=api.calls.where((b)=>b['operation']=='set_execution').single;
    expect(grant['args']['jobId'],'job');expect(grant['args']['expectedRevision'],1);
    expect(grant['args']['sessions'],isEmpty);expect(grant['args']['inheritCreatedWorkers'],false);
    expect(find.byType(NativeRouterPage),findsNothing);
    expect(tester.takeException(),isNull);
    await tester.pumpWidget(const SizedBox());c.dispose();await tester.binding.setSurfaceSize(null);
  });
  setUpAll(() async {
    for(final entry in {'sans-serif':'C:/Windows/Fonts/msyh.ttc',
      'MaterialIcons':'D:/Software/NFSeeBuild/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf'}.entries){
      final file=File(entry.value);
      if(file.existsSync())await (FontLoader(entry.key)..addFont(
        Future.value(ByteData.sublistView(file.readAsBytesSync())))).load();
    }
  });
  for(final width in [390.0,760.0]){
    testWidgets('layout A opens exact Router chat first and expands progress at $width',(tester) async {
      await tester.binding.setSurfaceSize(Size(width,940));
      final c=fixture(),api=WorkspaceApi();c.api=api;
      c.devices=[{'id':'laptop','name':'测试电脑','online':true,'desktopOnline':true}];
      c.tools=[{'id':'codex','deviceId':'laptop','name':'Codex',
        'capabilities':{'send':true,'create':true}}];
      await tester.pumpWidget(MaterialApp(theme:ThemeData(fontFamily:'sans-serif',
        colorScheme:ColorScheme.fromSeed(seedColor:const Color(0xff486781))),
        home:RepaintBoundary(key:const ValueKey('capture'),child:RouterWorkspacePage(controller:c))));
      await tester.pumpAndSettle();
      expect(find.byType(ConversationPanel),findsOneWidget);
      expect(c.selectedId,'laptop~desktop:router-fixture');expect(api.calls,isEmpty);
      expect(find.text('当前电脑或工具未连接，草稿会保留'),findsNothing);
      expect(find.byType(NativeRouterPage),findsNothing);expect(tester.takeException(),isNull);
      final boundary=tester.renderObject<RenderRepaintBoundary>(find.byKey(const ValueKey('capture')));
      await tester.runAsync(() async {
        final image=await boundary.toImage(pixelRatio:1.5);
        final data=await image.toByteData(format:ui.ImageByteFormat.png);
        final file=File('build/router-review/layout-a-${width.toInt()}.png');
        await file.parent.create(recursive:true);await file.writeAsBytes(data!.buffer.asUint8List());
      });
      await tester.tap(find.byTooltip('项目操作'));await tester.pumpAndSettle();await tester.tap(find.text('项目进展与审批'));await tester.pumpAndSettle();
      expect(find.byType(NativeRouterPage),findsOneWidget);expect(api.calls,isEmpty);
      await tester.pageBack();await tester.pumpAndSettle();
      expect(find.byType(ConversationPanel),findsOneWidget);expect(c.selectedId,'laptop~desktop:router-fixture');
      await tester.pumpWidget(const SizedBox());c.dispose();await tester.binding.setSurfaceSize(null);
    });
  }
}
