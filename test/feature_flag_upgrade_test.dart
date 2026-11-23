import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:mydex_mobile/services/storage.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
      'stable installs keep an already seeded private feature flag; fresh installs hide it',
      () async {
    FlutterSecureStorage.setMockInitialValues({});
    expect(await LocalStorage().testFeatures(), false);
    expect(await LocalStorage().testFeatures(seed: true), true);
    expect(await LocalStorage().testFeatures(seed: false), true);
    FlutterSecureStorage.setMockInitialValues({});
    expect(await LocalStorage().testFeatures(seed: false), false);
  });
}
