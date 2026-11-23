import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_webrtc/flutter_webrtc.dart';

const _label = 'mydex-tls-v1';
const _open = RTCDataChannelState.RTCDataChannelOpen;
const _closed = RTCDataChannelState.RTCDataChannelClosed;

class P2pTransport {
  P2pTransport(this._signal);
  final Future<Map<String, dynamic>> Function(String) _signal;
  RTCPeerConnection? _peer;
  bool _ready = false;
  bool _starting = false;
  bool _disposed = false;
  bool get isReady => _ready && !_disposed;
  DateTime _retryAfter = DateTime.fromMillisecondsSinceEpoch(0);

  Future<void> warm() async {
    if (_disposed || _ready || _starting || DateTime.now().isBefore(_retryAfter)) return;
    _starting = true;
    RTCPeerConnection? created;
    try {
      await _peer?.dispose();
      final peer = created = await createPeerConnection({
        'iceServers': [{'urls': 'stun:stun.cloudflare.com:3478'}],
      });
      if (_disposed) throw StateError('P2P closed');
      _peer = peer;
      peer.onConnectionState = (state) {
        if (_peer != peer) return;
        if (state != RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
          _ready = false;
        }
      };
      final probe = await peer.createDataChannel(_label, RTCDataChannelInit());
      try {
        await peer.setLocalDescription(await peer.createOffer());
        for (var i = 0; i < 32 && !_disposed; i++) {
          if (await peer.getIceGatheringState() == RTCIceGatheringState.RTCIceGatheringStateComplete) break;
          await Future<void>.delayed(const Duration(milliseconds: 125));
        }
        final description = await peer.getLocalDescription();
        final sdp = description?.sdp;
        if (_disposed || sdp == null || !sdp.contains('a=candidate:')) throw StateError('No direct candidate');
        final answer = await _signal(sdp).timeout(const Duration(seconds: 25));
        if (_disposed) throw StateError('P2P closed');
        await peer.setRemoteDescription(RTCSessionDescription(answer['sdp'] as String, 'answer'));
        for (var i = 0; i < 60 && !_disposed; i++) {
          if (probe.state == _open) break;
          await Future<void>.delayed(const Duration(milliseconds: 125));
        }
        if (_disposed || probe.state != _open) throw StateError('Direct connection unavailable');
        _ready = true;
      } finally {
        await probe.close();
      }
    } catch (_) {
      if (identical(_peer, created)) _peer = null;
      try { await created?.dispose(); } catch (_) {}
      _ready = false;
      _retryAfter = DateTime.now().add(const Duration(minutes: 1));
    } finally {
      _starting = false;
    }
  }

  Future<P2pStream?> open() async {
    final peer = _peer;
    if (!_ready || peer == null || _disposed) return null;
    P2pStream? stream;
    try {
      stream = P2pStream(await peer.createDataChannel(_label, RTCDataChannelInit()));
      await stream.ready.future.timeout(const Duration(milliseconds: 900));
      return stream;
    } catch (_) {
      stream?.close();
      _ready = false;
      _retryAfter = DateTime.now().add(const Duration(seconds: 15));
      return null;
    }
  }

  void close() {
    _disposed = true;
    _ready = false;
    unawaited(_peer?.dispose());
    _peer = null;
  }
}

class P2pStream {
  P2pStream(this.channel) {
    channel.onMessage = (message) {
      if (!message.isBinary) {
        if (message.text == 'ready' && !ready.isCompleted) { ready.complete(); return; }
        if (message.text == 'end' && ready.isCompleted) {
          unawaited(_socket?.close());
          return;
        }
        close();
        return;
      }
      final socket = _socket;
      if (socket == null || message.binary.length > 16384) { close(); return; }
      socket.add(message.binary);
    };
    channel.onDataChannelState = (state) { if (state == _closed) close(); };
  }
  final RTCDataChannel channel;
  final ready = Completer<void>();
  Socket? _socket;
  bool _ended = false;
  void attach(Socket socket, void Function() done) {
    _socket = socket;
    if (_ended) { socket.destroy(); done(); return; }
    unawaited(_forward(socket, done));
  }
  Future<void> _forward(Socket socket, void Function() done) async {
    try {
      await for (final bytes in socket) {
        for (var offset=0; offset<bytes.length; offset+=16384) {
          final deadline = DateTime.now().add(const Duration(seconds: 10));
          while (await channel.getBufferedAmount() > 256*1024) {
            if (_ended || DateTime.now().isAfter(deadline)) throw StateError('P2P stream stalled');
            await Future<void>.delayed(const Duration(milliseconds: 25));
          }
          final end = offset+16384 < bytes.length ? offset+16384 : bytes.length;
          await channel.send(RTCDataChannelMessage.fromBinary(Uint8List.sublistView(bytes,offset,end)));
        }
      }
      if (!_ended) await channel.send(RTCDataChannelMessage('end'));
    } catch (_) {
      // Discard this connection. Higher layers keep their existing mutation retry policy.
    } finally { close(); done(); }
  }
  void close() {
    if (_ended) return;
    _ended = true;
    if (!ready.isCompleted) ready.completeError(StateError('P2P channel closed'));
    _socket?.destroy();
    unawaited(channel.close());
  }
}
