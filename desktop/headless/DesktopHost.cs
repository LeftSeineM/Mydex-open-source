using System;
using System.IO;
using System.Diagnostics;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Stable launcher outside release slots. UI updates never change data roots.
class DesktopHost {
 [STAThread] static int Main(string[] args) {
  try {
   var root=AppDomain.CurrentDomain.BaseDirectory;
   var current=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,"current.json")));
   var slot=(string)current["slot"];
   if(!System.Text.RegularExpressions.Regex.IsMatch(slot,@"^\d+\.\d+\.\d+-[a-f0-9]{8}$"))throw new Exception();
   var release=Path.Combine(root,"releases",slot);
   var exe=Path.Combine(release,"Mydex.exe");
   if(!File.Exists(exe))throw new Exception();
   var start=new ProcessStartInfo(exe,args.Length>0&&args[0]=="--tray"?"--tray":"") {UseShellExecute=false,WorkingDirectory=release};
   start.EnvironmentVariables["MYDEX_INSTALL_ROOT"]=root.TrimEnd(Path.DirectorySeparatorChar);
   start.EnvironmentVariables["MYDEX_DATA_DIR"]=Path.Combine(root,"data");
   Process.Start(start);return 0;
  }catch{
   MessageBox.Show("当前后台版本没有可用的桌面窗口，或安装未完成。请核对私测安装状态；已有配置未修改。","Mydex",MessageBoxButtons.OK,MessageBoxIcon.Information);return 1;
  }
 }
}
