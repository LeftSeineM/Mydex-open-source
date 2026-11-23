# iPhone 免商店分发调研 · 2026-10-29

本轮仅调研，未下载签名工具、未导入证书、未登录 Apple 账号、未制作 IPA。

结论：开源签名工具存在，但工具不能产生可在所有 iPhone 上永久有效的通用签名。“万能签”缺少确切产品链接，不能据名称确认其开源性或证书来源。

| 方式 | 不经 App Store 审核 | 条件与局限 |
| --- | --- | --- |
| AltStore Classic / AltServer | 是 | 开源；使用用户自己的 Apple ID，免费签名通常 7 天，需续签及电脑协助，通常最多 3 个活跃侧载应用，AltStore 自身占用名额 |
| 自有付费账号 Ad Hoc | 是 | 设备需要注册到配置描述文件，受设备数量、证书和描述文件有效期限制；不是任意用户点链接就装 |
| zsign | 工具本身不走商店 | 开源重签名工具，仍需证书、私钥和匹配的描述文件，不是免费无限证书 |
| TrollStore | 是 | 开源，依赖特定旧系统漏洞，官方支持范围有限，不适用于任意新版 iOS |
| PWA | 是 | 无需 IPA 签名；适合链接打开，但本轮手机开发暂缓 |

优先考虑个人自用的 AltStore Classic 或自有账号 Ad Hoc。不要把未知共享企业证书作为长期分发基础：证书可能被撤销，企业内部分发也不等于面向公众发布。

## 一手来源

- AltStore 源码：https://github.com/altstoreio/AltStore
- AltStore 官方 FAQ：https://github.com/altstoreio/FAQ/blob/main/altstore-world/your-altstore.md
- zsign 源码与证书参数：https://github.com/zhlynn/zsign
- TrollStore 官方支持范围：https://github.com/opa334/TrollStore
- 苹果开发者账号：https://developer.apple.com/help/account/basics/about-your-developer-account
- 苹果 Ad Hoc：https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile

下一步选择 iPhone 安装方式前，需确认实际 iOS 版本、使用人数，以及是否接受续签。不在聊天或公开仓库收集 Apple 密码、私钥和签名证书。
