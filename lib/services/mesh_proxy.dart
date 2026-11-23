import 'dart:io';

/// CONNECT keeps TLS end-to-end: certificate pinning stays in GatewayApi.
void configureMeshProxy(HttpClient client, String endpoint, String password) {
  final proxy = Uri.parse('http://$endpoint');
  if (proxy.host != '127.0.0.1' ||
      proxy.port <= 0 ||
      !RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(password)) {
    throw const FormatException('Invalid private mesh endpoint');
  }
  // Dart's CONNECT handshake needs credentials in the proxy configuration;
  // addProxyCredentials alone is not applied to the initial CONNECT request.
  client.findProxy = (_) => 'PROXY mydex:$password@${proxy.host}:${proxy.port}';
}
