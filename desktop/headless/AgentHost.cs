using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Collections.Generic;
// A windowless stdio bootstrap, not a desktop application. PowerShell does not
// reliably preserve bidirectional native stdin for MCP on Windows PowerShell 5.
class AgentHost {
 static string Quote(string value) {return "\""+value+"\"";}
 static async Task Pump(Stream source,Stream destination) {
  var buffer=new byte[8192];int count;
  while((count=await source.ReadAsync(buffer,0,buffer.Length))>0){await destination.WriteAsync(buffer,0,count);await destination.FlushAsync();}
 }
 [STAThread] static int Main(string[] args) {
  try {
   var root=AppDomain.CurrentDomain.BaseDirectory;
   var json=new JavaScriptSerializer();
   var current=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,"current.json")));
   var slot=(string)current["slot"];
   if(!System.Text.RegularExpressions.Regex.IsMatch(slot,@"^\d+\.\d+\.\d+-[a-f0-9]{8}$"))return 2;
   var release=Path.Combine(root,"releases",slot);
   bool mcp=args.Length>0&&args[0]=="--mcp";
   var start=new ProcessStartInfo(Path.Combine(release,"runtime","node.exe"),Quote(Path.Combine(release,"desktop","headless",mcp?"mcp.mjs":"cli.mjs"))) {
    UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,WorkingDirectory=root
   };
   start.EnvironmentVariables["MYDEX_INSTALL_ROOT"]=root.TrimEnd(Path.DirectorySeparatorChar);
   start.EnvironmentVariables["MYDEX_DATA_DIR"]=Path.Combine(root,"data");
   start.EnvironmentVariables.Remove("MYDEX_CLI_ARGUMENTS");
   if(!mcp)start.EnvironmentVariables["MYDEX_CLI_ARGUMENTS"]=Convert.ToBase64String(Encoding.UTF8.GetBytes(json.Serialize(args)));
   using(var child=Process.Start(start)) {
    var input=Task.Run(async()=>{try{await Pump(Console.OpenStandardInput(),child.StandardInput.BaseStream);child.StandardInput.Close();}catch{}});
    var output=Pump(child.StandardOutput.BaseStream,Console.OpenStandardOutput());
    var error=Pump(child.StandardError.BaseStream,Console.OpenStandardError());
    child.WaitForExit();Task.WaitAll(output,error);return child.ExitCode;
   }
  }catch{return 1;}
 }
}
