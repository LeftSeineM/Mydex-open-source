# 构建 Mydex

## Android

安装 Flutter 3.27.4 stable、JDK 21 和 Android SDK 35，并使 flutter 在 PATH 中可用。执行 `flutter doctor -v` 确认工具链。首次构建需要联网下载依赖。

```powershell
flutter pub get
flutter analyze
flutter test --exclude-tags golden
flutter build apk --release
```

APK 位于 `build/app/outputs/flutter-apk/app-release.apk`。发布版建议创建自己的签名密钥，在 `android/key.properties` 配置：

```properties
storeFile=D:/Software/MydexSigning/release.jks
storePassword=YOUR_KEYSTORE_PASSWORD
keyAlias=mydex
keyPassword=YOUR_KEY_PASSWORD
```

没有签名配置时使用本机调试签名。自己编译的不同签名 APK 不能直接覆盖项目发布的 APK。不要提交 key.properties 或签名私钥。

截图基准使用 Windows 字体与演示数据；其他系统默认跳过 golden 标签。重新生成前在 Windows 配好字体，并设置 `FLUTTER_ROOT` 指向 SDK，再运行 `flutter test --update-goldens --tags golden`。不要将不同字体导致的变化当作功能失败。

## Windows 桌面连接器

需要 Windows x64、Node.js 25.6（或兼容且支持 node:sqlite 的运行时）、.NET Framework 4.x C# 编译器。安装包额外需要 NSIS 3。

```powershell
cd gateway
npm ci
npm test
cd ..
powershell -ExecutionPolicy Bypass -File tools/build-desktop.ps1 -NodeExe D:\Software\node\node.exe
# 生成安装包（可选）：
powershell -ExecutionPolicy Bypass -File tools/build-desktop.ps1 -NodeExe D:\Software\node\node.exe -Makensis D:\Software\NSIS\makensis.exe
```

输出目录为 `build/desktop-v0420`，启动其中的 `Mydex.exe`。安装包位于 `dist/Mydex-0.4.20-Setup.exe`。图形界面首次使用会创建独立配置，电脑之间不需要连接。

电脑服务需要调用当前用户的工具。Codex 桌面需运行；CLI 需在本机先完成自己的账号配置。不要把连接器作为不可信用户共用的公共服务。

## 手机更新入口

把已签名 APK 放到连接器配置目录的 `gateway/private/updates/update.apk`，并提供 `manifest.json`：

```json
{"version":"0.2.4","versionCode":7,"size":123,"sha256":"APK_SHA256","notes":["本次变更"]}
```

size 必须是实际字节数，sha256 必须匹配实际文件。构建号必须递增，签名必须与已安装版本一致。通过 HTTPS 的 `/api/update` 和 `/api/update/apk` 提供清单与文件，二者均要求 Bearer 鉴权。先替换 APK，再替换清单，发布前检查文件校验值。

## 可选下一步建议（0.2.7 / 0.4.5）

在电脑私有目录放置 `prediction.json`，字段为 `baseUrl`（HTTPS、OpenAI Chat Completions 兼容地址，通常以 `/v1` 结尾）、`key`、`model`。在该电脑网关私有 `config.json` 增加 `predictionFile`，值为此文件绝对路径，然后退出并重启 Mydex。不要将这两个文件上传到公开仓库。第三方模型必须支持 `/chat/completions`；失败时手机显示提示，可继续手动输入。
