import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/pages/native_router.dart';
import 'package:mydex_mobile/services/router_command_journal.dart';
import 'native_router_test.dart' show RouterFixtureApi;
import 'client_test.dart' show fixture;

class ScopedRouterApi extends RouterFixtureApi {
  final reads = <String>[];
  @override
  Future<Json> post(String path, Json body, {String? requestId}) async {
    if (body['operation'] == 'catalog') {
      calls.add(body);
      return {'sessions': [{'key': 'other~session', 'title': '另一Worker',
        'toolId': 'codex', 'device': 'other', 'capabilities': {'send': 'supported'}}],
        'workspaces': []};
    }
    return super.post(path, body, requestId: requestId);
  }
  @override
  Future<Json> get(String path) async {
    final data = await super.get(path);
    (data['jobs'] as List).add({
      'id': 'other-job',
      'name': '另一项目',
      'scope': ['other~session'],
      'paused': false
    });
    (data['tasks'] as List).add({
      'id': 'other-task',
      'job': 'other-job',
      'session': 'other~session',
      'state': 'queued',
      'package': {'goal': '另一个项目的任务'},
      'node': {'toolId': 'codex', 'device': 'other'}
    });
    return data;
  }

  @override
  Future<Uint8List> bytes(String path,
      {String method = 'GET', Json? body, String? requestId}) async {
    reads.add(path);
    return Uint8List.fromList(utf8.encode(jsonEncode([
      {'id': 1, 'kind': 'job_created', 'at': 1794564000000}
    ])));
  }
}

class AcceptanceRouterApi extends RouterFixtureApi {
  @override
  Future<Json> get(String path) async {
    final data = await super.get(path);
    final task = (data['tasks'] as List).first as Map;
    task['state'] = 'completion_claim';
    task['observed'] = {
      'messageRefs': ['own-prompt', 'worker-result']
    };
    return data;
  }

  @override
  Future<Json> post(String path, Json body, {String? requestId}) async {
    calls.add(body);
    if (body['operation'] == 'read_session') {
      return {
        'messages': [
          {'id': 'own-prompt', 'role': 'user', 'text': '用户原任务不是验收证据'},
          {'id': 'worker-result', 'role': 'agent', 'text': '已测量标定误差为 0.2 毫米'},
        ]
      };
    }
    return {};
  }
}

class InteractionRouterApi extends RouterFixtureApi {
  @override
  Future<Json> get(String path) async {
    final data = await super.get(path);
    final task = (data['tasks'] as List).first as Map;
    task['state'] = 'waiting_question';
    task['observation'] = {
      'status': 'unavailable',
      'lastSuccessAt': 1794564000000
    };
    task['observed'] = {
      'recentUpdates': [
        {
          'ref': 'native-result-1',
          'excerpt': '最新标定检查结果，等待用户选择',
          'truncated': false
        }
      ]
    };
    task['node'] = <String, dynamic>{
      ...Map<String, dynamic>.from(task['node'] as Map),
      'capabilities': {'answer': 'supported', 'cancel': 'unsupported'}
    };
    return data;
  }

  @override
  Future<Json> post(String path, Json body, {String? requestId}) async {
    calls.add(body);
    if (body['operation'] == 'read_session') {
      return {
        'messages': [],
        'interactions': [
          {
            'id': 'question-native-1',
            'revision': 'revision-exact-1',
            'kind': 'question',
            'questions': [
              {'id': 'target', 'question': '这次选择哪个验收目标？', 'options': []}
            ]
          }
        ]
      };
    }
    return {};
  }
}

class RecoveryRouterApi extends RouterFixtureApi {
  @override
  Future<Json> post(String path, Json body, {String? requestId}) async {
    calls.add(body);
    if (body['operation'] != 'command_receipt') throw StateError('Unexpected mutation');
    return {'requestId':body['args']['requestId'], 'status':'recorded',
      'result':{'id':'original-job'}};
  }
}

class RestartedRouterApi extends RouterFixtureApi {
  @override
  Future<Json> get(String path) async {
    final data=await super.get(path),task=(data['tasks'] as List).first as Map;
    task['state']='human_intervention';task['reason']='Worker instance changed';
    task['node']={...task['node'] as Map,'generation':'before-restart'};
    return data;
  }
  @override
  Future<Json> post(String path,Json body,{String? requestId}) async {
    calls.add(body);
    if(body['operation']=='read_session') return {'generation':'after-restart',
      'messages':[{'role':'agent','text':'原任务的测试结果'}]};
    return {'id':'task','state':'awaiting_observation'};
  }
}

class ReadingRouterApi extends RouterFixtureApi {
  bool acknowledged=false;
  @override Future<Json> get(String path) async {
    final data=await super.get(path);
    (data['jobs'] as List).first['routerReading']={
      'status':acknowledged?'caught_up':'unread','unread':acknowledged?0:3,
      'lastReadAt':acknowledged?1794564000000:null};
    return data;
  }
}

void main() {
  testWidgets('progress read status follows server acknowledgement and viewing never writes', (tester) async {
    final c=fixture(),api=ReadingRouterApi();c.api=api;
    await tester.binding.setSurfaceSize(const Size(760,940));
    await tester.pumpWidget(MaterialApp(home:NativeRouterPage(controller:c)));
    await tester.pumpAndSettle();
    expect(find.text('有 3 条进展尚未由 Router 确认读取'),findsOneWidget);
    expect(api.calls,isEmpty);
    api.acknowledged=true;await tester.tap(find.byIcon(Icons.refresh));await tester.pumpAndSettle();
    expect(find.text('Router 已确认读取当前记录（不代表结果已验收）'),findsOneWidget);
    expect(api.calls,isEmpty);expect(tester.takeException(),isNull);
    await tester.pumpWidget(const SizedBox());c.dispose();await tester.binding.setSurfaceSize(null);
  });
  testWidgets('instance confirmation shows original history and only submits exact identity after user confirmation', (tester) async {
    final c=fixture(),api=RestartedRouterApi();c.api=api;
    await tester.binding.setSurfaceSize(const Size(760,940));
    await tester.pumpWidget(MaterialApp(home:NativeRouterPage(controller:c)));
    await tester.pumpAndSettle();
    await tester.tap(find.text('核对重启后的连接'));await tester.pumpAndSettle();
    expect(find.text('原任务的测试结果'),findsOneWidget);
    expect(api.calls.map((c)=>c['operation']).toList(),['read_session']);
    await tester.tap(find.text('确认原会话，恢复观察'));await tester.pumpAndSettle();
    expect(api.calls.last,{'operation':'confirm_instance','args':{
      'taskId':'task','previousGeneration':'before-restart','generation':'after-restart'}});
    expect(tester.takeException(),isNull);
    await tester.pumpWidget(const SizedBox());c.dispose();await tester.binding.setSurfaceSize(null);
  });
  testWidgets('pending operation button queries receipt without resubmitting original action', (tester) async {
    final c=fixture(), api=RecoveryRouterApi();c.api=api;
    final group=RouterCommandJournal.digest({'gateway':c.settings.baseUrl,
      'credential':c.settings.token,
      'router':{'device':'laptop','session':'desktop:router-fixture'}});
    await expectLater(c.routerJournal.submit(scope:'pending-test',group:group,
      body:{'operation':'create_job','args':{'name':'private'}},
      post:(_) async {throw Exception('response lost');},lookup:(_) async=>{}),throwsException);
    await tester.pumpWidget(MaterialApp(home:NativeRouterPage(controller:c)));
    await tester.pumpAndSettle();
    await tester.tap(find.text('核对未决操作'));await tester.pumpAndSettle();
    expect(find.textContaining('创建项目：已查到回执'),findsOneWidget);
    expect(api.calls.length,1);expect(api.calls.single['operation'],'command_receipt');
    await tester.tap(find.text('知道了'));await tester.pumpAndSettle();
    expect(tester.takeException(),isNull);
    await tester.pumpWidget(const SizedBox());c.dispose();
  });
  testWidgets(
      'acceptance requires checked original agent evidence and a user verdict',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(760, 940));
    final c = fixture(), api = AcceptanceRouterApi();
    c.api = api;
    await tester.pumpWidget(MaterialApp(home: NativeRouterPage(controller: c)));
    await tester.pumpAndSettle();
    await tester.tap(find.text('核对并验收'));
    await tester.pumpAndSettle();
    expect(find.byType(CheckboxListTile), findsOneWidget);
    expect(find.text('用户原任务不是验收证据'), findsNothing);
    expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, '确认验收'))
            .onPressed,
        isNull);
    await tester.tap(find.byType(CheckboxListTile));
    await tester.enterText(
        find.byKey(const ValueKey('router-acceptance-verdict')),
        '核对误差低于 0.5 毫米标准');
    await tester.pumpAndSettle();
    await tester.tap(find.text('确认验收'));
    await tester.pumpAndSettle();
    expect(api.calls.last, {
      'operation': 'accept',
      'args': {
        'taskId': 'task',
        'verdict': '核对误差低于 0.5 毫米标准',
        'evidence': [
          {'ref': 'worker-result', 'verified': true}
        ]
      }
    });
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  });
  testWidgets(
      'unavailable observation is honest, excerpts fold, and answer binds exact native interaction',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 940));
    final c = fixture(), api = InteractionRouterApi();
    c.api = api;
    await tester.pumpWidget(MaterialApp(home: NativeRouterPage(controller: c)));
    await tester.pumpAndSettle();
    expect(find.textContaining('暂时无法读取原会话'), findsOneWidget);
    expect(find.textContaining('上次状态：待回答'), findsOneWidget);
    expect(find.text('最新标定检查结果，等待用户选择'), findsNothing);
    final unsupported = find.widgetWithText(TextButton, '原工具暂不支持取消');
    expect(tester.widget<TextButton>(unsupported).onPressed, isNull);
    await tester.tap(find.text('查看原对话'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('回答问题'));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byKey(const ValueKey('answer:target')), '先检查标定精度');
    await tester.pumpAndSettle();
    await tester.tap(find.text('提交回答'));
    await tester.pumpAndSettle();
    expect(api.calls.last, {
      'operation': 'answer',
      'args': {
        'taskId': 'task',
        'interactionId': 'question-native-1',
        'revision': 'revision-exact-1',
        'response': {
          'decision': 'answer',
          'answers': {
            'target': {
              'answers': ['先检查标定精度']
            }
          }
        }
      }
    });
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  });
  testWidgets(
      'project selection isolates tasks and timeline reads only selected project',
      (tester) async {
    final c = fixture(), api = ScopedRouterApi();
    c.api = api;
    await tester.pumpWidget(MaterialApp(home: NativeRouterPage(controller: c)));
    await tester.pumpAndSettle();
    expect(find.text('另一个项目的任务'), findsNothing);
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('另一项目').last);
    await tester.pumpAndSettle();
    expect(find.text('另一个项目的任务'), findsOneWidget);
    expect(find.text('核对碰撞边界与测试证据'), findsNothing);
    expect(
        tester
            .widget<TextButton>(find.widgetWithText(TextButton, '派发'))
            .onPressed,
        isNull);
    await tester.tap(find.text('仅观察 · 设置执行授权'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(CheckboxListTile));
    await tester.tap(find.text('保存授权'));
    await tester.pumpAndSettle();
    final grants = api.calls.where((c) => c['operation'] == 'set_execution');
    expect(grants.length, 1);
    expect(grants.single['args'], {
      'jobId': 'other-job',
      'expectedRevision': 0,
      'sessions': ['other~session'],
      'workspaces': [],
      'maxNewWindows': 3,
      'inheritCreatedWorkers': false
    });
    api.calls.clear();
    await tester.tap(find.text('进展时间线'));
    await tester.pumpAndSettle();
    expect(api.reads.single, contains('jobId=other-job'));
    expect(api.calls, isEmpty);
    expect(find.text('项目已创建'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
}
