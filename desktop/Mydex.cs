using System;
using System.Collections.Generic;
using System.Collections;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;
[assembly: System.Reflection.AssemblyVersion("0.4.26.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.4.26.0")]

static class DesktopProfile {
 internal static string Identity(string directory){
  var normalized=Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar,Path.AltDirectorySeparatorChar).ToUpperInvariant();
  using(var sha=System.Security.Cryptography.SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(normalized))).Replace("-","").Substring(0,16);
 }
 internal static bool Shared {get{return !String.IsNullOrEmpty(Environment.GetEnvironmentVariable("MYDEX_INSTALL_ROOT"));}}
 internal static string Name {get{return Shared?"MydexShared-"+Identity(Environment.GetEnvironmentVariable("MYDEX_DATA_DIR")??Path.Combine(Environment.GetEnvironmentVariable("MYDEX_INSTALL_ROOT"),"data")):"MydexMobileConnector";}}
 internal static string Launcher {get{
  if(!Shared)return Application.ExecutablePath;
  var root=Environment.GetEnvironmentVariable("MYDEX_INSTALL_ROOT");
  var launcher=Path.Combine(root,"Mydex.exe");
  if(!File.Exists(launcher))throw new Exception("未找到固定桌面入口，暂不设置自启，避免绑定即将被替换的版本目录。");
  return launcher;
 }}
}

class Bridge : IDisposable {
 readonly Process p; readonly StreamWriter input; readonly JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=16000000};
 readonly Dictionary<int,TaskCompletionSource<Dictionary<string,object>>> pending=new Dictionary<int,TaskCompletionSource<Dictionary<string,object>>>(); int seq;
 public Bridge(string root){
  p=new Process{StartInfo=new ProcessStartInfo(Path.Combine(root,"runtime/node.exe"),"\""+Path.Combine(root,"desktop/connection-entry.mjs")+"\""){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8,WorkingDirectory=root}};
  p.OutputDataReceived+=(s,e)=>{if(e.Data==null)return;try{var m=json.Deserialize<Dictionary<string,object>>(e.Data);var id=Convert.ToInt32(m["id"]);TaskCompletionSource<Dictionary<string,object>> t;lock(pending){if(!pending.TryGetValue(id,out t))return;pending.Remove(id);}if(m.ContainsKey("error"))t.TrySetException(new Exception(m["error"].ToString()));else t.TrySetResult((Dictionary<string,object>)m["result"]);}catch{}};
  p.EnableRaisingEvents=true;p.Exited+=(s,e)=>{lock(pending){foreach(var t in pending.Values)t.TrySetException(new Exception("后台连接程序已退出，请重新打开 Mydex"));pending.Clear();}};
  p.Start();input=new StreamWriter(p.StandardInput.BaseStream,new UTF8Encoding(false)){AutoFlush=true};p.BeginOutputReadLine();p.ErrorDataReceived+=(s,e)=>{};p.BeginErrorReadLine();
 }
 public async Task<Dictionary<string,object>> Call(string action,object args=null){
  var id=Interlocked.Increment(ref seq);var t=new TaskCompletionSource<Dictionary<string,object>>();lock(pending)pending[id]=t;
  try{input.WriteLine(json.Serialize(new {id,action,args}));if(await Task.WhenAny(t.Task,Task.Delay(action=="installClaude"?300000:30000))!=t.Task)throw new Exception("电脑响应超时，请查看状态后重试");return await t.Task;}finally{lock(pending)pending.Remove(id);}
 }
 public void Dispose(){try{input.Close();if(!p.WaitForExit(1800))p.Kill();}catch{}p.Dispose();}
}

// Owner-drawn controls retain native keyboard and accessibility behavior.
class SoftButton : Button {
 public bool Primary, Selected, Navigation; bool hover;
 public SoftButton(){SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer,true);Cursor=Cursors.Hand;}
 protected override void OnMouseEnter(EventArgs e){hover=true;Invalidate();base.OnMouseEnter(e);}
 protected override void OnMouseLeave(EventArgs e){hover=false;Invalidate();base.OnMouseLeave(e);}
 protected override void OnPaint(PaintEventArgs e){
  var g=e.Graphics;g.SmoothingMode=SmoothingMode.AntiAlias;g.Clear(Parent==null?Color.White:Parent.BackColor);
  var r=new RectangleF(1,1,Width-3,Height-3);float radius=Math.Min(10,Height/4f);var d=radius*2;
  using(var path=new GraphicsPath()){
   path.AddArc(r.Left,r.Top,d,d,180,90);path.AddArc(r.Right-d,r.Top,d,d,270,90);path.AddArc(r.Right-d,r.Bottom-d,d,d,0,90);path.AddArc(r.Left,r.Bottom-d,d,d,90,90);path.CloseFigure();
   var bg=Primary?Color.FromArgb(54,87,118):Selected?Color.FromArgb(229,235,243):hover?Color.FromArgb(239,242,246):Navigation?Parent.BackColor:Color.White;
   using(var brush=new SolidBrush(bg))g.FillPath(brush,path);
   if(!Navigation&&!Primary)using(var pen=new Pen(Color.FromArgb(223,228,235)))g.DrawPath(pen,path);
   if(Focused&&ShowFocusCues&&!Navigation)using(var pen=new Pen(Color.FromArgb(111,143,175),2))g.DrawPath(pen,path);
  }
  if(Navigation&&Focused&&ShowFocusCues)ControlPaint.DrawFocusRectangle(g,Rectangle.Inflate(ClientRectangle,-6,-6));
  var selectedNav=Navigation&&Selected;
  if(selectedNav)using(var accent=new SolidBrush(Color.FromArgb(57,93,131)))g.FillRectangle(accent,7,Height/3,3,Height/3);
  using(var selectedFont=new Font(Font,selectedNav?FontStyle.Bold:Font.Style))TextRenderer.DrawText(g,Text,selectedFont,ClientRectangle,!Enabled?Color.Gray:Primary?Color.White:selectedNav?Color.FromArgb(44,78,115):ForeColor,TextFormatFlags.HorizontalCenter|TextFormatFlags.VerticalCenter|TextFormatFlags.SingleLine);
 }
}

class Mydex : Form {
 readonly Color ink=Color.FromArgb(34,39,46),blue=Color.FromArgb(57,93,131),muted=Color.FromArgb(105,115,128);
 readonly Panel page=new Panel{Dock=DockStyle.Fill,Padding=new Padding(32,24,32,24),BackColor=Color.White};
 readonly Label title=new Label(),message=new Label(),connection=new Label(),summary=new Label();
 string notifiedVersion="";
 readonly Dictionary<string,SoftButton> navButtons=new Dictionary<string,SoftButton>();
 readonly NotifyIcon tray=new NotifyIcon();readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer{Interval=5000};
 readonly Bridge bridge; bool quitting,refreshing,configured,owned,layoutReady;string role="",view="overview";Dictionary<string,object> state;
 Action<int> selectPairingMode;DataGridView grid;Label bridgeInfo,updateStatus,updateNotes;Button updateAction;int bridgeSelection=0;
 static string S(Dictionary<string,object> d,string k){return d!=null&&d.ContainsKey(k)&&d[k]!=null?d[k].ToString():"";}
 static bool B(Dictionary<string,object>d,string k){return S(d,k)=="True";}
 Label LabelText(string text,int size=10,Color? color=null){return new Label{Text=text,AutoSize=true,Font=new Font("Microsoft YaHei UI",size),ForeColor=color??ink,Margin=new Padding(0,0,0,12),MaximumSize=new Size(760,0)};}
 Button Btn(string text,Func<Task> action,bool primary=false){var b=new SoftButton{Primary=primary,Text=text,AutoSize=true,MinimumSize=new Size(112,38),FlatStyle=FlatStyle.Flat,BackColor=primary?blue:Color.White,ForeColor=primary?Color.White:ink,Padding=new Padding(14,4,14,4),Margin=new Padding(0,0,10,12)};b.FlatAppearance.BorderColor=Color.FromArgb(219,224,231);b.Click+=async(s,e)=>{b.Enabled=false;try{await action();}catch(Exception ex){Error(ex.Message);}finally{if(!b.IsDisposed){b.Enabled=true;if(b==updateAction)PaintUpdate();}}};return b;}
 void Error(string text){message.Text=text;message.ForeColor=Color.FromArgb(170,62,55);}
 FlowLayoutPanel Stack(Control parent){var s=new FlowLayoutPanel{Dock=DockStyle.Fill,FlowDirection=FlowDirection.TopDown,WrapContents=false,AutoScroll=true};parent.Controls.Add(s);return s;}
 void Header(string text,string sub){page.Controls.Clear();var top=new Panel{Dock=DockStyle.Top,Height=88};title.Text=text;title.Font=new Font("Microsoft YaHei UI",19,FontStyle.Bold);title.ForeColor=ink;title.AutoEllipsis=true;title.Dock=DockStyle.Top;title.Height=38;var note=new Label{Text=sub,Dock=DockStyle.Bottom,Height=40,Font=Font,ForeColor=muted};top.Controls.Add(title);top.Controls.Add(note);page.Controls.Add(top);top.BringToFront();}
 Panel Body(){var body=new Panel{Dock=DockStyle.Fill};page.Controls.Add(body);body.BringToFront();return body;}
 public Mydex(bool hidden){
  Text="Mydex";Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath);MinimumSize=new Size(960,680);Size=new Size(1080,750);StartPosition=FormStartPosition.CenterScreen;AutoScaleMode=AutoScaleMode.None;Font=new Font("Microsoft YaHei UI",10);BackColor=Color.White;
  var nav=new FlowLayoutPanel{Dock=DockStyle.Left,Width=198,BackColor=Color.FromArgb(245,247,250),FlowDirection=FlowDirection.TopDown,WrapContents=false,Padding=new Padding(20,26,16,20)};
  nav.Controls.Add(new PictureBox{Image=Icon.ToBitmap(),SizeMode=PictureBoxSizeMode.Zoom,Width=42,Height=42,Margin=new Padding(0,0,0,12)});nav.Controls.Add(LabelText("Mydex",20,ink));nav.Controls.Add(LabelText("电脑连接中心",10,muted));nav.Controls.Add(new Panel{Height=16,Width=140});
  foreach(var item in new[]{new[]{"连接概览","overview"},new[]{"工具接入","tools"},new[]{"配对手机","pair"},new[]{"设置","settings"}}){var dest=item[1];var b=Btn(item[0],()=>{ShowPage(dest);return Task.CompletedTask;});b.AutoSize=false;b.Size=new Size(156,42);((SoftButton)b).Navigation=true;navButtons[dest]=(SoftButton)b;nav.Controls.Add(b);}
  nav.Controls.Add(new Panel{Height=54,Width=140});nav.Controls.Add(LabelText("桌面连接器 0.4.26",9,muted));nav.Controls.Add(LabelText("数据留在你的电脑",9,muted));
  var footer=new Panel{Dock=DockStyle.Bottom,Height=48,Padding=new Padding(24,10,12,8),BackColor=Color.FromArgb(249,250,252)};message.Dock=DockStyle.Fill;message.Text="正在检查本机连接…";message.ForeColor=muted;footer.Controls.Add(message);
  Controls.Add(page);Controls.Add(nav);Controls.Add(footer);
  var menu=new ContextMenuStrip();menu.Items.Add("打开 Mydex",null,(s,e)=>Restore());menu.Items.Add("启动连接",null,async(s,e)=>{try{await bridge.Call("start");await RefreshState();}catch(Exception ex){Error(ex.Message);Restore();}});menu.Items.Add("停止连接…",null,async(s,e)=>{try{await StopConnection();}catch(Exception ex){Error(ex.Message);}});menu.Items.Add(new ToolStripSeparator());menu.Items.Add("检查更新",null,async(s,e)=>{Restore();ShowPage("settings");await CheckUpdate();});menu.Items.Add("退出 Mydex",null,(s,e)=>{quitting=true;Close();});
  tray.Icon=Icon;tray.Text="Mydex · 正在检查连接";tray.ContextMenuStrip=menu;tray.Visible=true;tray.DoubleClick+=(s,e)=>Restore();tray.BalloonTipClicked+=(s,e)=>{Restore();ShowPage("settings");};
  bridge=new Bridge(AppDomain.CurrentDomain.BaseDirectory);ShowPage("overview");
  using(var g=CreateGraphics()){var f=g.DpiX/96f;Scale(new SizeF(f,f));}layoutReady=true;
  timer.Tick+=async(s,e)=>await RefreshState();timer.Start();Shown+=async(s,e)=>{if(hidden)Hide();while(refreshing)await Task.Delay(100);await RefreshState();if(hidden&&configured&&!B(state,"connected")){try{await bridge.Call("start");}catch(Exception ex){Error(ex.Message);}}};
  FormClosing+=(s,e)=>{if(!quitting&&e.CloseReason==CloseReason.UserClosing){e.Cancel=true;Hide();tray.ShowBalloonTip(2000,"Mydex","连接继续在托盘运行。右键托盘图标可退出。",ToolTipIcon.Info);}else{timer.Stop();tray.Visible=false;tray.Dispose();bridge.Dispose();}};
 }
 void Restore(){Show();WindowState=FormWindowState.Normal;Activate();}
 async Task StopConnection(){
  var current=await bridge.Call("status");
  if(!B(current,"connected"))return;
  if(B(current,"sharedOwner")){
   if(MessageBox.Show("停止共享连接会断开手机和插件对这台电脑的访问。原软件中的任务不会因此取消，记录和配对保留。\n\n如果只想退出窗口，请选择取消后退出 Mydex。是否停止共享连接？","Mydex · 停止共享连接",MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes)return;
  }else if(!B(current,"owned"))throw new Exception("此连接由其他程序管理，请到原入口停止。");
  await bridge.Call("stop");await RefreshState();
 }
 async Task RefreshState(){if(refreshing)return;refreshing=true;try{state=await bridge.Call("status",new {force=view=="tools"});configured=B(state,"configured");owned=B(state,"owned");role=S(state,"role");var ok=B(state,"connected");connection.Text=!configured?"连接你的第一台电脑":ok?"本机服务已就绪":owned?"正在启动连接服务":"连接服务已停止";connection.ForeColor=ok?Color.FromArgb(48,124,87):ink;summary.Text=!configured?"配置本机地址，然后复制配对信息到手机。":"手机直接连接这台电脑；多台电脑在手机中统一管理。"+"\n"+(ok&&!owned?"检测到外部连接服务，本应用不会重复启动它。":"关闭窗口后，连接可继续在托盘运行。");tray.Text="Mydex · "+connection.Text;message.Text=S(state,"error");if(message.Text.Length==0){message.ForeColor=muted;message.Text="上次检查 "+DateTime.Now.ToString("HH:mm:ss")+"  ·  "+(configured?"配置已保存":"等待首次设置");}var update=UpdateState();if(S(update,"phase")=="available"&&S(update,"latest")!=notifiedVersion){notifiedVersion=S(update,"latest");tray.ShowBalloonTip(5000,"Mydex 有新版本",notifiedVersion+" 已可下载，点击打开更新设置。",ToolTipIcon.Info);}if(view=="tools"){FillTools();UpdateBridgeHelp();message.Text=BridgeStatusText();}if(view=="settings")PaintUpdate();}catch(Exception ex){Error(ex.Message);}finally{refreshing=false;}}
 void ShowPage(string name){view=name;foreach(var entry in navButtons){entry.Value.Selected=entry.Key==name;entry.Value.Invalidate();}
  if(name=="overview"){
   Header("你的电脑，随身连接","每台电脑独立运行。把连接信息粘贴到手机，继续原来的项目与对话。");var s=Stack(Body());
   var card=new Panel{Width=720,Height=132,BackColor=Color.FromArgb(241,246,252),Padding=new Padding(24),Margin=new Padding(0,4,0,18)};
   connection.AutoSize=false;connection.Dock=DockStyle.Top;connection.Height=42;connection.Font=new Font("Microsoft YaHei UI",17,FontStyle.Bold);card.Controls.Add(connection);
   summary.AutoSize=false;summary.Dock=DockStyle.Bottom;summary.Height=48;summary.Font=Font;summary.ForeColor=muted;card.Controls.Add(summary);s.Controls.Add(card);
   var row=new FlowLayoutPanel{AutoSize=true,MaximumSize=new Size(760,0)};
   row.Controls.Add(Btn("启动连接",async()=>{if(B(state,"connected"))throw new Exception("连接已经运行，无需重复启动");await bridge.Call("start");await RefreshState();},true));
   row.Controls.Add(Btn("停止连接",StopConnection));
   row.Controls.Add(Btn("配对手机",()=>{ShowPage("pair");return Task.CompletedTask;}));s.Controls.Add(row);
   s.Controls.Add(LabelText("快速开始",12));
   var quick=new FlowLayoutPanel{AutoSize=true,MaximumSize=new Size(760,0),Margin=new Padding(0,0,0,12)};
   quick.Controls.Add(Btn("配置本机",ConfigureHub));quick.Controls.Add(Btn("连接手机",()=>{ShowPage("pair");return Task.CompletedTask;}));quick.Controls.Add(Btn("检查工具",()=>{ShowPage("tools");return Task.CompletedTask;}));s.Controls.Add(quick);
   s.Controls.Add(LabelText("在手机中添加电脑，粘贴配对信息即可连接。",10,muted));
   s.Controls.Add(LabelText("每台电脑独立连接 · 数据保留在本机 · 关闭窗口后托盘运行",9,muted));
  }else if(name=="tools"){
   Header("工具接入","自动检查本机安装、运行进程与实际会话。读取和控制能力分别显示。");var body=Body();var bottom=new FlowLayoutPanel{Dock=DockStyle.Bottom,AutoSize=true,AutoSizeMode=AutoSizeMode.GrowAndShrink,WrapContents=true};bottom.Controls.Add(Btn("重新检查",RefreshState));
   var choices=new[]{"Claude Desktop","DeepSeek Harness","ZCode","Gemini CLI","Kimi Code"};Action paintBridge=()=>{};SoftButton selector=null;var menu=new ContextMenuStrip();for(int i=0;i<choices.Length;i++){int selected=i;menu.Items.Add(choices[i],null,(a,e)=>{bridgeSelection=selected;selector.Text=choices[selected]+"  ▾";paintBridge();});}selector=(SoftButton)Btn(choices[bridgeSelection]+"  ▾",()=>{menu.Show(selector,new Point(0,selector.Height));return Task.CompletedTask;});selector.MinimumSize=new Size(190,38);bottom.Controls.Add(selector);
   var action=Btn("安装兼容桥",async()=>{if(bridgeSelection==0){if(NeedsBridgeRestore("claude",B(state,"claudeCompatibility")))await RestoreBridge("claude");else if(ToolConnected("claude-desktop"))message.Text="原会话已接通，无需重复安装";else await InstallClaude();}else if(bridgeSelection==4){await RefreshState();message.Text=ToolConnected("kimi")?"Kimi 原会话已接通。":"请启动 Kimi Code 桌面端，再检查接入状态。";}else{var ids=new[]{"","deepseek","zcode","gemini"};var id=ids[bridgeSelection];var installed=state!=null&&state.ContainsKey("toolBridgeInstalled")?state["toolBridgeInstalled"] as Dictionary<string,object>:null;if(NeedsBridgeRestore(id,B(installed,id)))await RestoreBridge(id);else if(ToolConnected(id))message.Text="检测到已通过其他方式接入，无需重复安装；还原请使用原安装备份。";else await InstallToolBridge(id,choices[bridgeSelection]);}});
   var openCompatible=Btn("打开 Claude 兼容版",async()=>{await bridge.Call("launchClaudeCompatibility");message.Text="已请求启动兼容版，正在等待原会话接口…";});paintBridge=()=>{UpdateBridgeHelp();openCompatible.Visible=bridgeSelection==0&&B(BridgeStatus("claude"),"installed")&&S(BridgeStatus("claude"),"mode")=="storeCopy";message.Text=BridgeStatusText();var ids=new[]{"","deepseek","zcode","gemini"};var installed=state!=null&&state.ContainsKey("toolBridgeInstalled")?state["toolBridgeInstalled"] as Dictionary<string,object>:null;action.Text=bridgeSelection==4?"检查 Kimi 接入":(bridgeSelection==0?NeedsBridgeRestore("claude",B(state,"claudeCompatibility")):NeedsBridgeRestore(ids[bridgeSelection],B(installed,ids[bridgeSelection])))?"还原原版":bridgeSelection>0&&ToolConnected(ids[bridgeSelection])?"已通过既有桥接入":"安装兼容桥";if(bridgeSelection==0&&S(BridgeStatus("claude"),"mode")=="storeCopy")action.Text="回退并删除副本";};paintBridge();bottom.Controls.Add(action);bottom.Controls.Add(openCompatible);bottom.Controls.Add(Btn("接入诊断",async()=>{if(bridgeSelection>2){await RefreshState();return;}var ids=new[]{"claude","deepseek","zcode"};message.Text="正在识别应用并检查接入…";var d=await bridge.Call("bridgeDiagnostics",new {id=ids[bridgeSelection]});MessageBox.Show("自动发现："+(B(d,"detected")?"已找到":"未找到")+"\n程序位置："+S(d,"app")+"\n程序运行："+(B(d,"processRunning")?"运行中":"未运行")+"\n桥接文件："+S(d,"files")+"\n原会话接口："+(B(d,"connected")?"已接通":"未接通")+"\n\n"+S(d,"message")+(S(d,"lastError").Length>0?"\n\n上次安装错误："+S(d,"lastError"):""),"Mydex · 接入诊断",MessageBoxButtons.OK,MessageBoxIcon.Information);}));body.Controls.Add(bottom);
   bridgeInfo=new Label{Text=BridgeHelpSummary(),Dock=DockStyle.Top,Height=88,Font=new Font("Microsoft YaHei UI",9),ForeColor=muted,Padding=new Padding(7,8,7,8),AutoEllipsis=true};body.Controls.Add(bridgeInfo);body.SizeChanged+=(sender,args)=>UpdateBridgeHelp();UpdateBridgeHelp();
   bottom.Controls.Add(Btn("桥接说明",()=>{MessageBox.Show(BridgeHelpDetails(),"Mydex · 连接桥说明",MessageBoxButtons.OK,MessageBoxIcon.Information);return Task.CompletedTask;}));
   grid=new DataGridView{Dock=DockStyle.Fill,ReadOnly=true,AllowUserToAddRows=false,AllowUserToDeleteRows=false,RowHeadersVisible=false,BackgroundColor=Color.White,BorderStyle=BorderStyle.None,AutoSizeRowsMode=DataGridViewAutoSizeRowsMode.AllCells,SelectionMode=DataGridViewSelectionMode.FullRowSelect,MultiSelect=false,EnableHeadersVisualStyles=false};grid.ColumnHeadersDefaultCellStyle.BackColor=Color.FromArgb(242,245,249);grid.ColumnHeadersBorderStyle=DataGridViewHeaderBorderStyle.None;grid.CellBorderStyle=DataGridViewCellBorderStyle.SingleHorizontal;grid.GridColor=Color.FromArgb(237,240,244);grid.ColumnHeadersHeight=42;grid.ColumnHeadersDefaultCellStyle.ForeColor=muted;grid.AlternatingRowsDefaultCellStyle.BackColor=Color.FromArgb(250,251,253);grid.DefaultCellStyle.Padding=new Padding(7);grid.DefaultCellStyle.Font=new Font("Microsoft YaHei UI",9);grid.DefaultCellStyle.WrapMode=DataGridViewTriState.True;grid.DefaultCellStyle.SelectionBackColor=Color.FromArgb(231,239,249);grid.DefaultCellStyle.SelectionForeColor=ink;
   grid.Columns.Add("name","工具");grid.Columns.Add("running","进程");grid.Columns.Add("history","会话读取");grid.Columns.Add("send","继续对话");grid.Columns.Add("note","接入说明");grid.Columns[0].Width=135;grid.Columns[1].Width=85;grid.Columns[2].Width=100;grid.Columns[3].Width=105;grid.Columns[4].AutoSizeMode=DataGridViewAutoSizeColumnMode.Fill;using(var graphics=CreateGraphics()){var scale=graphics.DpiX/96f;for(int i=0;i<4;i++)grid.Columns[i].Width=(int)(grid.Columns[i].Width*scale);grid.ColumnHeadersHeight=(int)(42*scale);}body.Controls.Add(grid);grid.BringToFront();FillTools();
  }else if(name=="pair"){
   Header("配对手机","选择手机使用方式，再生成一个对应的二维码。");var s=Stack(Body());
   s.Controls.Add(LabelText("手机使用方式",12));
   var mode=0;var modes=new FlowLayoutPanel{AutoSize=true,WrapContents=false,Margin=new Padding(0,8,0,8)};
   var androidMode=(SoftButton)Btn("应用版",()=>{selectPairingMode(0);return Task.CompletedTask;});
   var webMode=(SoftButton)Btn("网页版",()=>{selectPairingMode(1);return Task.CompletedTask;});
   modes.Controls.Add(androidMode);modes.Controls.Add(webMode);s.Controls.Add(modes);
   var explanation=LabelText("",10,muted);explanation.MaximumSize=new Size(650,0);s.Controls.Add(explanation);
   var copy=Btn("复制配对信息",async()=>{var mesh=mode==0;var p=await bridge.Call(mesh?"tunnelPairing":"relayPairing");Clipboard.SetText(S(p,mesh?"bundle":"url"));message.Text=mesh?"已复制，在手机 Mydex 中粘贴配对":"已复制网页登录配对链接，请在自己的手机浏览器打开";});
   Action describe=()=>{explanation.Text=mode==0?"手机安装 Mydex，扫码即可连接，无需第三方账号。\n电脑换 IP 后自动重连；这台电脑需要保持在线。":"在手机浏览器中使用。连接经由小主机中继，\n需要小主机与这台电脑同时在线。";copy.Text=mode==0?"复制配对信息":"复制网页登录链接";};
   selectPairingMode=value=>{mode=value;androidMode.Selected=mode==0;webMode.Selected=mode==1;androidMode.Invalidate();webMode.Invalidate();describe();};selectPairingMode(0);
   s.Controls.Add(Btn("生成配对二维码",()=>ShowPairingQr(false,mode==1,mode==0),true));s.Controls.Add(copy);
   s.Controls.Add(LabelText("点击生成二维码，按提示在手机上完成配对。",10,muted));
   s.Controls.Add(LabelText("一次只显示所选方式的二维码。二维码过期后可刷新。\n添加其他电脑时，在那台电脑重复配对即可。",9,muted));
  }else{
   Header("设置","启动行为与本机数据。");var s=Stack(Body());var auto=new CheckBox{Text="开机登录后自动启动 Mydex，并保持在托盘",AutoSize=true,Margin=new Padding(0,20,0,20),Checked=Autostart()};auto.CheckedChanged+=(a,e)=>{try{using(var key=Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")){if(auto.Checked)key.SetValue(DesktopProfile.Name,"\""+DesktopProfile.Launcher+"\" --tray");else key.DeleteValue(DesktopProfile.Name,false);}message.Text="自启设置已保存";}catch(Exception ex){Error(ex.Message);}};s.Controls.Add(auto);s.Controls.Add(LabelText("关闭窗口会收起到托盘。退出应用会停止由本应用启动的连接；原来的外部服务不受影响。",10,muted));s.Controls.Add(Btn("接入已有本机配置",Attach));s.Controls.Add(Btn("打开本机数据目录",()=>{Process.Start("explorer.exe",S(state,"dataRoot"));return Task.CompletedTask;}));s.Controls.Add(LabelText("Mydex 桌面连接器 0.4.26",13));s.Controls.Add(Btn("官网与下载",()=>{Process.Start("https://app.leftseinem.dpdns.org/");return Task.CompletedTask;}));updateStatus=LabelText("正在读取更新状态…",10);updateNotes=LabelText("",9,muted);s.Controls.Add(updateStatus);s.Controls.Add(updateNotes);var updateRow=new FlowLayoutPanel{AutoSize=true,WrapContents=true};updateRow.Controls.Add(Btn("检查更新",CheckUpdate));updateAction=Btn("下载更新",ApplyUpdate,true);updateRow.Controls.Add(updateAction);s.Controls.Add(updateRow);s.Controls.Add(LabelText("启动后自动检查；下载、安装由你确认。更新保留连接配置。",9,muted));PaintUpdate();s.Controls.Add(LabelText("联系开发者 · 348897402@qq.com",10));s.Controls.Add(Btn("复制开发者邮箱",()=>{Clipboard.SetText("348897402@qq.com");message.Text="邮箱已复制。反馈时请注明版本和复现步骤，不要发送令牌或私人日志。";return Task.CompletedTask;}));s.Controls.Add(LabelText("无需安装 Node。模型、工具账号和 API 配置沿用电脑现有设置。\n当前提供 Windows x64 版本。",10,muted));
  }
  if(name=="settings"&&B(state,"sharedOwner")){
   foreach(Control outer in page.Controls)foreach(Control inner in outer.Controls)if(inner is FlowLayoutPanel)inner.Controls.Add(Btn("安装私测后台更新",UpdateSharedService));
  }
  if(layoutReady){using(var g=CreateGraphics()){var f=g.DpiX/96f;foreach(Control c in page.Controls)c.Scale(new SizeF(f,f));}}
  if(!refreshing){var ignored=RefreshState();}
 }
 Dictionary<string,object> UpdateState(){return state!=null&&state.ContainsKey("update")?state["update"] as Dictionary<string,object>:null;}
 void PaintUpdate(){if(updateStatus==null||updateStatus.IsDisposed)return;var u=UpdateState();var phase=S(u,"phase");updateStatus.Text=S(u,"message");updateNotes.Text=S(u,"notes");if(updateAction!=null&&!updateAction.IsDisposed){updateAction.Text=phase=="ready"?"安装并重启":phase=="downloading"?"下载中 "+S(u,"progress")+"%":"下载更新";updateAction.Enabled=phase=="available"||phase=="ready";}}
 async Task CheckUpdate(){try{message.Text="正在检查更新…";await bridge.Call("checkUpdate");await RefreshState();PaintUpdate();}catch(Exception ex){Error(ex.Message);}}
 async Task UpdateSharedService(){
  if(!B(state,"sharedOwner"))throw new Exception("当前连接不是共享后台，请使用普通更新入口。");
  using(var picker=new FolderBrowserDialog{Description="选择解压后的 Mydex 签名私测后台更新包"}){
   if(picker.ShowDialog(this)!=DialogResult.OK)return;
   var checkedPackage=await bridge.Call("inspectServiceUpdate",new {directory=picker.SelectedPath});
   if(MessageBox.Show("后台版本："+S(checkedPackage,"current")+" → "+S(checkedPackage,"version")+"\n\n更新会短暂断开连接并重新启动后台，配置和配对保留。启动失败会尝试回退。请先等待正在发送或审批的操作完成。是否继续？","Mydex · 私测后台更新",MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes)return;
   var started=await bridge.Call("installServiceUpdate");var id=S(started,"operation");
   message.Text="正在更新后台，操作编号："+id;
   for(var n=0;n<120;n++){
    await Task.Delay(1000);if(IsDisposed)return;
    var result=await bridge.Call("serviceUpdateOperation",new {id=id});
    if(B(result,"pending"))continue;
    if(!B(result,"ok"))throw new Exception("后台更新未完成，请核对服务状态。操作编号："+id);
    await RefreshState();message.Text="后台已更新至 "+S(result,"version")+"，原配置保留。";return;
   }
   message.Text="后台更新仍待确认，请勿重复安装。操作编号："+id;
  }
 }
 async Task ApplyUpdate(){var u=UpdateState();if(S(u,"phase")=="ready"){if(MessageBox.Show("现在安装更新并重启 Mydex？连接会短暂中断，已有配置保留。请先等待正在发送或审批的操作完成。","Mydex 更新",MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes)return;await bridge.Call("installUpdate");quitting=true;Close();}else{await bridge.Call("downloadUpdate");await RefreshState();PaintUpdate();}}
 bool Autostart(){using(var k=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))return k!=null&&k.GetValue(DesktopProfile.Name)!=null;}
 void FillTools(){if(grid==null||grid.IsDisposed||state==null||!state.ContainsKey("tools"))return;grid.Rows.Clear();foreach(Dictionary<string,object> t in (IEnumerable)state["tools"]){var c=(Dictionary<string,object>)t["capabilities"];grid.Rows.Add(S(t,"name"),B(t,"running")?"运行中":"未运行",B(c,"history")?(S(t,"id")=="codex"?"桌面索引":S(t,"sessionCount")+" 个会话"):"未接通",B(c,"send")?"原桌面":"未接通",S(t,"note"));}grid.ClearSelection();}
 bool ToolConnected(string id){if(state==null||!state.ContainsKey("tools"))return false;foreach(Dictionary<string,object> t in (IEnumerable)state["tools"])if(S(t,"id")==id)return B(t["capabilities"] as Dictionary<string,object>,"send");return false;}
 async Task ConfigureHub(){var d=await bridge.Call("defaults");using(var f=new Form{Text="Mydex · 设置主机",Size=new Size(650,470),StartPosition=FormStartPosition.CenterParent,Font=Font,MinimizeBox=false,MaximizeBox=false,FormBorderStyle=FormBorderStyle.FixedDialog}){var s=Stack(f);s.Padding=new Padding(24);var fields=new Dictionary<string,TextBox>();foreach(var item in new[]{new[]{"name","电脑名称"},new[]{"address","手机可访问的 HTTPS 地址"},new[]{"codex","Codex 程序路径（自动检测）"},new[]{"thread","已有 Codex 会话 ID（自动检测）"}}){s.Controls.Add(LabelText(item[1]));var box=new TextBox{Width=570,Text=S(d,item[0]),Margin=new Padding(0,0,0,12)};s.Controls.Add(box);fields[item[0]]=box;}s.Controls.Add(LabelText("网页中继无需公网地址；保留自动填写的本机地址即可。",9,muted));s.Controls.Add(Btn("保存并启动",async()=>{await bridge.Call("configureHub",fields.ToDictionary(x=>x.Key,x=>(object)x.Value.Text.Trim()));await bridge.Call("start");f.Close();await RefreshState();},true));ScaleDialog(f);f.ShowDialog(this);}}
 async Task Attach(){using(var f=new OpenFileDialog{Title="选择已有 gateway/private 配置",Filter="Mydex 配置|config.json"})if(f.ShowDialog(this)==DialogResult.OK){string address="";if(Path.GetFileName(f.FileName)=="config.json"){address=Prompt("手机可访问的主机 HTTPS 地址","https://");if(address==null)return;}await bridge.Call("attach",new {file=f.FileName,address});await RefreshState();}}
 async Task ShowPairingQr(bool preview=false,bool relay=false,bool mesh=false){
  using(var dialog=new Form{Text="Mydex · 扫码配对",AutoScaleMode=AutoScaleMode.None,Size=new Size(430,570),StartPosition=FormStartPosition.CenterParent,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,MinimizeBox=false,BackColor=Color.White,Font=Font}){
   var heading=new Label{Text="连接这台电脑",AutoEllipsis=true,Dock=DockStyle.Top,Height=66,TextAlign=ContentAlignment.MiddleCenter,Font=new Font("Microsoft YaHei UI",18,FontStyle.Bold),ForeColor=ink};
   var picture=new PictureBox{Dock=DockStyle.Fill,SizeMode=PictureBoxSizeMode.CenterImage,BackColor=Color.White};
   var status=new Label{Dock=DockStyle.Top,Height=45,TextAlign=ContentAlignment.MiddleCenter,ForeColor=muted};
   var bottom=new FlowLayoutPanel{Dock=DockStyle.Bottom,Height=110,FlowDirection=FlowDirection.TopDown,WrapContents=false,Padding=new Padding(32,4,12,4)};
   bottom.Controls.Add(LabelText(relay?"手机相机扫码 → 登录 → 核对确认码":"手机 → 添加电脑 → 扫描电脑二维码",10,muted));
   long expires=0;
   Func<Task> refresh=async()=>{try{status.Text="正在生成一次性二维码…";var value=await bridge.Call(preview?"pairingPreview":relay?"relayPairing":mesh?"tunnelPairingQr":"pairingQr");if(dialog.IsDisposed)return;using(var stream=new MemoryStream(Convert.FromBase64String(S(value,"image")))){var old=picture.Image;picture.Image=new Bitmap(Image.FromStream(stream));if(old!=null)old.Dispose();}expires=Convert.ToInt64(value["expiresAt"]);heading.Text=S(value,"name");}catch(Exception ex){status.Text=ex.Message;}};
   bottom.Controls.Add(Btn("刷新二维码",refresh));dialog.Controls.Add(picture);dialog.Controls.Add(status);dialog.Controls.Add(heading);dialog.Controls.Add(bottom);
   using(var countdown=new System.Windows.Forms.Timer{Interval=500}){
    countdown.Tick+=(sender,args)=>{if(expires==0)return;var remaining=(int)Math.Ceiling((expires-DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())/1000d);status.Text=remaining>0?"一次性配对 · "+remaining+" 秒后失效":"二维码已过期，请刷新";if(remaining<=0){expires=0;var old=picture.Image;picture.Image=null;if(old!=null)old.Dispose();}};
    dialog.Shown+=async(sender,args)=>{countdown.Start();await refresh();if(preview){await Task.Delay(650);using(var shot=new Bitmap(dialog.Width,dialog.Height)){dialog.DrawToBitmap(shot,new Rectangle(0,0,dialog.Width,dialog.Height));shot.Save(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"qa","pair-qr.png"));}dialog.Close();}};using(var graphics=dialog.CreateGraphics()){var scale=graphics.DpiX/96f;dialog.Scale(new SizeF(scale,scale));}dialog.ShowDialog(this);countdown.Stop();if(picture.Image!=null)picture.Image.Dispose();
   }
  }
  await Task.CompletedTask;
 }
 async Task ConfigureTool(){var id=Prompt("工具标识：claude / gemini / opencode / openclaw","claude");if(id==null)return;using(var f=new OpenFileDialog{Title="选择实际 CLI 启动文件",Filter="工具启动文件|*.exe;*.cmd;*.js;*.mjs;*.cjs"})if(f.ShowDialog(this)==DialogResult.OK){await bridge.Call("configureTool",new {toolId=id,executable=f.FileName});await RefreshState();}}
 Dictionary<string,object> BridgeStatus(string id){if(state==null||!state.ContainsKey("bridgeStates"))return null;var all=state["bridgeStates"] as Dictionary<string,object>;return all!=null&&all.ContainsKey(id)?all[id] as Dictionary<string,object>:null;}
 bool NeedsBridgeRestore(string id,bool installed){var item=BridgeStatus(id);return installed||(B(item,"recovery")&&S(item,"state")!="notApplied");}
 string BridgeStatusText(){var ids=new[]{"claude","deepseek","zcode","gemini","kimi"};var item=BridgeStatus(ids[bridgeSelection]);return item==null?"安装桥接后，请检查原会话接口是否真正接通。":S(item,"message");}
 void UpdateBridgeHelp(){if(bridgeInfo==null||bridgeInfo.IsDisposed)return;bridgeInfo.Text=BridgeHelpSummary();var measured=TextRenderer.MeasureText(bridgeInfo.Text,bridgeInfo.Font,new Size(Math.Max(260,bridgeInfo.Width-20),Int32.MaxValue),TextFormatFlags.WordBreak);bridgeInfo.Height=measured.Height+24;}
 string BridgeHelpSummary(){
  if(bridgeSelection!=0)return "兼容桥负责连接电脑上的原会话，沿用原工具账号和模型；安装、已连接和可恢复分别检查。点击“桥接说明”查看安装方式和恢复范围。";
  var item=BridgeStatus("claude");
  if(S(item,"mode")=="storeCopy")return "接入方式：Claude 程序兼容副本，原商店安装未修改；沿用原账号和聊天数据目录。\n当前已验证 Code 续聊；Cowork 尚未验证，可能提示修复。回退只删除兼容副本，保留原程序和聊天记录。\n副本位置："+S(item,"copyRoot");
  if(B(item,"recovery"))return "接入方式：在原 Claude 安装中加入本地桥接，安装前已备份程序文件。\n一键恢复仅还原程序文件，不清除账号和聊天记录；其他工具更新后需先检查备份是否仍匹配。";
  return "连接桥沿用电脑上的 Claude 账号和模型。普通安装直接备份加桥；受保护的商店安装会先说明并创建兼容副本。\n可一键恢复原地修改，或删除兼容副本；不删除原账号和聊天记录。Cowork 尚未完成兼容验证。";
 }
 string BridgeHelpDetails(){
  if(bridgeSelection!=0)return "Mydex 不另建 AI 账号或独立模型任务，而是连接支持的电脑原会话。\n\n程序兼容桥会先备份文件，再检查并加入本地接口；已通过其他方式接入的工具不会重复安装。\n\n还原只针对 Mydex 自己的匹配备份，不清除原工具账号、模型配置或聊天记录。若原工具被更新或文件变化，自动恢复会停止，避免覆盖新版本。";
  var item=BridgeStatus("claude");
  return BridgeHelpSummary()+"\n\n原地安装：备份后修改原程序，恢复时校验备份并还原。\n兼容副本：复制同版本程序后加入连接桥，因此文件不与原版完全相同，也不承诺保留厂商签名或完整 Cowork 能力。原安装和共用数据目录不搬动。\n\n副本存放位置在安装前可选，默认位置即可。删除时只清理 Mydex 创建的独立子目录，不删除所选父目录或其他文件。遇到链接、归属不符或未知文件，会停止自动清理。\n\n恢复前请退出相关程序；Mydex 不会强行结束任务。恢复后保留原账号、模型配置和聊天记录。副本与原版不能同时使用同一数据目录。\n\n程序路径："+S(item,"app");
 }
 async Task InstallClaude(){
  message.Text="正在自动识别 Claude 安装位置…";var found=await bridge.Call("findClaude");var app=S(found,"app");
  if(String.IsNullOrEmpty(app)){using(var f=new OpenFileDialog{Title="选择 Claude Desktop 的 claude.exe",Filter="Claude 程序|claude.exe"}){if(f.ShowDialog(this)!=DialogResult.OK)return;app=Path.GetDirectoryName(f.FileName);}}
  bool store=B(found,"store")||app.IndexOf("WindowsApps",StringComparison.OrdinalIgnoreCase)>=0;string profile="",storeDirectory=S(found,"compatibilityRoot");
  if(store&&found.ContainsKey("profiles")){
   var profiles=new List<Dictionary<string,object>>();foreach(Dictionary<string,object> item in (IEnumerable)found["profiles"])profiles.Add(item);
   if(profiles.Count==0)throw new Exception("请先在 Claude 中完成初始化，再安装兼容桥。");
   if(profiles.Count==1)profile=S(profiles[0],"path");
   else using(var f=new Form{Text="选择要沿用的 Claude 账号",Size=new Size(680,230),StartPosition=FormStartPosition.CenterParent,Font=Font}){var panel=Stack(f);panel.Padding=new Padding(20);panel.Controls.Add(LabelText("检测到多个数据目录，请选择要继续的账号和原会话。",10));var list=new ComboBox{Width=600,DropDownStyle=ComboBoxStyle.DropDownList};foreach(var item in profiles)list.Items.Add(S(item,"label")+" · "+S(item,"path"));list.SelectedIndex=0;panel.Controls.Add(list);var button=new Button{Text="使用这个账号",DialogResult=DialogResult.OK,AutoSize=true,Margin=new Padding(0,16,0,0)};panel.Controls.Add(button);f.AcceptButton=button;ScaleDialog(f);if(f.ShowDialog(this)!=DialogResult.OK)return;profile=S(profiles[list.SelectedIndex],"path");}
  }
  if(store){storeDirectory=StoreCopyOptions(storeDirectory,profile);if(storeDirectory==null)return;}
  else if(MessageBox.Show("将为本机 Claude Desktop 安装兼容桥。请先完全退出 Claude。安装前备份并检查文件，可从工具页还原。程序修改后可能失去厂商签名。\n\n位置："+app+"\n\n继续安装吗？","安装 Claude 兼容桥",MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes)return;
  message.Text=store?"正在创建 Claude 兼容副本并校验桥接…":"正在备份并安装 Claude 兼容桥…";var result=await bridge.Call("installClaude",new {app=app,profile=profile,storeDirectory=storeDirectory});await RefreshState();ShowPage("tools");message.Text=B(result,"storeCopy")?(B(result,"launched")?"兼容版已自动启动，正在等待原会话接口接通…":"兼容副本已安装，启动失败："+S(result,"launchError")):"桥接文件已校验写入；请重新打开 Claude 后检查接口。";
 }
 async Task InstallToolBridge(string id,string name){
  message.Text="正在自动识别 "+name+" 安装位置…";var found=await bridge.Call("findToolBridge",new {id=id});var app=S(found,"app");
  if(String.IsNullOrEmpty(app)){using(var f=new OpenFileDialog{Title=id=="gemini"?"选择 Gemini CLI 的 package.json":"选择 "+name+" 的程序文件",Filter=id=="gemini"?"Gemini CLI 包文件|package.json":"应用程序|*.exe"}){if(f.ShowDialog(this)!=DialogResult.OK)return;app=Path.GetDirectoryName(f.FileName);}}
  if(MessageBox.Show("请先完全退出 "+name+"。Mydex 会检查兼容结构并备份原文件，安装后可在这里还原。\n\n程序修改后可能失去厂商签名，后续更新可能需要重新适配。\n\n位置："+app+"\n\n继续安装吗？","安装兼容桥",MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes)return;
  message.Text="正在备份并安装兼容桥…";await bridge.Call("installToolBridge",new {id=id,app=app});await RefreshState();ShowPage("tools");message.Text="桥接文件已校验写入，请完全退出并重新打开 "+name+"，再检查原会话是否接通。";
 }
 string StoreCopyOptions(string location,string profile){
  using(var f=new Form{Text="Mydex · Claude 兼容副本",Size=new Size(730,530),StartPosition=FormStartPosition.CenterParent,Font=Font,MinimizeBox=false,MaximizeBox=false}){
   var panel=Stack(f);panel.Padding=new Padding(22);
   panel.Controls.Add(LabelText("保留原版，创建同版本兼容副本",15));
   panel.Controls.Add(LabelText("Mydex 复制现有 Claude 程序并加入本地连接桥。副本以同一版本为基础，因桥接修改，不是与原版完全相同的文件，也不保证厂商签名保留。",10));
   panel.Controls.Add(LabelText("沿用已有账号和会话数据，不搬走聊天记录。原版与副本不能同时运行。请先退出 Claude，安装完成后会自动启动副本，无需手填接口或模型。",10));
   panel.Controls.Add(LabelText("副本存放位置（可选修改，默认即可）",10));
   var row=new FlowLayoutPanel{AutoSize=true,WrapContents=false};var box=new TextBox{Text=location,ReadOnly=true,Width=475,Margin=new Padding(0,7,10,8)};row.Controls.Add(box);row.Controls.Add(Btn("更改位置",()=>{using(var picker=new FolderBrowserDialog{Description="选择兼容副本存放位置，Mydex 会创建独立子文件夹",SelectedPath=box.Text,ShowNewFolderButton=true})if(picker.ShowDialog(f)==DialogResult.OK)box.Text=picker.SelectedPath;return Task.CompletedTask;}));panel.Controls.Add(row);
   panel.Controls.Add(LabelText("工具页可“一键回退并删除副本”；只清理 Mydex 创建的副本，保留原 Claude、账号数据和聊天记录。",10));
   panel.Controls.Add(LabelText("沿用的数据目录："+profile,9,muted));
   var install=new Button{Text="安装连接桥",DialogResult=DialogResult.OK,AutoSize=true,Padding=new Padding(16,8,16,8)};panel.Controls.Add(install);f.AcceptButton=install;ScaleDialog(f);return f.ShowDialog(this)==DialogResult.OK?box.Text:null;
  }
 }
 async Task RestoreBridge(string id){
  bool copy=id=="claude"&&S(BridgeStatus("claude"),"mode")=="storeCopy";
  var title=copy?"回退并删除兼容副本":"还原原版";
  var text=copy?"请先退出 Claude 兼容副本。将删除 Mydex 创建的程序兼容副本及其程序备份，解除此连接桥。\n\n原商店程序、原账号配置和全部聊天记录保留。不会卸载原 Claude 或恢复旧聊天快照。所选存放位置里的其他文件不删除。\n\n副本目录："+S(BridgeStatus("claude"),"copyRoot"):"请先完全退出原工具。Mydex 将检查文件并从备份还原原版程序。";
  if(MessageBox.Show(text+"\n\n继续吗？",title,MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes)return;
  var result=await bridge.Call(id=="claude"?"restoreClaude":"restoreToolBridge",new {id=id});await RefreshState();ShowPage("tools");message.Text=B(result,"removed")?"兼容副本已删除；原程序和聊天记录保留，可继续使用原 Claude。":"已还原原版，请重新打开对应工具。";
 }
 void ScaleDialog(Form dialog){dialog.AutoScaleMode=AutoScaleMode.None;using(var g=CreateGraphics()){var scale=g.DpiX/96f;dialog.Scale(new SizeF(scale,scale));}}
 string Prompt(string label,string value){using(var f=new Form{Text="Mydex",Size=new Size(610,200),StartPosition=FormStartPosition.CenterParent,Font=Font}){var s=Stack(f);s.Padding=new Padding(20);s.Controls.Add(LabelText(label));var t=new TextBox{Text=value,Width=540};s.Controls.Add(t);var b=new Button{Text="确认",DialogResult=DialogResult.OK,AutoSize=true,Margin=new Padding(0,12,0,0)};s.Controls.Add(b);f.AcceptButton=b;ScaleDialog(f);return f.ShowDialog(this)==DialogResult.OK?t.Text.Trim():null;}}
 [STAThread] static void Main(string[] args){bool fresh;using(var mutex=new Mutex(true,"Local\\"+DesktopProfile.Name,out fresh)){if(!fresh&&!args.Contains("--qa")){MessageBox.Show("Mydex 已在运行，请从系统托盘打开窗口。","Mydex");return;}Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);try{var form=new Mydex(args.Contains("--tray"));if(args.Contains("--qa")){form.Shown+=async(a,e)=>{try{while(form.refreshing)await Task.Delay(100);await form.RefreshState();if(form.state==null)throw new Exception(form.message.Text);form.ShowPage("tools");form.PerformLayout();await Task.Delay(300);var dir=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"qa");Directory.CreateDirectory(dir);using(var image=new Bitmap(form.Width,form.Height)){form.DrawToBitmap(image,new Rectangle(0,0,form.Width,form.Height));image.Save(Path.Combine(dir,"tools.png"));}File.WriteAllText(Path.Combine(dir,"result.txt"),"toolRows="+form.grid.Rows.Count+"; arrayType="+form.state["tools"].GetType().FullName);foreach(var capture in new[]{"overview","pair","settings"}){form.ShowPage(capture);form.PerformLayout();await Task.Delay(200);using(var image=new Bitmap(form.Width,form.Height)){form.DrawToBitmap(image,new Rectangle(0,0,form.Width,form.Height));image.Save(Path.Combine(dir,capture+".png"));}if(capture=="pair"){form.selectPairingMode(1);form.PerformLayout();using(var image=new Bitmap(form.Width,form.Height)){form.DrawToBitmap(image,new Rectangle(0,0,form.Width,form.Height));image.Save(Path.Combine(dir,"pair-web.png"));}}}await form.ShowPairingQr(true);}catch(Exception ex){File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"qa-error.txt"),ex.ToString());}finally{form.quitting=true;form.Close();}};}Application.Run(form);}catch(Exception e){MessageBox.Show("Mydex 启动失败："+e.Message,"Mydex");}}}
}

