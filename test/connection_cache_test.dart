import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/controller.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/storage.dart';
import 'package:mydex_mobile/services/router_command_journal.dart';
class MemoryCache extends LocalStorage {
 final String identity;
 MemoryCache(this.identity);
 @override Future<ConnectionSettings> settings() async=>const ConnectionSettings(baseUrl:'https://fixture.invalid',token:'current');
 @override Future<List<Json>> profiles() async=>[{'baseUrl':'https://fixture.invalid'}];
 @override Future<Json?> readCache() async=>{'baseUrl':'https://fixture.invalid','identity':identity,'tasks':[{'id':'cached'}],
  'projects':[{'id':'p'}],'tools':[{'id':'codex'}],'devices':[{'id':'pc','online':true,'desktopOnline':true}]};
}
class OfflineController extends AppController {
 OfflineController(super.storage);
 @override Future<void> reconnect() async {}
}
void main(){
 test('matching account metadata is visible but cached computer remains offline',() async {
  final c=OfflineController(MemoryCache(RouterCommandJournal.digest({'url':'https://fixture.invalid','token':'current'})));
  await c.initialize();expect(c.cached,true);expect(c.projects.single['id'],'p');expect(c.devices.single['online'],false);expect(c.connected,false);c.dispose();
 });
 test('another credential on the same address cannot reuse cached conversations',() async {
  final c=OfflineController(MemoryCache(RouterCommandJournal.digest({'url':'https://fixture.invalid','token':'previous'})));
  await c.initialize();expect(c.tasks,isEmpty);expect(c.projects,isEmpty);expect(c.tools,isEmpty);c.dispose();
 });
}
