import 'usage.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../controller.dart';
import '../widgets/updater.dart';
import '../widgets/developer_contact.dart';
import '../models.dart';
import '../widgets/status.dart';
import '../services/pairing.dart';
import '../services/account_navigation.dart';

class SettingsPage extends StatefulWidget {
  final AppController controller;
  final bool addNew;
  const SettingsPage(
      {super.key, required this.controller, this.addNew = false});
  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  final form = GlobalKey<FormState>();
  late final TextEditingController address, token, pin, name;
  late bool dark, predictions, mesh;
  late String relayUrl, relayToken;
  late List<String> directUrls;
  late double textScale;
  bool obscure = true, saving = false;
  String? failure;
  String versionLabel = '';
  @override
  void initState() {
    super.initState();
    final s = widget.controller.settings;
    name = TextEditingController(
        text: widget.addNew ? '' : widget.controller.connectionName);
    address = TextEditingController(text: widget.addNew ? '' : s.baseUrl);
    token = TextEditingController(text: widget.addNew ? '' : s.token);
    pin = TextEditingController(text: widget.addNew ? '' : s.fingerprint);
    dark = s.dark;
    predictions = s.predictions;
    mesh = widget.addNew ? false : s.mesh;
    relayUrl = widget.addNew ? '' : s.relayUrl;
    relayToken = widget.addNew ? '' : s.relayToken;
    directUrls = widget.addNew ? [] : s.directUrls;
    textScale = s.textScale;
    if (kIsWeb && widget.addNew) openAccountPortal();
    if (!kIsWeb) _readVersion();
  }

  Future<void> _readVersion() async {
    try {
      final value = await const MethodChannel('dev.mydex/device')
          .invokeMapMethod<String, dynamic>('appVersion');
      if (mounted && value?['name'] != null) {
        setState(() => versionLabel = '版本 ${value!['name']}');
      }
    } catch (_) {}
  }

  Future<void> manageComputers() async {
    final c = widget.controller;
    await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (ctx) => SafeArea(
                child: SizedBox(
              height: MediaQuery.sizeOf(ctx).height * .6,
              child: ListenableBuilder(
                  listenable: c,
                  builder: (_, __) =>
                      ListView(padding: const EdgeInsets.all(20), children: [
                        const Text('已添加的电脑',
                            style: TextStyle(
                                fontSize: 20, fontWeight: FontWeight.w600)),
                        const SizedBox(height: 8),
                        const Text('离线也可删除；电脑里的项目和对话会保留。'),
                        if (c.connections.isEmpty)
                          const Padding(
                              padding: EdgeInsets.all(24),
                              child: Text('还没有添加电脑')),
                        ...c.connections.map((p) => ListTile(
                              contentPadding: EdgeInsets.zero,
                              leading: const Icon(Icons.computer),
                              title: Text(p['name']?.toString() ?? '我的电脑'),
                              subtitle: Text(p['baseUrl'] == c.settings.baseUrl
                                  ? '当前电脑'
                                  : '已保存的电脑'),
                              trailing: IconButton(
                                  tooltip: '删除电脑：${p['name']}',
                                  icon: const Icon(Icons.delete_outline),
                                  onPressed: c.sending || c.approving.isNotEmpty
                                      ? null
                                      : () async {
                                          final addressToRemove =
                                              p['baseUrl'] as String;
                                          final wasCurrent =
                                              c.settings.baseUrl ==
                                                  addressToRemove;
                                          final yes = await showDialog<bool>(
                                              context: ctx,
                                              builder: (dialog) => AlertDialog(
                                                      title: Text(
                                                          '删除“${p['name']}”？'),
                                                      content: const Text(
                                                          '只移除这部手机上的连接和当前缓存，不会删除电脑上的项目与对话。'),
                                                      actions: [
                                                        TextButton(
                                                            onPressed: () =>
                                                                Navigator.pop(
                                                                    dialog,
                                                                    false),
                                                            child: const Text(
                                                                '取消')),
                                                        FilledButton(
                                                            onPressed: () =>
                                                                Navigator.pop(
                                                                    dialog,
                                                                    true),
                                                            child: const Text(
                                                                '删除设备'))
                                                      ]));
                                          if (yes != true) return;
                                          try {
                                            await c.forgetConnection(
                                                addressToRemove);
                                            if (mounted && wasCurrent) {
                                              setState(() {
                                                address.clear();
                                                token.clear();
                                                pin.clear();
                                                name.clear();
                                                relayUrl = '';
                                                relayToken = '';
                                                directUrls = [];
                                                mesh = false;
                                              });
                                            }
                                          } catch (e) {
                                            if (ctx.mounted) {
                                              ScaffoldMessenger.of(ctx)
                                                  .showSnackBar(SnackBar(
                                                      content:
                                                          Text('删除失败：$e')));
                                            }
                                          }
                                        }),
                            ))
                      ])),
            )));
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    address.dispose();
    token.dispose();
    pin.dispose();
    name.dispose();
    super.dispose();
  }

  Future<void> save() async {
    if (!form.currentState!.validate()) return;
    setState(() {
      saving = true;
      failure = null;
    });
    try {
      await widget.controller.configure(
          ConnectionSettings(
              baseUrl: address.text.trim().replaceAll(RegExp(r'/$'), ''),
              token: token.text.trim(),
              fingerprint: pin.text.trim(),
              relayUrl: relayUrl,
              relayToken: relayToken,
              directUrls: directUrls,
              dark: dark,
              textScale: textScale,
              predictions: predictions,
              mesh: mesh),
          name: name.text);
      if (mounted && widget.controller.connected) {
        Navigator.pop(context);
      } else if (mounted) {
        setState(() => failure = widget.controller.error ?? '配置已保存，但暂未连接成功');
      }
    } catch (_) {
      if (mounted) setState(() => failure = '保存失败，请检查设备安全存储是否可用');
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> paste() async {
    try {
      final clip = await Clipboard.getData('text/plain');
      final data = parsePairing(clip?.text ?? '');
      if (!mounted) return;
      setState(() {
        name.text = data['name'];
        address.text = data['baseUrl'];
        token.text = data['token'];
        pin.text = data['fingerprint'];
        mesh = data['mesh'] == true;
        relayUrl = data['relayUrl'] ?? '';
        relayToken = data['relayToken'] ?? '';
        directUrls = directAddresses(data['directUrls']);
        failure = null;
      });
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('已识别全部配对信息，请保存并连接')));
    } catch (_) {
      if (mounted) setState(() => failure = '剪贴板中没有有效配对信息，请在电脑版点击“复制全部配对信息”');
    }
  }

  Future<void> scan() async {
    setState(() {
      saving = true;
      failure = null;
    });
    try {
      final raw = await const MethodChannel('dev.mydex/device')
          .invokeMethod<String>('scanPairing');
      if (raw == null || !mounted) return;
      final invitation = parseInvitation(raw);
      final confirmed = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
                title: const Text('连接这台电脑？'),
                content: Text(
                    '${invitation['name']}\n${invitation['baseUrl']}\n\n请确认这是你电脑上显示的二维码。'),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(ctx, false),
                      child: const Text('取消')),
                  FilledButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: const Text('确认配对'))
                ],
              ));
      if (confirmed != true || !mounted) return;
      if (invitation['mesh'] == true) {
        throw const FormatException('这是旧版组网二维码，请更新电脑连接器后重新生成应用版二维码');
      }
      final data = await redeemInvitation(invitation);
      if (!mounted) return;
      setState(() {
        name.text = data['name'];
        address.text = data['baseUrl'];
        token.text = data['token'];
        pin.text = data['fingerprint'];
        mesh = data['mesh'] == true;
        relayUrl = data['relayUrl'] ?? '';
        relayToken = data['relayToken'] ?? '';
        directUrls = directAddresses(data['directUrls']);
      });
      await save();
    } on FormatException catch (e) {
      if (mounted) setState(() => failure = e.message);
    } on PlatformException {
      if (mounted) setState(() => failure = '无法打开相机，请允许相机权限；也可以使用粘贴配对');
    } catch (e) {
      if (mounted) setState(() => failure = '配对未完成：$e。请确认手机能访问电脑地址，必要时刷新二维码。');
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    return Scaffold(
        appBar: AppBar(
            title:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('连接与设置', style: TextStyle(fontSize: 18)),
          if (versionLabel.isNotEmpty)
            Text(versionLabel, style: const TextStyle(fontSize: 11))
        ])),
        body: SafeArea(
            child: Center(
                child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 600),
                    child: Form(
                        key: form,
                        child: ListView(
                            padding: const EdgeInsets.all(24),
                            children: [
                              const Icon(Icons.terminal_rounded, size: 38),
                              const SizedBox(height: 16),
                              const Text('你的电脑，随身连接',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                      fontSize: 23,
                                      fontWeight: FontWeight.w600)),
                              const SizedBox(height: 8),
                              const Text('每台电脑独立连接，手机统一保存和切换。',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(color: Colors.grey)),
                              const SizedBox(height: 32),
                              TextButton.icon(
                                  onPressed: widget.controller.connected
                                      ? () =>
                                          showUsage(context, widget.controller)
                                      : null,
                                  icon: const Icon(Icons.data_usage),
                                  label: const Text('额度与用量')),
                              if (!kIsWeb) ...[
                                OutlinedButton.icon(
                                    onPressed: manageComputers,
                                    icon: const Icon(Icons.devices),
                                    label: const Text('管理已添加电脑')),
                                const SizedBox(height: 12),
                                FilledButton.icon(
                                    onPressed: saving || kIsWeb ? null : scan,
                                    icon: const Icon(
                                        Icons.qr_code_scanner_rounded),
                                    label: Text(saving ? '正在配对…' : '扫描电脑二维码')),
                                const SizedBox(height: 12),
                                OutlinedButton.icon(
                                    onPressed: saving ? null : paste,
                                    icon: const Icon(Icons.content_paste),
                                    label: const Text('粘贴全部配对信息')),
                              ] else
                                FilledButton.icon(
                                    onPressed: openAccountPortal,
                                    icon: const Icon(Icons.devices),
                                    label: const Text('账号与电脑配对')),
                              const SizedBox(height: 16),
                              TextFormField(
                                  controller: name,
                                  decoration: const InputDecoration(
                                      labelText: '电脑名称',
                                      hintText: '例如：家里电脑 / 工作电脑')),
                              const SizedBox(height: 20),
                              ListenableBuilder(
                                  listenable: c,
                                  builder: (_, __) => Row(children: [
                                        StatusDot(c.connected
                                            ? const Color(0xff91b9a0)
                                            : const Color(0xffdb9391)),
                                        const SizedBox(width: 8),
                                        Text(c.connected ? '实时连接已建立' : '尚未连接',
                                            style:
                                                const TextStyle(fontSize: 13))
                                      ])),
                              const SizedBox(height: 20),
                              if (!kIsWeb) ...[
                                TextFormField(
                                    controller: address,
                                    autocorrect: false,
                                    keyboardType: TextInputType.url,
                                    decoration: const InputDecoration(
                                        labelText: '后端地址',
                                        hintText: 'https://你的主机:18443'),
                                    validator: (v) =>
                                        ConnectionSettings.validate(v ?? '') ??
                                        (mesh &&
                                                !(v ?? '')
                                                    .startsWith('https://')
                                            ? '内置组网需要 HTTPS 地址'
                                            : null)),
                                if (relayUrl.isNotEmpty)
                                  const ListTile(
                                      leading: Icon(Icons.link),
                                      title: Text('免账号安全连接'),
                                      subtitle:
                                          Text('电脑网络地址变化后自动重连，无需登录第三方账号')),
                                const SizedBox(height: 16),
                                TextFormField(
                                    controller: token,
                                    obscureText: obscure,
                                    autocorrect: false,
                                    enableSuggestions: false,
                                    decoration: InputDecoration(
                                        labelText: '访问令牌 · Bearer Token',
                                        suffixIcon: IconButton(
                                            tooltip: obscure ? '显示令牌' : '隐藏令牌',
                                            icon: Icon(obscure
                                                ? Icons.visibility_outlined
                                                : Icons
                                                    .visibility_off_outlined),
                                            onPressed: () => setState(
                                                () => obscure = !obscure))),
                                    validator: (v) =>
                                        (v?.trim().length ?? 0) < 24
                                            ? '请填写网关提供的完整令牌'
                                            : null),
                                const SizedBox(height: 16),
                                TextFormField(
                                    controller: pin,
                                    autocorrect: false,
                                    decoration: const InputDecoration(
                                        labelText: kIsWeb
                                            ? '证书指纹（网页版由浏览器验证 HTTPS 证书）'
                                            : '服务器证书 SHA-256 指纹',
                                        helperText: '自签名 HTTPS 必填；受信任证书可留空',
                                        helperMaxLines: 2),
                                    validator: (v) {
                                      final p = (v ?? '')
                                          .replaceAll(RegExp(r'[:\s]'), '');
                                      return p.isNotEmpty &&
                                              !RegExp(r'^[a-fA-F0-9]{64}$')
                                                  .hasMatch(p)
                                          ? '指纹应为 64 位十六进制字符'
                                          : null;
                                    }),
                                const SizedBox(height: 20),
                              ],
                              SwitchListTile.adaptive(
                                  contentPadding: EdgeInsets.zero,
                                  title: const Text('深色外观'),
                                  subtitle: const Text('默认浅色，可按喜好切换'),
                                  value: dark,
                                  onChanged: (v) => setState(() => dark = v)),
                              const SizedBox(height: 12),
                              Text('字体大小 · ${(textScale * 100).round()}%'),
                              Slider(
                                  value: textScale,
                                  min: .6,
                                  max: 2.0,
                                  divisions: 28,
                                  label: '${(textScale * 100).round()}%',
                                  onChanged: (value) =>
                                      setState(() => textScale = value)),
                              TextButton(
                                  onPressed: () =>
                                      setState(() => textScale = 1),
                                  child: const Text('恢复 100%')),
                              Text('预览：继续电脑上的对话 Aa 123',
                                  textScaler: TextScaler.linear(textScale)),
                              const Text('保存后应用；会叠加系统字体大小。',
                                  style: TextStyle(
                                      fontSize: 12, color: Colors.grey)),
                              SwitchListTile.adaptive(
                                  contentPadding: EdgeInsets.zero,
                                  title: const Text('下一步建议'),
                                  subtitle: const Text(
                                      '手动获取建议时，电脑会把最近最多 6 条文字交给其配置的模型。可能产生 API 用量；建议只填入草稿。'),
                                  value: predictions,
                                  onChanged: (v) =>
                                      setState(() => predictions = v)),
                              if (failure != null)
                                Padding(
                                    padding: const EdgeInsets.symmetric(
                                        vertical: 12),
                                    child: Text(failure!,
                                        style: TextStyle(
                                            color: Theme.of(context)
                                                .colorScheme
                                                .error))),
                              const SizedBox(height: 16),
                              FilledButton(
                                  onPressed: saving ? null : save,
                                  child: Text(saving ? '正在连接…' : '保存并连接')),
                              const SizedBox(height: 24),
                              const Divider(),
                              UpdateTile(api: c.api),
                              const DeveloperContactTile(),
                              ListTile(
                                  leading: const Icon(Icons.language),
                                  title: const Text('官网与下载'),
                                  subtitle:
                                      const Text('app.leftseinem.dpdns.org'),
                                  onTap: () async {
                                    try {
                                      await const MethodChannel(
                                              'dev.mydex/device')
                                          .invokeMethod('openWebsite');
                                    } catch (_) {
                                      await Clipboard.setData(const ClipboardData(
                                          text:
                                              'https://app.leftseinem.dpdns.org/'));
                                    }
                                  }),
                              const SizedBox(height: 16),
                              ListTile(
                                  contentPadding: EdgeInsets.zero,
                                  leading: const Icon(
                                      Icons.cleaning_services_outlined),
                                  title: const Text('清除本地会话缓存'),
                                  subtitle: const Text('电脑上的对话会保留'),
                                  onTap: () async {
                                    await c.clearCache();
                                    if (context.mounted) {
                                      ScaffoldMessenger.of(context)
                                          .showSnackBar(const SnackBar(
                                              content: Text('本地缓存已清除')));
                                    }
                                  }),
                              ListTile(
                                  contentPadding: EdgeInsets.zero,
                                  leading: const Icon(Icons.link_off),
                                  title: const Text('移除连接与所有本地数据'),
                                  onTap: () async {
                                    final yes = await showDialog<bool>(
                                        context: context,
                                        builder: (ctx) => AlertDialog(
                                                title: const Text('移除这台手机的连接？'),
                                                content: const Text(
                                                    '会清除地址、访问令牌和本地缓存，电脑上的项目和会话不受影响。'),
                                                actions: [
                                                  TextButton(
                                                      onPressed: () =>
                                                          Navigator.pop(
                                                              ctx, false),
                                                      child: const Text('取消')),
                                                  TextButton(
                                                      onPressed: () =>
                                                          Navigator.pop(
                                                              ctx, true),
                                                      child: const Text('移除'))
                                                ]));
                                    if (yes == true) {
                                      await c.clearCache(all: true);
                                      if (context.mounted) {
                                        Navigator.pop(context);
                                      }
                                    }
                                  }),
                              const SizedBox(height: 24),
                              Text(
                                  'Mydex $versionLabel\n模型、密钥和任务执行留在电脑上。自动连接采用端到端加密。',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                      fontSize: 12, color: Colors.grey)),
                            ]))))));
  }
}
