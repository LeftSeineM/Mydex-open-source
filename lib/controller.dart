import 'dart:async';
import 'dart:convert';
import 'dart:io' if (dart.library.html) 'services/web_socket.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'models.dart';
import 'services/api.dart';
import 'services/storage.dart';

class AppController extends ChangeNotifier {
  static bool superagentTest =
      const bool.fromEnvironment('MYDEX_SUPERAGENT_TEST');
  bool get isSuperagent => deviceId == 'superagent' && toolId == 'superagent';
  Future<void> connectSuperagent() async {
    if (!superagentTest) return;
    if (devices.any((d) => d['id'] == 'superagent')) {
      chooseDevice('superagent');
      return;
    }
    for (final profile in connections) {
      if (profile['baseUrl'] == settings.baseUrl) continue;
      final candidate = GatewayApi(ConnectionSettings.fromJson(profile));
      try {
        final result = await candidate.get('/api/devices');
        if (objects(result['devices']).any((d) => d['id'] == 'superagent')) {
          await switchConnection(profile);
          chooseDevice('superagent');
          return;
        }
      } catch (_) {
        // Probe only previously paired computers, never a hard-coded address.
      } finally {
        candidate.close();
      }
    }
    throw Exception('未找到已配对的小主机协调层，请先连接小主机后重试');
  }

  final LocalStorage storage;
  AppController(this.storage);
  ConnectionSettings settings = const ConnectionSettings();
  List<Json> connections = [];
  String get connectionName =>
      connections
          .where((p) => p['baseUrl'] == settings.baseUrl)
          .firstOrNull?['name'] ??
      '当前电脑';
  GatewayApi? api;
  List<Json> devices = [], tasks = [], projects = [];
  List<Json> tools = [], models = [];
  String toolId = 'codex';
  int _workspaceRevision = 0;
  String get toolName =>
      deviceTools.where((t) => t['id'] == toolId).firstOrNull?['name'] ??
      (toolId == 'codex' ? 'Codex' : toolId);
  List<Json> get visibleProjects => projects
      .where((p) =>
          p['deviceId'] == deviceId && (p['toolId'] ?? 'codex') == toolId)
      .toList();
  void _resetWorkspaceControls() {
    ++_workspaceRevision;
    models = [];
    controlState = {};
    newOptions = {};
    controlsError = null;
    controlNotice = null;
    controlsLoading = false;
    loading = false;
    error = null;
    _socket?.add(jsonEncode({'type': 'subscribe', 'taskId': null}));
  }

  Json controlState = {}, newOptions = {};
  bool controlsLoading = false;
  String? controlsError;
  String? controlNotice;
  List<Json> get deviceTools =>
      tools.where((t) => t['deviceId'] == deviceId).toList();
  bool get toolCanSend =>
      selected?['readOnly'] != true &&
      (toolId == 'codex' ||
          (selectedId != null &&
              selected?['source'] == 'desktop' &&
              selected?['readOnly'] == false &&
              selected?['toolId'] == toolId) ||
          deviceTools.any((t) =>
              t['id'] == toolId &&
              t['capabilities']?['send'] == true &&
              (selectedId != null || t['capabilities']?['create'] != false)));
  final Map<String, Json> details = {};
  final Map<String, String> drafts = {};
  final Map<String, String> parentChats = {};
  // Side-chat grouping is separate from generic child/subagent return navigation.
  final Map<String, String> sideChatParents = {};
  String? get sideChatParent => sideChatParents[selectedId];
  final Set<String> stopping = {};
  String? get parentChat => parentChats[selectedId];
  String? selectedId, deviceId, projectId, error;
  bool connected = false,
      loading = false,
      sending = false,
      initialized = false,
      cached = false;
  bool composing = false;
  WebSocket? _socket;
  Timer? _retry, _cacheTimer;
  int _generation = 0, _attempt = 0;
  final Set<String> _alerted = {};
  Future<void> _cacheWrite = Future.value();
  Json? get selected => details[selectedId];
  bool get deviceOnline => devices.any((d) =>
      d['id'] == (selected?['deviceId'] ?? deviceId) &&
      d['online'] == true &&
      (toolId != 'codex' || d['desktopOnline'] == true));
  List<Json> get visibleTasks => tasks
      .where((t) =>
          (deviceId == null || t['deviceId'] == deviceId) &&
          (t['toolId'] ?? 'codex') == toolId &&
          (projectId == null || t['projectId'] == projectId))
      .toList();
  Future<void> initialize() async {
    try {
      settings = await storage.settings();
      connections = await storage.profiles();
      if (settings.configured &&
          !connections.any((p) => p['baseUrl'] == settings.baseUrl)) {
        connections.add({'name': '原有连接', ...settings.toJson()});
        await storage.saveProfiles(connections);
      }
      final cache = await storage.readCache();
      if (cache != null && cache['baseUrl'] == settings.baseUrl) {
        tasks = objects(cache['tasks']);
        for (final detail in objects(cache['details'])) {
          details[detail['id']] = detail;
        }
        cached = true;
      }
    } catch (_) {
      error = '无法读取本机加密配置，请在设置中重新填写。';
    }
    initialized = true;
    notifyListeners();
    if (settings.configured) await reconnect();
  }

  Future<void> configure(ConnectionSettings value, {String? name}) async {
    if (sending || approving.isNotEmpty) throw StateError('请等待当前发送或审批返回，再切换电脑');
    final changed =
        value.baseUrl != settings.baseUrl || value.token != settings.token;
    ++_generation;
    _retry?.cancel();
    _cacheTimer?.cancel();
    _socket?.close();
    api?.close();
    connected = false;
    await _cacheWrite;
    bool sameComputer(Json p) =>
        p['baseUrl'] == value.baseUrl ||
        (value.fingerprint.isNotEmpty &&
            p['fingerprint'] == value.fingerprint &&
            p['token'] == value.token);
    final existing = connections.indexWhere(sameComputer);
    final profile = {
      'name': name?.trim().isNotEmpty == true
          ? name!.trim()
          : (existing >= 0
              ? connections[existing]['name']
              : Uri.parse(value.baseUrl).host),
      ...value.toJson()
    };
    connections.removeWhere(sameComputer);
    connections.insert(
        existing < 0
            ? connections.length
            : existing.clamp(0, connections.length),
        profile);
    await storage.saveProfiles(connections);
    await storage.saveSettings(value);
    settings = value;
    if (changed) {
      tasks = [];
      devices = [];
      projects = [];
      tools = [];
      models = [];
      controlState = {};
      controlsLoading = false;
      controlsError = null;
      controlNotice = null;
      newOptions = {};
      toolId = 'codex';
      composing = false;
      drafts.clear();
      parentChats.clear();
      sideChatParents.clear();
      _alerted.clear();
      loading = false;
      details.clear();
      selectedId = null;
      deviceId = null;
      projectId = null;
      await storage.clearCache();
    }
    await reconnect();
  }

  Future<void> switchConnection(Json profile) => configure(
      ConnectionSettings.fromJson({
        ...profile,
        'dark': settings.dark,
        if (kIsWeb) 'textScale': settings.textScale
      }),
      name: profile['name']);
  Future<void> forgetConnection(String address) async {
    if (sending || approving.isNotEmpty) {
      throw StateError('请等待当前发送或审批返回，再删除电脑');
    }
    connections.removeWhere((p) => p['baseUrl'] == address);
    await storage.saveProfiles(connections);
    if (settings.baseUrl == address) {
      ++_generation;
      _retry?.cancel();
      _cacheTimer?.cancel();
      _socket?.close();
      _socket = null;
      api?.close();
      api = null;
      connected = false;
      await _cacheWrite;
      _resetWorkspaceControls();
      tasks = [];
      devices = [];
      projects = [];
      tools = [];
      details.clear();
      drafts.clear();
      _alerted.clear();
      selectedId = null;
      deviceId = null;
      projectId = null;
      error = null;
      composing = false;
      settings = ConnectionSettings(
          dark: settings.dark,
          textScale: settings.textScale,
          predictions: settings.predictions);
      await storage.saveSettings(settings);
      await storage.clearCache();
      // Leave the remaining computers available to select, without connecting
      // to another computer or recreating the removed profile on next launch.
    }
    notifyListeners();
  }

  Future<void> reconnect() async {
    final generation = ++_generation;
    _retry?.cancel();
    _socket?.close();
    api?.close();
    connected = false;
    api = GatewayApi(settings);
    notifyListeners();
    await _connect(generation);
  }

  Future<void> _connect(int generation) async {
    if (generation != _generation || !settings.configured) return;
    try {
      final socket = await api!.connect();
      if (generation != _generation) {
        socket.close();
        return;
      }
      _socket = socket;
      socket.pingInterval = const Duration(seconds: 20);
      connected = true;
      _attempt = 0;
      error = null;
      notifyListeners();
      socket.listen((data) {
        if (generation == _generation) _event(data);
      },
          onError: (_) => _lost(generation),
          onDone: () => _lost(generation),
          cancelOnError: true);
      if (selectedId != null) {
        socket.add(jsonEncode({'type': 'subscribe', 'taskId': selectedId}));
      }
      await refresh();
      if (selectedId != null) await select(selectedId!);
    } catch (_) {
      if (generation == _generation) {
        error = '连接断开，正在自动重连';
        _lost(generation);
      }
    }
  }

  void _lost(int generation) {
    if (generation != _generation) return;
    connected = false;
    notifyListeners();
    _retry?.cancel();
    final seconds = (1 << _attempt.clamp(0, 5)).clamp(1, 30);
    _attempt++;
    _retry = Timer(Duration(seconds: seconds), () => _connect(generation));
  }

  void _event(dynamic data) {
    try {
      final j = Map<String, dynamic>.from(jsonDecode(data as String));
      if (j['type'] == 'devices') devices = objects(j['devices']);
      if (j['type'] == 'tasks') {
        tasks = objects(j['tasks']);
        cached = false;
        _scheduleCache();
      }
      if (j['type'] == 'task') {
        final task = Map<String, dynamic>.from(j['task']);
        final index = tasks.indexWhere((t) => t['id'] == task['id']);
        if (index >= 0) {
          tasks[index] = {...tasks[index], ...task};
        } else {
          tasks.insert(0, task);
        }
        if (task['id'] == selectedId) _mergeDetail(task);
        for (final a in objects(task['approvals'])) {
          if (a['resolved'] == null &&
              _alerted.add('${task['id']}:${a['id']}')) {
            const MethodChannel('dev.mydex/device')
                .invokeMethod<void>('vibrate')
                .catchError((_) {});
          }
        }
      }
      deviceId ??= devices.isNotEmpty ? devices.first['id'] : null;
      notifyListeners();
    } catch (_) {
      error = '收到无法识别的数据，请检查网关版本';
      notifyListeners();
    }
  }

  void _mergeDetail(Json task) {
    final previous = details[task['id']];
    if (previous != null &&
        previous['windowed'] == true &&
        task['windowed'] == true &&
        objects(previous['messages']).any((old) =>
            objects(task['messages']).any((m) => m['id'] == old['id']))) {
      final combined = <String, Json>{};
      for (final m in [
        ...objects(previous['messages']),
        ...objects(task['messages'])
      ]) {
        combined[m['id'].toString()] = m;
      }
      task['messages'] = combined.values.toList();
      task['nextCursor'] = previous['nextCursor'];
      task['hasMore'] = previous['hasMore'];
    }
    if (previous != null &&
        previous['olderMessages'] != null &&
        (task['windowed'] != true ||
            objects(previous['messages']).any((old) =>
                objects(task['messages']).any((m) => m['id'] == old['id'])))) {
      task['olderMessages'] = previous['olderMessages'];
      task['nextCursor'] = previous['nextCursor'];
      task['hasMore'] = previous['hasMore'];
    }
    details[task['id']] = task;
    _scheduleCache();
  }

  void _scheduleCache() {
    _cacheTimer?.cancel();
    _cacheTimer = Timer(const Duration(seconds: 2), () {
      final snapshot = {
        'baseUrl': settings.baseUrl,
        'details': details.values
            .toList()
            .reversed
            .take(8)
            .map((t) => {
                  ...t,
                  'messages': objects(t['messages'])
                      .reversed
                      .take(200)
                      .toList()
                      .reversed
                      .toList(),
                  'approvals': <Json>[],
                }..remove('olderMessages'))
            .toList(),
        'tasks': tasks
            .map((t) => {...t}
              ..remove('messages')
              ..remove('approvals'))
            .toList()
      };
      _cacheWrite = _cacheWrite
          .then((_) => storage.saveCache(snapshot))
          .catchError((_) {});
    });
  }

  Future<void> refresh() async {
    final generation = _generation;
    try {
      final r = await api!.get('/api/tasks');
      if (generation != _generation) return;
      tasks = objects(r['tasks']);
      devices = objects(r['devices']);
      deviceId ??= devices.isNotEmpty ? devices.first['id'] : null;
      cached = false;
      _scheduleCache();
      final p = await api!.get('/api/projects');
      if (generation != _generation) return;
      projects = objects(p['projects']);
      try {
        final r = await api!.get('/api/tools');
        if (generation == _generation) tools = objects(r['tools']);
      } catch (_) {}
      error = null;
    } catch (e) {
      if (generation == _generation) error = e.toString();
    }
    notifyListeners();
  }

  void chooseDevice(String id) {
    _resetWorkspaceControls();
    deviceId = id;
    projectId = null;
    selectedId = null;
    composing = false;
    if (!deviceTools.any((t) => t['id'] == toolId)) {
      toolId = id == 'superagent' ? 'superagent' : 'codex';
    }
    newOptions = {};
    notifyListeners();
  }

  void chooseTool(String id) {
    _resetWorkspaceControls();
    toolId = id;
    projectId = null;
    selectedId = null;
    composing = false;
    newOptions = {};
    controlState = {};
    notifyListeners();
  }

  Future<void> loadControls() async {
    final generation = _generation;
    final revision = _workspaceRevision;
    final toolAtStart = toolId;
    final selectedAtStart = selectedId;
    bool current() =>
        generation == _generation &&
        revision == _workspaceRevision &&
        toolId == toolAtStart &&
        selectedId == selectedAtStart;
    if (toolId != 'codex') {
      _resetWorkspaceControls();
      notifyListeners();
      return;
    }
    final device = selected?['deviceId'] ?? deviceId;
    controlsLoading = true;
    controlsError = null;
    notifyListeners();
    try {
      final catalog =
          await api!.get('/api/devices/${Uri.encodeComponent(device!)}/models');
      if (!current()) return;
      final state = selectedAtStart == null
          ? <String, dynamic>{
              ...newOptions,
              'capabilities': {'settings': true}
            }
          : await api!.get(
              '/api/tasks/${Uri.encodeComponent(selectedAtStart)}/controls');
      if (current()) {
        models = objects(catalog['models']);
        controlState = state;
        // Use the desktop-confirmed settings immediately; a stream update may
        // arrive later. Never infer permission changes from the submitted body.
        if (selectedAtStart != null &&
            state['permissions'] != null &&
            details[selectedAtStart] != null) {
          details[selectedAtStart]!['permissions'] = state['permissions'];
        }
      }
    } catch (e) {
      if (current()) controlsError = e.toString();
    } finally {
      if (current()) {
        controlsLoading = false;
        notifyListeners();
      }
    }
  }

  Future<bool> control(String action, Json body) async {
    if (toolId != 'codex') return false;
    final revision = _workspaceRevision;
    final generation = _generation;
    if (selectedId == null && action == 'settings') {
      newOptions = body;
      controlState = body;
      notifyListeners();
      return true;
    }
    if (selectedId == null) return false;
    try {
      final result = await api!
          .post('/api/tasks/${Uri.encodeComponent(selectedId!)}/$action', body);
      if (generation != _generation || revision != _workspaceRevision) {
        return false;
      }
      controlNotice = result['message'] ??
          (result['pending'] == true ? '目标变更已发送，等待电脑确认' : '已保存到电脑');
      await loadControls();
      return true;
    } catch (e) {
      if (generation != _generation || revision != _workspaceRevision) {
        return false;
      }
      controlsError = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<bool> createSideChat() async {
    final parent = selectedId;
    final generation = _generation;
    if (toolId != 'codex' || parent == null || sending) return false;
    try {
      final result = await api!
          .post('/api/tasks/${Uri.encodeComponent(parent)}/side-chats', {});
      if (generation != _generation || selectedId != parent) return false;
      if (result['id'] is! String) throw StateError('电脑未返回侧聊标识，请刷新列表');
      parentChats[result['id']] = parent;
      sideChatParents[result['id']] = parent;
      await select(result['id']);
      return error == null;
    } catch (e) {
      if (generation == _generation && selectedId == parent) {
        controlsError = e.toString();
        notifyListeners();
      }
      return false;
    }
  }

  void chooseProject(String? id) {
    _resetWorkspaceControls();
    projectId = id;
    selectedId = null;
    composing = false;
    notifyListeners();
  }

  void newTask() {
    final inheritedProject = selected?['projectId']?.toString();
    if (inheritedProject != null &&
        visibleProjects.any((p) => p['id'] == inheritedProject)) {
      projectId = inheritedProject;
    }
    _resetWorkspaceControls();
    selectedId = null;
    composing = true;
    notifyListeners();
  }

  void browse() {
    _resetWorkspaceControls();
    selectedId = null;
    composing = false;
    notifyListeners();
  }

  Future<void> select(String id) async {
    _resetWorkspaceControls();
    composing = true;
    selectedId = id;
    loading = true;
    error = null;
    notifyListeners();
    _socket?.add(jsonEncode({'type': 'subscribe', 'taskId': id}));
    final generation = _generation;
    try {
      final t = await api!.get('/api/tasks/${Uri.encodeComponent(id)}');
      if (generation == _generation && selectedId == id) _mergeDetail(t);
    } catch (e) {
      if (generation == _generation && selectedId == id) error = e.toString();
    } finally {
      if (generation == _generation && selectedId == id) {
        loading = false;
        notifyListeners();
      }
    }
  }

  Future<void> older() async {
    final generation = _generation;
    final id = selectedId;
    final cursor = selected?['nextCursor'];
    if (id == null || cursor == null || loading) return;
    loading = true;
    notifyListeners();
    try {
      final t = await api!.get(
          '/api/tasks/${Uri.encodeComponent(id)}?cursor=${Uri.encodeQueryComponent(cursor)}');
      if (generation == _generation && selectedId == id) {
        final current = details[id]!;
        current['olderMessages'] = [
          ...objects(t['messages']),
          ...objects(current['olderMessages'])
        ];
        current['nextCursor'] = t['nextCursor'];
        current['hasMore'] = t['hasMore'];
      }
    } catch (e) {
      if (generation == _generation && selectedId == id) error = e.toString();
    } finally {
      if (generation == _generation && selectedId == id) {
        loading = false;
        notifyListeners();
      }
    }
  }

  Future<void> interrupt() async {
    final id = selectedId;
    final turnId = selected?['turnId'];
    if (id == null ||
        turnId == null ||
        selected?['canInterrupt'] != true ||
        !connected ||
        !deviceOnline ||
        !stopping.add(id)) {
      return;
    }
    final generation = _generation;
    notifyListeners();
    try {
      await api!.post('/api/tasks/${Uri.encodeComponent(id)}/interrupt',
          {'expectedTurnId': turnId});
      if (generation == _generation && selectedId == id) await select(id);
    } catch (e) {
      if (generation == _generation && selectedId == id) error = e.toString();
    } finally {
      stopping.remove(id);
      notifyListeners();
    }
  }

  Future<bool> send(String text) async {
    if (sending ||
        !connected ||
        !deviceOnline ||
        !toolCanSend ||
        text.trim().isEmpty) {
      return false;
    }
    sending = true;
    error = null;
    notifyListeners();
    final id = selectedId;
    final revision = _workspaceRevision;
    try {
      if (id == null) {
        final t = await api!.post('/api/tasks', {
          'deviceId': deviceId,
          'projectId': projectId,
          'toolId': toolId,
          ...newOptions,
          'instruction': text.trim()
        });
        if (revision != _workspaceRevision) {
          await refresh();
          return true;
        }
        selectedId = t['id'];
        details[selectedId!] = t;
        drafts.remove('new:$deviceId:$toolId:$projectId');
        await select(selectedId!);
      } else {
        await api!.post('/api/tasks/${Uri.encodeComponent(id)}/messages',
            {'instruction': text.trim()});
        drafts.remove(id);
        if (selectedId == id) await select(id);
      }
      return true;
    } catch (e) {
      if (revision == _workspaceRevision) error = e.toString();
      return false;
    } finally {
      sending = false;
      notifyListeners();
    }
  }

  final Set<String> approving = {};
  Future<void> approve(Json approval, String decision, {Json? answers}) async {
    final id = selectedId;
    final key = '$id:${approval['id']}';
    if (id == null || approving.contains(key) || !connected) return;
    approving.add(key);
    notifyListeners();
    try {
      await api!.post('/api/tasks/${Uri.encodeComponent(id)}/approve', {
        'approvalId': approval['id'],
        'decision': decision,
        if (answers != null) 'answers': answers
      });
      if (selectedId == id) await select(id);
    } catch (e) {
      error = e.toString();
    } finally {
      approving.remove(key);
      notifyListeners();
    }
  }

  Future<void> clearCache({bool all = false}) async {
    _cacheTimer?.cancel();
    await _cacheWrite;
    tasks = [];
    details.clear();
    drafts.clear();
    selectedId = null;
    if (all) {
      ++_generation;
      _retry?.cancel();
      _socket?.close();
      api?.close();
      api = null;
      settings = const ConnectionSettings();
      connections = [];
      connected = false;
      devices = [];
      projects = [];
      await storage.clearAll();
    } else {
      await storage.clearCache();
    }
    notifyListeners();
  }

  @override
  void dispose() {
    ++_generation;
    _retry?.cancel();
    _cacheTimer?.cancel();
    _socket?.close();
    api?.close();
    super.dispose();
  }
}
