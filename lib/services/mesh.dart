import 'dart:convert';
import 'package:flutter/services.dart';
import '../models.dart';

/// Native app-only network, independent of the user's mini-PC.
class MeshNetwork {
  static const channel = MethodChannel('dev.mydex/mesh');
  static Future<Json> status() async => Map<String, dynamic>.from(
      jsonDecode(await channel.invokeMethod<String>('status') ?? '{}'));
  static Future<void> login() => channel.invokeMethod<void>('login');
  static Future<void> openLogin(String url) =>
      channel.invokeMethod<void>('openLogin', {'url': url});
  static Future<Json> route(Uri uri) async =>
      Map<String, dynamic>.from(jsonDecode(await channel.invokeMethod<String>(
              'route', {'host': uri.host, 'port': uri.port}) ??
          '{}'));
}
