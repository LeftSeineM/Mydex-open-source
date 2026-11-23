using System;
using System.IO;
class DesktopProfileTest {
 static void Check(bool ok,string reason){if(!ok)throw new Exception(reason);}
 static int Main(){
  var root=Path.Combine(Path.GetTempPath(),"mydex-profile-"+Guid.NewGuid().ToString("N"));
  Directory.CreateDirectory(root);
  try{
   Environment.SetEnvironmentVariable("MYDEX_INSTALL_ROOT",null);
   Environment.SetEnvironmentVariable("MYDEX_DATA_DIR",null);
   Check(DesktopProfile.Name=="MydexMobileConnector","Legacy autostart identity changed");
   Check(DesktopProfile.Identity(root)==DesktopProfile.Identity(root.ToUpperInvariant()+Path.DirectorySeparatorChar),"Windows case/trailing separator changed identity");
   Environment.SetEnvironmentVariable("MYDEX_INSTALL_ROOT",root);
   Environment.SetEnvironmentVariable("MYDEX_DATA_DIR",Path.Combine(root,"data"));
   var first=DesktopProfile.Name;
   Check(first.StartsWith("MydexShared-"),"Shared profile uses legacy mutex");
   Environment.SetEnvironmentVariable("MYDEX_DATA_DIR",Path.Combine(root,"other-data"));
   Check(DesktopProfile.Name!=first,"Distinct profiles collide");
   bool missing=false;try{var ignored=DesktopProfile.Launcher;}catch{missing=true;}Check(missing,"Missing stable launcher fell back to release slot");
   File.WriteAllText(Path.Combine(root,"Mydex.exe"),"fixture");
   Check(DesktopProfile.Launcher==Path.Combine(root,"Mydex.exe"),"Autostart does not use stable launcher");
   Console.WriteLine("PASS: legacy identity, Windows normalization, profile isolation, stable launcher, missing launcher rejection; no registry writes");return 0;
  }finally{
   if(!Path.GetFullPath(root).StartsWith(Path.GetFullPath(Path.GetTempPath()),StringComparison.OrdinalIgnoreCase))throw new Exception("Unsafe test cleanup");
   Directory.Delete(root,true);
  }
 }
}
