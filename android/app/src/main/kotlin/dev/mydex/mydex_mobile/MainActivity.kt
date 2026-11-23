package dev.mydex.mydex_mobile

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.content.Context
import android.content.Intent
import com.google.zxing.integration.android.IntentIntegrator
import com.journeyapps.barcodescanner.CaptureActivity

class PairingCaptureActivity : CaptureActivity()

class MainActivity: FlutterActivity() {
    private var scanResult: MethodChannel.Result? = null
    @Deprecated("Used by ZXing IntentIntegrator")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        val scanned = IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
        if (scanned != null) {
            scanResult?.success(scanned.contents)
            scanResult = null
        } else super.onActivityResult(requestCode, resultCode, data)
    }
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MeshBridge(this, flutterEngine.dartExecutor.binaryMessenger)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "dev.mydex/device")
            .setMethodCallHandler { call, result ->
                if (call.method == "scanPairing") {
                    if (scanResult != null) result.error("BUSY", "扫码已打开", null)
                    else {
                        scanResult = result
                        try {
                            IntentIntegrator(this).setCaptureActivity(PairingCaptureActivity::class.java)
                                .setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
                                .setPrompt("扫描电脑 Mydex → 配对手机中的二维码\n返回可使用粘贴配对")
                                .setBeepEnabled(false).setBarcodeImageEnabled(false)
                                .setOrientationLocked(false).initiateScan()
                        } catch (e: Exception) { scanResult = null; result.error("CAMERA", "无法打开相机", null) }
                    }
                } else if (call.method == "openWebsite") {
                    startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://app.leftseinem.com/")))
                    result.success(true)
                } else if (call.method == "appVersion") {
                    val info = packageManager.getPackageInfo(packageName, 0)
                    val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
                    result.success(mapOf("code" to code, "name" to info.versionName))
                } else if (call.method == "installUpdate") {
                    try {
                        val file = java.io.File(cacheDir, "updates/update.apk")
                        if (!file.isFile) throw IllegalStateException("更新文件不存在")
                        @Suppress("DEPRECATION")
                        val archive = packageManager.getPackageArchiveInfo(file.path, android.content.pm.PackageManager.GET_SIGNATURES)
                            ?: throw IllegalStateException("无效更新包")
                        @Suppress("DEPRECATION")
                        val installed = packageManager.getPackageInfo(packageName, android.content.pm.PackageManager.GET_SIGNATURES)
                        @Suppress("DEPRECATION")
                        val expected = installed.signatures?.map { it.toCharsString() }?.sorted()
                        @Suppress("DEPRECATION")
                        val actual = archive.signatures?.map { it.toCharsString() }?.sorted()
                        if (archive.packageName != packageName || expected.isNullOrEmpty() || actual != expected) {
                            throw IllegalStateException("更新包身份不符")
                        }
                        if (Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
                            startActivity(android.content.Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:$packageName")))
                            result.success(false)
                        } else {
                            val uri = androidx.core.content.FileProvider.getUriForFile(this, "$packageName.updates", file)
                            startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION))
                            result.success(true)
                        }
                    } catch (e: Exception) { result.error("INSTALL", "无法打开安装界面，请检查系统安装权限", null) }
                } else if (call.method == "vibrate") {
                    val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        vibrator.vibrate(VibrationEffect.createOneShot(180, VibrationEffect.DEFAULT_AMPLITUDE))
                    } else {
                        @Suppress("DEPRECATION")
                        vibrator.vibrate(180)
                    }
                    result.success(null)
                } else result.notImplemented()
            }
    }
}
