import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'controller.dart';
import 'pages/home.dart';
import 'services/storage.dart';
import 'services/web_font.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await prepareWebFont();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      systemNavigationBarColor: Colors.white,
      systemNavigationBarIconBrightness: Brightness.dark,
      statusBarIconBrightness: Brightness.dark));
  final storage = LocalStorage();
  try {
    AppController.superagentTest = await storage.testFeatures(
        seed: const bool.fromEnvironment('MYDEX_SUPERAGENT_TEST'));
  } catch (_) {
    /* Keep existing build default if local preferences are unavailable. */
  }
  final controller = AppController(storage);
  runApp(MydexApp(controller: controller));
  controller.initialize();
}

ThemeData appTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
          seedColor: const Color(0xff91add4),
          brightness: brightness,
          surface: dark ? const Color(0xff181a1d) : Colors.white)
      .copyWith(
    primary: dark ? const Color(0xff9ab4d7) : const Color(0xff41658a),
    onSurface: dark ? const Color(0xffeceef0) : const Color(0xff202123),
    onSurfaceVariant: dark ? const Color(0xffadb1b8) : const Color(0xff646970),
    surfaceTint: Colors.transparent,
    outline: dark ? const Color(0xff656a73) : const Color(0xffb8bcc2),
  );
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: scheme.surface,
    fontFamily: kIsWeb ? 'MydexSans' : 'sans-serif',
    fontFamilyFallback: kIsWeb
        ? const [
            'PingFang SC',
            'Microsoft YaHei',
            'Noto Sans CJK SC',
            'sans-serif'
          ]
        : null,
    appBarTheme: ThemeData().appBarTheme.copyWith(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        toolbarHeight: 64,
        titleSpacing: 4,
        systemOverlayStyle: SystemUiOverlayStyle(
            statusBarColor: Colors.transparent,
            statusBarIconBrightness: dark ? Brightness.light : Brightness.dark,
            statusBarBrightness: dark ? Brightness.dark : Brightness.light,
            systemNavigationBarColor: scheme.surface,
            systemNavigationBarIconBrightness:
                dark ? Brightness.light : Brightness.dark)),
    dividerTheme: DividerThemeData(
        color: scheme.onSurface.withValues(alpha: .08), space: 1),
    textTheme: const TextTheme(
        bodyMedium: TextStyle(fontSize: 15, height: 1.6, letterSpacing: 0),
        bodySmall: TextStyle(fontSize: 12, height: 1.5)),
    inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: dark ? const Color(0xff222529) : const Color(0xfff5f5f5),
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: BorderSide.none),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 18, vertical: 16)),
    filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            minimumSize: const Size(48, 48))),
  );
}

class MydexApp extends StatelessWidget {
  final AppController controller;
  const MydexApp({super.key, required this.controller});
  @override
  Widget build(BuildContext context) => ListenableBuilder(
      listenable: controller,
      builder: (context, _) => MaterialApp(
            title: 'Mydex',
            debugShowCheckedModeBanner: false,
            builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context).copyWith(
                    textScaler: TextScaler.linear(
                        MediaQuery.textScalerOf(context).scale(1) *
                            controller.settings.textScale)),
                child: child!),
            theme: appTheme(Brightness.light),
            darkTheme: appTheme(Brightness.dark),
            themeMode:
                controller.settings.dark ? ThemeMode.dark : ThemeMode.light,
            home: HomePage(controller: controller),
          ));
}
