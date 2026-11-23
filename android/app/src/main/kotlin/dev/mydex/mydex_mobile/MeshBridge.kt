package dev.mydex.mydex_mobile
import android.app.Activity
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
// Compatibility response for persisted legacy connections; no VPN/Go runtime.
class MeshBridge(activity: Activity, messenger: BinaryMessenger) {
    init { MethodChannel(messenger, "dev.mydex/mesh").setMethodCallHandler { _, result ->
        result.error("MIGRATION_REQUIRED", "请更新电脑连接器后重新扫描应用版二维码", null)
    } }
}
