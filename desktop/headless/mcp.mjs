import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import fs from 'node:fs';
import {rpc} from './local-state.mjs';
import {openPairing} from './open-pairing.mjs';
import {latestRelease} from './releases.mjs';
import {lifecycle,operation} from './lifecycle.mjs';
import {registerRouterTools} from './router-mcp.mjs';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const server=new McpServer({name:'mydex',version:JSON.parse(fs.readFileSync(new URL('./package.json',import.meta.url),'utf8')).version});
const reply=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
function tool(name,description,inputSchema,fn){server.registerTool(name,{description,inputSchema},async args=>{try{return reply(await fn(args));}catch{return {content:[{type:'text',text:'Operation failed. Inspect service status before retrying; do not assume a mutation was rolled back.'}],isError:true};}});}
tool('mydex_status','Inspect independent background service, phone transports and existing tools.',{},()=>rpc('status'));
tool('mydex_configure','Configure this computer once. Existing configuration is never overwritten.',{name:z.string().min(1).max(80),address:z.string().url()},async args=>{const r=await rpc('configureHub',args);await rpc('start');return r;});
tool('mydex_defaults','Find suggested local configuration; no application installation.',{},()=>rpc('defaults'));
tool('mydex_prepare_tool','Ask the independent background service to start an installed original desktop tool if needed and verify its native interface. Does not create chats, submit prompts, change models, install apps or patch files.',{tool:z.enum(['codex','deepseek','kimi','claude-desktop','zcode'])},a=>rpc('prepareTool',a));
tool('mydex_pair','Open a temporary pairing QR locally. Never return connection credentials to the model.',{mode:z.enum(['android','web'])},async args=>{const r=await rpc('pair',args);return {...await openPairing(r.file),mode:r.mode,expiresAt:r.expiresAt};});
tool('mydex_diagnostics','Inspect original application compatibility; detection is not proof of session control.',{tool:z.enum(['all','claude','deepseek','zcode','gemini']).default('all')},async a=>{
 const ids=a.tool==='all'?['claude','deepseek','zcode','gemini']:[a.tool];const results=[];
 for(const id of ids){if(id==='gemini'){const state=await rpc('status');results.push({id,installation:await rpc('findToolBridge',{id}),installed:state.toolBridgeInstalled?.gemini,capabilities:state.tools.find(t=>t.id===id)?.capabilities});}else results.push({id,...await rpc('bridgeDiagnostics',{id})});}
 return results;
});
tool('mydex_restore_bridge','Restore one existing application bridge using its recorded backups.',{tool:z.enum(['claude','deepseek','zcode','gemini'])},a=>rpc(a.tool==='claude'?'restoreClaude':'restoreToolBridge',{id:a.tool}));
tool('mydex_install_bridge','Check existing bridge first. Prefer official/existing interfaces. Modifying original application files is disabled by default and requires separate explicit user consent; never create a replacement app.',{tool:z.enum(['claude','deepseek','zcode','gemini']),allowOriginalAppPatch:z.boolean().default(false).describe('Set true only after the user explicitly accepts this specific original-application patch, its backup and restore plan.')},a=>rpc('bridgeInstall',a));
tool('mydex_install','Install this signed package as an independent background service.',{},()=>lifecycle('install'));
tool('mydex_update','Install a signed local Mydex Agent package, preserving configuration and rolling back on failed startup. Poll the returned operation before reporting success.',{packageDirectory:z.string().min(1)},a=>lifecycle('update',a.packageDirectory));
tool('mydex_operation','Check the actual completion result of an installation or update.',{id:z.string().regex(/^[a-f0-9]{32}$/)},a=>operation(a.id));
tool('mydex_uninstall','Remove this Agent installation and startup task, preserving user configuration and application bridge backups. This MCP session will close; read the returned receipt after completion.',{},async()=>{const result=await lifecycle('uninstall');setTimeout(()=>process.exit(0),1500);return result;});
tool('mydex_check_update','Read signed public OS/CPU update index. Private Router installations must stay on their private update channel.',{},latestRelease);
registerRouterTools(server);
await server.connect(new StdioServerTransport());
// Closing this MCP transport does not own or stop the independent service.
