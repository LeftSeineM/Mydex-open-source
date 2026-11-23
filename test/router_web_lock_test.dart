@TestOn('browser')
library;

import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/services/router_web_lock.dart';

void main() {
  test('browser lock rejects concurrent holder and releases after success', () async {
    final entered=Completer<void>(),release=Completer<void>();
    var secondRan=false;
    final first=withRouterWebLock('mydex-test-exclusive',() async {
      entered.complete();await release.future;
    });
    await entered.future;
    await expectLater(withRouterWebLock('mydex-test-exclusive',() async {
      secondRan=true;
    }),throwsStateError);
    expect(secondRan,false);release.complete();await first;
    await withRouterWebLock('mydex-test-exclusive',() async {secondRan=true;});
    expect(secondRan,true);
  });
  test('browser lock releases after failure and other scopes remain independent', () async {
    await expectLater(withRouterWebLock('mydex-test-failure',() async {
      await withRouterWebLock('mydex-test-other',() async {});
      throw StateError('expected failure');
    }),throwsStateError);
    await withRouterWebLock('mydex-test-failure',() async {});
  });
}
