// ignore_for_file: avoid_web_libraries_in_flutter
import 'dart:js_interop';

@JS('navigator.locks')
external JSObject? get _locks;

extension type _LockManager(JSObject _) implements JSObject {
  external JSPromise<JSAny?> request(
      JSString name, JSObject options, JSFunction callback);
}

@JS()
extension type _Options._(JSObject _) implements JSObject {
  external factory _Options({bool ifAvailable});
}

/// No waiting behind another tab: a queued second click could otherwise
/// become a brand-new operation after the first tab clears its reservation.
Future<void> withRouterWebLock(String name, Future<void> Function() action) async {
  final locks = _locks;
  if (locks == null) throw StateError('当前浏览器不支持安全的多页面提交，请换用新版浏览器');
  Object? failure;
  StackTrace? trace;
  await _LockManager(locks).request(name.toJS, _Options(ifAvailable:true),
    ((JSAny? lock) {
      return (() async {
        try {
          if (lock == null) throw StateError('另一个页面正在处理操作，请稍后核对结果');
          await action();
        } catch (error, stack) {failure=error;trace=stack;}
        return null;
      })().toJS;
    }).toJS).toDart;
  if (failure != null) Error.throwWithStackTrace(failure!, trace!);
}
