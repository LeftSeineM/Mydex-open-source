using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class Launcher {
    [STAThread]
    private static void Main() {
        try {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string node = Path.Combine(root, @"runtime\node.exe");
            string server = Path.Combine(root, @"desktop\headless\p2p-lab\server.mjs");
            Process.Start(new ProcessStartInfo(node, "\"" + server + "\"") {
                UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = root
            });
        } catch (Exception) {
            MessageBox.Show("请先完整解压 Mydex 私测包，再打开 P2P 测试。", "Mydex", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
