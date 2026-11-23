# iOS 免费试装准备 · v0.3 · 2026-10-30

## 2026-10-30 继续核查

- 第二轮原生测试 `40998252116` 已在 iPhone 17 / iOS 27.2 模拟器成功启动应用，Keychain 写入/读取/删除、版本接口和震动方法调用通过；首次启动截图已保存。整轮仍失败：设置页下方的版本提示尚未滚动进入构建范围。测试已增加滚动定位及设置页顶部截图，需重跑，不能把这轮报告为全部通过。
- 修复后的 release 构建 `40998677231` 成功；下载后的 SHA-256 与构建清单一致：`4b1713026af114bf0da2cd6d71585e0a2764ca36521a3d3aa402cc01e594f559`。它仍是未签名 IPA，没有作为可安装版本发布。
- 新核查 https://www.23-3.com/ 及 https://udid.23-3.com/ ：首页写每个 QQ 号可免费获取一次签名码，领取页写 QQ 群每周六免费发放，但必须提交 iPhone UDID 和签名码。https://qm.23-3.com/ 的签名页仍要求 IPA、证书和描述文件。未领取、未提交个人信息；这不是任意接收者直接安装的统一证书。
- https://sign.drnrt8.cn/ 的全能签主页区分免费签名工具与购买 P12 证书兑换码；https://signer.certdrop.app/ 明确免费的是签名工具，证书需要包含设备 UDID，另售设备证书。均不能按“免费工具”推定已提供免费公众分发证书。
- SignTools 开源项目说明免费开发者账号仍需要电脑安装：https://github.com/aldammit/SignTools 。Scarlet 与 OSSign 本机主页请求返回 403；未绕过，也没有取得可验证的签名材料。以上均为网页核查，不是 iPhone 安装实测。

- 源码仓库已迁移到私有 `LeftSeineM/Mydex-mobile-source`，下载仓库仍为 `LeftSeineM/Mydex-mobile`。原模拟器运行 `40913896478` 实际状态为 cancelled，不能再表述为持续运行或已经通过。
- 测试 `40986155555` 在编译成功后无法完成启动连接，停止运行并保留日志；测试 `40988254018` 明确报告未采用 iOS 27 要求的 UIScene 生命周期，启动失败。两个运行均不能算通过。
- 已按 Flutter 官方指南迁移 AppDelegate、插件和原生通道初始化，加入 Scene Manifest。修复验证运行：`https://github.com/LeftSeineM/Mydex-mobile-source/actions/runs/40998252116`。指南：`https://docs.flutter.dev/release/breaking-changes/uiscenedelegate`。
- EonHub 首页声称免费签自己的 IPA。只读检查其 `eonhub.mobileconfig` 发现 WebClip、DNS 和应用限制 payload；DNS 将苹果 OCSP、CRL、App Attest 等域名交给第三方 DNS。没有安装此描述文件。
- 实际读取 `https://main.eonhubapp.com/api/signer/pool`：30 个条目，服务方全部报告 `revoked`。这是供应方状态，不是本机苹果 OCSP 独立验证。没有上传 Mydex、下载私钥或尝试使用这些第三方身份签名。
- UnKeySign FAQ 明确说明免费的是工具，仍需自备 P12 和描述文件；网页只签其自有工具，签其他 IPA 需要手机端工具。来源：`https://unkeysign.com/faq`。
- 仍没有获得可为 Mydex 统一分发使用的有效免费签名材料。没有新增已签名发布版本，也没有完成真机安装验证。

本轮开始准备 iOS 工程，延续 Android 0.2.4 的 Flutter 界面。尚未完成有效证书签名或真机安装，不能直接发送给普通用户安装。

## 构建

GitHub Actions 手动运行 `iOS unsigned preview`，使用 Flutter 3.47.0 和 Xcode 27 runner。iOS 工程现在需要支持 UIScene 的 Flutter SDK；Android 现有构建链未升级。输出 `Mydex-iOS-UNSIGNED.ipa`、SHA-256 与说明文件。IPA 中包含 iPhone release 编译产物，但没有安装所需的签名。

在 Mac 本地运行：

```sh
flutter pub get
flutter build ios --release --no-codesign
```

最低 iOS 15（适配 Xcode 27 的最低编译目标）；复用手机图标、Keychain token 存储和独立电脑配对。iOS 不请求 Android 更新接口，不下载 APK。连接局域网电脑时系统可能请求本地网络权限。尚未验证真机网络、Keychain、审批震动和原会话同步。

## 本轮免费来源核查

- https://xsign.co/home.html ：网页源码包含免费企业版文案，但对应模块 `module_hidden_enterprise` 设为 `v-if="false"`。不能据搜索摘要认定免费证书当前可领取。
- https://xsign.co/article/Myi ：2026-09-25 的活动提供个人证书兑换码，需要注册、参与活动；不等于统一公众签名证书。
- https://enqapp.com/free ：页面宣称共享企业签免费试用；实际安装清单可读取，指向 ESign 工具包，不是 Mydex 签名服务。该页链接的 `https://udid.my/free-certs` 核查时返回 404。没有获得可用于 Mydex 的有效证书、私钥和匹配描述文件。
- https://github.com/claration/feather ：开源签名工具，需要已有证书。
- https://github.com/NexSideloading/certificates ：维护者公开状态表中，完整证书区当前均标记 Revoked；部分 Signed 项位于“Certificates missing P12”，缺少可用于签名的私钥包。这是维护者报告，不是本机对苹果服务的独立撤销校验。没有下载或使用这些第三方身份凭据。
- https://www.signhub.pro/ ：存在免费证书包目录，也需要 P12、描述文件和密码；未核验这些第三方企业凭据的授权来源或当前有效性，不能作为已验证可用方案。

以上是网站/下载链路核查，未在 iPhone 安装第三方工具，未验证证书是否被苹果撤销，未登录 Apple 账号，未购买或上传签名凭据。没有宣称任何候选可稳定使用。

## 本轮工程验证

- Windows 本地 `flutter analyze lib test` 通过。
- `flutter test --exclude-tags golden`：21 项通过。
- 全量测试的截图比对在 `goldens/add-computer.png` 出现 61 像素差异，未改写参考截图，原因尚未核实。
- GitHub macOS 构建 [40911416137](https://github.com/LeftSeineM/Mydex-mobile/actions/runs/40911416137) 的 iPhone release 编译和 IPA 打包步骤通过。构建源码提交 `7053901`。
- 已下载并比对 SHA-256：`3623914866b2866201b391272a7eae7a4e6f052bfc635d1446cd2f0f807750fe`。

## 签名与真机验收

取得明确授权使用的有效证书与匹配描述文件后，在本地签名；使用一台明确型号和系统版本的 iPhone 验证安装、首次信任、启动、电脑配对、原会话收发、重启后 token 保留。通过后才能提供可安装链接。未签名 IPA 不应加入正式手机更新渠道。

## 最新系统验证流程

用户要求先由开发侧测试，以最新正式版为目标，不等待指定手机。苹果 [2026-10-26 发布页](https://developer.apple.com/news/releases/?id=10262026b) 列出 iOS 27.2，本轮设为目标；后续版本应重新核验此值。

`iOS simulator validation` 工作流在 `xcode-27` 上运行，尝试下载目标系统，并记录实际运行版本。如果只能运行较旧系统，保留测试结果但令“目标系统覆盖”步骤失败，避免误报。验证 Keychain 临时数据存取、原生版本接口、震动方法调用、首次启动和设置页，保存截图与日志。震动方法成功不代表验证了物理震动；模拟器测试不验证 IPA 分发签名、设备信任或真实电脑会话。

测试文件：`integration_test/ios_smoke_test.dart`；截图输出：构建产物 `Mydex-iOS-validation/screenshots/`。只使用空白首次安装数据，不包含个人电脑地址或令牌。正式 IPA 构建也改用 Xcode 27 并附 `toolchain.txt`。
