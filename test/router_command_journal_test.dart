import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/services/router_command_journal.dart';
import 'package:mydex_mobile/services/api_exception.dart';

void main() {
  test('recovery needs no original body, isolates Router and retains unknown', () async {
    Map<String,dynamic> disk={};var sends=0,queries=0;
    final journal=RouterCommandJournal(read:() async=>jsonDecode(jsonEncode(disk)),save:(v) async{disk=jsonDecode(jsonEncode(v));});
    for(final group in ['one','two']) {
      await expectLater(journal.submit(scope:group,group:group,body:{'operation':'answer'},
        post:(_) async {sends++;throw Exception('lost');},lookup:(_) async=>{}),throwsException);
    }
    final unknown=await journal.recover(group:'one',lookup:(id) async {
      queries++;return {'requestId':id,'status':'not_observed'};});
    expect(unknown.single['status'],'unconfirmed');expect(disk.length,2);
    final resolved=await journal.recover(group:'one',lookup:(id) async {
      queries++;return {'requestId':id,'status':'recorded','result':{'id':'original'}};});
    expect(resolved.single['status'],'resolved');expect(disk.keys,['two']);
    expect(queries,2);expect(sends,2);
  });
  test('explicit validation rejection releases draft but server error does not', () async {
    for (final status in [400,401,403,409,500]) {
      Map<String,dynamic> disk={};
      final journal=RouterCommandJournal(read:() async=>disk,save:(v) async{disk=v;});
      await expectLater(journal.submit(scope:'a',body:{},post:(_) async {
        throw ApiException('rejected',status);
      },lookup:(_) async=>{}),throwsA(isA<ApiException>()));
      expect(disk.isEmpty,[400,401,403].contains(status));
    }
  });
  test('lost response recovers after reopening without repost or secret storage', () async {
    Map<String, dynamic> disk = {};
    var sends = 0;
    String? id;
    RouterCommandJournal open() => RouterCommandJournal(
      read: () async => jsonDecode(jsonEncode(disk)),
      save: (v) async {disk = jsonDecode(jsonEncode(v));});
    final body = {'operation': 'create_job', 'args': {'name': 'private prompt'}};
    Future<Map<String, dynamic>> post(String requestId) async {
      sends++; id = requestId; throw Exception('response lost');
    }
    Future<Map<String, dynamic>> lookup(String requestId) async => {
      'requestId': requestId, 'status': 'recorded', 'result': {'id': 'same-job'}};
    await expectLater(open().submit(scope:'account-router',body:body,post:post,lookup:lookup),throwsException);
    expect(jsonEncode(disk).contains('private prompt'),false);
    expect(id,isNotNull);
    final result = await open().submit(scope:'account-router',body:body,post:post,lookup:lookup);
    expect(result['id'],'same-job');expect(sends,1);expect(disk,isEmpty);
  });
  test('missing receipt and changed payload retain reservation without replay', () async {
    Map<String,dynamic> disk={};var sends=0;
    final journal=RouterCommandJournal(read:() async=>jsonDecode(jsonEncode(disk)),save:(v) async{disk=jsonDecode(jsonEncode(v));});
    Future<Map<String,dynamic>> post(String _) async {sends++;throw Exception('lost');}
    Future<Map<String,dynamic>> lookup(String id) async=>{'requestId':id,'status':'not_observed'};
    await expectLater(journal.submit(scope:'a',body:{'a':1},post:post,lookup:lookup),throwsException);
    await expectLater(journal.submit(scope:'a',body:{'a':1},post:post,lookup:lookup),throwsStateError);
    await expectLater(journal.submit(scope:'a',body:{'a':2},post:post,lookup:lookup),throwsStateError);
    expect(sends,1);expect(disk.length,1);
  });
  test('storage failure prevents submission and dispatch uses native stable ID', () async {
    var sends=0;
    Future<Map<String,dynamic>> post(String _) async {sends++;return {'state':'delivery_unknown'};}
    final broken=RouterCommandJournal(read:() async=>{},save:(_) async{throw Exception('disk full');});
    await expectLater(broken.submit(scope:'a',body:{},post:post,lookup:(_) async=>{}),throwsException);
    expect(sends,0);
    Map<String,dynamic> disk={};
    final journal=RouterCommandJournal(read:() async=>disk,save:(v) async{disk=v;});
    await journal.submit(scope:'a',body:{},receiptId:'native-stable-id',post:post,lookup:(_) async=>{});
    final result=await journal.submit(scope:'a',body:{},post:post,lookup:(id) async {
      expect(id,'native-stable-id');return {'requestId':id,'status':'recorded','task':{'id':'original'}};});
    expect(result['id'],'original');expect(sends,1);
  });
}
