import 'dart:convert';
import 'dart:math';

typedef DshJson = Map<String, dynamic>;

/// A durable draft reservation, independent of sockets or widgets. Keep it in
/// the existing private local storage. `scope` must include gateway/account,
/// device, tool and workspace identity, never just a display name.
class DshCreateOutbox {
  final Future<DshJson?> Function() read;
  final Future<void> Function(DshJson) save;
  Future<void> _tail = Future.value();
  DshCreateOutbox({required this.read, required this.save});
  Future<DshJson> reservations() => _serial(() async =>
      Map<String, dynamic>.from(jsonDecode(jsonEncode(await read() ?? {}))));

  /// Reconnect is query-only, including reservations that had not begun POST.
  Future<DshJson?> recover(
          {required String scope,
          required Future<DshJson> Function(String) lookup}) =>
      _serial(() async {
        final all = await read() ?? {}, value = all[scope];
        if (value is! Map) return null;
        final record = Map<String, dynamic>.from(value);
        if (record['task'] is Map && record['task']['id'] is String) {
          return Map<String, dynamic>.from(record['task']);
        }
        final recovered = await lookup(record['requestId'] as String);
        if (recovered['task'] is! Map || recovered['task']['id'] is! String) {
          return null;
        }
        final task = Map<String, dynamic>.from(recovered['task']);
        record['task'] = task;
        record['state'] = 'resolved';
        all[scope] = record;
        await save(all);
        return task;
      });

  static String requestId() {
    final random = Random.secure();
    return List.generate(
            24, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'))
        .join();
  }

  Future<T> _serial<T>(Future<T> Function() operation) async {
    final previous = _tail;
    final completion = Future<void>.sync(() async {
      await previous;
    });
    // Reserve the tail synchronously before yielding to a competing submit.
    late T result;
    final current = completion.then((_) async {
      result = await operation();
    });
    _tail = current.catchError((_) {});
    await current;
    return result;
  }

  /// Explicit NEW conversation action only. A failed network send is NOT a
  /// new draft. Removing an unresolved reservation is deliberately prohibited.
  Future<void> newDraft(String scope) => _serial(() async {
        final all = await read() ?? {};
        final old = all[scope];
        if (all.containsKey(scope) && (old is! Map || old['task'] is! Map || old['task']['id'] is! String)) {
          throw StateError('上一条新建结果尚未确认，请先恢复原会话');
        }
        all.remove(scope);
        await save(all);
      });

  Future<DshJson> submit({
    required String scope,
    required DshJson body,
    required Future<DshJson> Function(DshJson body, String requestId) post,
    required Future<DshJson> Function(String requestId) lookup,
  }) =>
      _serial(() async {
        final all = await read() ?? {};
        final existing = all[scope];
        if(all.containsKey(scope)&&existing is! Map)throw StateError('新建恢复记录损坏，不会重新创建');
        DshJson record;
        if (existing is Map) {
          record = Map<String, dynamic>.from(existing);
          if (jsonEncode(record['body']) != jsonEncode(body)) {
            throw StateError('该草稿已有新建记录，请先核对原会话，不会另建会话');
          }
          if (record['task'] is Map) {
            return Map<String, dynamic>.from(record['task']);
          }
        } else {
          record = {
            'requestId': requestId(),
            'body': body,
            'state': 'reserved'
          };
          all[scope] = record;
          // No POST may happen if this durable write fails.
          await save(all);
        }
        final key = record['requestId'] as String;
        // A previous submission may already be executing. Reconnect performs a
        // read-only lookup first, not another POST with a fresh or reused key.
        if (record['state'] != 'reserved') {
          final recovered = await lookup(key);
          final task = recovered['task'];
          if (task is! Map || task['id'] is! String) {
            throw StateError('原新建请求仍待核对，不会重复创建');
          }
          record['task'] = Map<String, dynamic>.from(task);
          record['state'] = 'resolved';
          all[scope] = record;
          await save(all);
          return Map<String, dynamic>.from(task);
        }
        record['state'] = 'submitting';
        all[scope] = record;
        await save(all);
        try {
          final task =
              await post(Map<String, dynamic>.from(record['body']), key);
          if (task['id'] is! String) throw StateError('新建未返回原生会话标识');
          record['task'] = task;
          record['state'] = 'resolved';
          all[scope] = record;
          await save(all);
          return task;
        } catch (_) {
          // Keep submitting durable even if saving this diagnostic state fails.
          record['state'] = 'unknown';
          all[scope] = record;
          await save(all);
          rethrow;
        }
      });
}
