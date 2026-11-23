// Browser-only implementation selected by a conditional export.
// ignore_for_file: avoid_web_libraries_in_flutter
// Browsers manage ping/pong themselves; keep the native controller interface.
import 'dart:async';
import 'dart:html' as html;

class WebSocket extends Stream<dynamic> {
  final html.WebSocket socket;
  final StreamController<dynamic> events = StreamController<dynamic>();
  WebSocket(this.socket) {
    socket.onMessage.listen((event) => events.add(event.data));
    socket.onError.listen((event) => events.addError(StateError('连接中断')));
    socket.onClose.listen((_) => events.close());
  }
  set pingInterval(Duration? value) {}
  void add(dynamic value) => socket.send(value);
  Future<void> close() async => socket.close();
  @override
  StreamSubscription<dynamic> listen(void Function(dynamic)? onData,
          {Function? onError, void Function()? onDone, bool? cancelOnError}) =>
      events.stream.listen(onData, onError: onError, onDone: onDone,
          cancelOnError: cancelOnError);
}
