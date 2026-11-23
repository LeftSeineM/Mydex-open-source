import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'dsh_create_outbox.dart' show DshCreateOutbox;
import 'api_exception.dart';

typedef RouterJson = Map<String, dynamic>;

/// Separate from the native-session creation journal. Store identity and a
/// payload digest only: no prompts, approval answers, credentials or history.
class RouterCommandJournal {
  final Future<RouterJson?> Function() read;
  final Future<void> Function(RouterJson) save;
  final Future<void> Function(Future<void> Function())? lock;
  Future<void> _tail = Future.value();
  RouterCommandJournal({required this.read, required this.save, this.lock});

  Future<T> _serial<T>(Future<T> Function() action) {
    final work = _tail.then((_) async {
      if (lock == null) return action();
      late T result;
      await lock!(() async {result = await action();});
      return result;
    });
    _tail = work.then<void>((_) {}, onError: (Object _, StackTrace __) {});
    return work;
  }

  /// Queries only the current authenticated Router's outstanding requests.
  /// An absent receipt remains pending; it never authorizes replay.
  Future<List<RouterJson>> recover({required String group,
      required Future<RouterJson> Function(String) lookup}) => _serial(() async {
    final records = await read();
    if (records == null) throw StateError('操作恢复记录不可用');
    final results = <RouterJson>[];
    for (final scope in records.keys.toList()) {
      final record = records[scope];
      if (record is! Map) throw StateError('操作恢复记录损坏');
      if (record['group'] != group) continue;
      final id = record['receiptId'];
      if (id is! String) throw StateError('操作恢复记录损坏');
      RouterJson receipt;
      try {
        receipt = await lookup(id);
        if (receipt['requestId'] != id) throw StateError('回执身份不匹配');
      } catch (_) {
        results.add({'operation':record['operation'], 'status':'unavailable'});
        continue;
      }
      final resolved = ['recorded','cancelled'].contains(receipt['status']) &&
          (receipt['task'] is Map || receipt['result'] is Map);
      if (resolved) {
        records.remove(scope);
        await save(records);
      }
      results.add({'operation':record['operation'],
        'status': resolved ? 'resolved' : 'unconfirmed'});
    }
    return results;
  });

  static String digest(dynamic value) =>
      sha256.convert(utf8.encode(jsonEncode(_canonical(value)))).toString();
  static dynamic _canonical(dynamic value) {
    if (value is Map) {
      final keys = value.keys.cast<String>().toList()..sort();
      return {for (final key in keys) key: _canonical(value[key])};
    }
    if (value is List) return value.map(_canonical).toList();
    return value;
  }

  Future<RouterJson> submit({
    required String scope,
    required RouterJson body,
    String? group,
    String? receiptId,
    required Future<RouterJson> Function(String) post,
    required Future<RouterJson> Function(String) lookup,
  }) {
    return _serial(() async {
      final records = await read();
      if (records == null) throw StateError('操作恢复记录不可用');
      final fingerprint = digest(body);
      if (records.containsKey(scope)) {
        final old = records[scope];
        if (old is! Map || old['digest'] is! String ||
            old['requestId'] is! String || old['receiptId'] is! String) {
          throw StateError('操作恢复记录损坏，未重新发送');
        }
        if (old['digest'] != fingerprint) {
          throw StateError('此处上一项操作尚未确认，请先核对原操作');
        }
        final receipt = await lookup(old['receiptId'] as String);
        if (receipt['requestId'] != old['receiptId'] ||
            !['recorded', 'cancelled'].contains(receipt['status'])) {
          throw StateError('操作结果仍未确认，未重新发送');
        }
        final result = receipt['task'] ?? receipt['result'];
        if (result is! Map) throw StateError('回执缺少操作结果');
        records.remove(scope);
        await save(records);
        return Map<String, dynamic>.from(result);
      }
      final requestId = DshCreateOutbox.requestId();
      records[scope] = {
        'requestId': requestId,
        'receiptId': receiptId ?? requestId,
        'digest': fingerprint,
        if (group != null) 'group': group,
        'operation': body['operation'],
      };
      // Fail before I/O if persistence fails. Any uncertain response retains
      // this reservation, including a crash before POST actually begins.
      await save(records);
      RouterJson result;
      try {
        result = await post(requestId);
      } on ApiException catch (error) {
        // These are gateway pre-dispatch validation/auth rejections. Conflicts,
        // timeouts and server errors remain unresolved and must not be replayed.
        if ([400, 401, 403].contains(error.status)) {
          records.remove(scope);
          await save(records);
        }
        rethrow;
      }
      if (!['delivery_unknown', 'dispatching', 'cancel_requested']
          .contains(result['state'])) {
        records.remove(scope);
        await save(records);
      }
      return result;
    });
  }
}
