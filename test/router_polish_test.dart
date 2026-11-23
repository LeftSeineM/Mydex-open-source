import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/main.dart' show appTheme;
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/pages/router_workspace.dart';
import 'package:mydex_mobile/pages/native_router.dart';
import 'client_test.dart' show fixture;
import 'router_workspace_test.dart' show WorkspaceApi;

class PolishApi extends WorkspaceApi {
 @override Future<Json> get(String path) async {
  final value=await super.get(path);
  if(path.startsWith('/api/tasks/')) return value;
  value['jobs']=[{...value['jobs'][0],'name':'机械臂协作 · 私测示例','scope':['laptop~desktop:worker','laptop~desktop:review'],
    'nodes':[{'key':'laptop~desktop:review','title':'验证长标题在窄屏中的展示与中文换行，不改变原始记录','toolId':'deepseek'}],
    'resources':[{'id':'gpu','name':'GPU 实验服务器'}]}];
  value['tasks']=[{...value['tasks'][0],'state':'waiting_approval'},
    {'id':'foreign','job':'other','state':'waiting_approval'}];
  return value;
 }
}
void main(){
 setUpAll(() async {
  await (FontLoader('Chinese')..addFont(Future.value(ByteData.sublistView(await File('C:/Windows/Fonts/msyh.ttc').readAsBytes())))).load();
  await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(await File('D:/Software/NFSeeBuild/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf').readAsBytes())))).load();
 });
 for(final width in [360.0,390.0,760.0]) {
  testWidgets('embedded polish real scope, attention and navigation at $width',(tester) async {
   await tester.binding.setSurfaceSize(Size(width,940));
   final c=fixture(),api=PolishApi();c.api=api;c.connected=true;
   c.devices=[{'id':'laptop','name':'测试电脑','online':true,'desktopOnline':true}];
   c.tools=[{'id':'codex','deviceId':'laptop','name':'Codex','capabilities':{'send':true}}];
   await tester.pumpWidget(MaterialApp(theme:appTheme(Brightness.light).copyWith(textTheme:appTheme(Brightness.light).textTheme.apply(fontFamily:'Chinese')),home:RepaintBoundary(key:const ValueKey('capture'),child:RouterWorkspacePage(controller:c))));
   await tester.pumpAndSettle();
   expect(find.text('1 项需要你决定'),findsOneWidget);expect(find.text('2 项需要你决定'),findsNothing);
   Future<void> capture(String name) async {
    expect(tester.takeException(),isNull);
    final boundary=tester.renderObject<RenderRepaintBoundary>(find.byKey(const ValueKey('capture')));
    await tester.runAsync(() async {final image=await boundary.toImage(pixelRatio:1.5);final bytes=await image.toByteData(format:ui.ImageByteFormat.png);final f=File('build/ui-polish-v026/${width.toInt()}-$name.png');await f.parent.create(recursive:true);await f.writeAsBytes(bytes!.buffer.asUint8List());image.dispose();});
   }
   await capture('chat');
   await tester.tap(find.text('1 项需要你决定'));await tester.pumpAndSettle();
   expect(tester.widget<NativeRouterPage>(find.byType(NativeRouterPage)).initialJobId,'job');
   await tester.pageBack();await tester.pumpAndSettle();
   await tester.tap(find.byTooltip('执行网络'));await tester.pumpAndSettle();
   await capture('network');
   await tester.tap(find.byType(Checkbox).first);await tester.pump();
   await tester.ensureVisible(find.text('问 Router'));await tester.tap(find.text('问 Router'));await tester.pumpAndSettle();
   expect(c.drafts[c.selectedId],contains('laptop~desktop:worker'));expect(api.calls,isEmpty);
   await tester.tap(find.byTooltip('Open navigation menu'));await tester.pumpAndSettle();
   await capture('sidebar');
   expect(find.text('新建 / 管理 Router 项目'),findsOneWidget);
   await tester.pumpWidget(const SizedBox());c.dispose();await tester.binding.setSurfaceSize(null);
  });
 }
}
