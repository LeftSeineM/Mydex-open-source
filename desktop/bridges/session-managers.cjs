'use strict';
// Route each ID back to the manager that owns the original desktop record.
// No transcript imports, new CLI tasks or permission overrides are involved.
function valid(m){return ['getAllSessions','getSession','getTranscript','sendMessage'].every(k=>typeof m?.[k]==='function');}
function findCoworkManager(module){const found=[...new Set(Object.values(module))].filter(m=>valid(m)&&typeof m.waitForSessionsLoaded==='function');if(found.length!==1)throw Error('Cannot uniquely identify Cowork session manager');return found[0];}
function combineManagers(code,cowork){
 if(!valid(code))throw Error('Incompatible Code manager');if(!cowork)return code;if(!valid(cowork))throw Error('Incompatible Cowork manager');
 const sources=[{kind:'code',manager:code},{kind:'cowork',manager:cowork}];
 async function index(){const result=[],seen=new Set();for(const source of sources){const m=source.manager;if(source.kind==='cowork'&&typeof m.getAllSessionsWaitingForLoad==='function')await m.getAllSessionsWaitingForLoad();for(const session of await m.getAllSessions()){if(seen.has(session.sessionId))throw Error('Ambiguous desktop session ID');seen.add(session.sessionId);result.push({...source,session});}}return result;}
 async function owner(id){const item=(await index()).find(x=>x.session.sessionId===id);if(!item)throw Error('Desktop session unavailable');return item;}
 return {getAllSessions:async()=>(await index()).map(x=>({...x.session,sessionKind:x.kind})),getSession:async id=>{const x=await owner(id);return x.manager.getSession(id);},getTranscript:async id=>{const x=await owner(id);return x.manager.getTranscript(id);},sendMessage:async(id,text,unused,options)=>{const x=await owner(id);if(x.kind==='code')return x.manager.sendMessage(id,text,unused,options);const result=await x.manager.sendMessage(id,text,undefined,undefined,options?.messageUuid);return {delivered:result?.dispatched===true,reason:result?.dispatched===true?undefined:'Cowork did not accept the message'};}};
}
module.exports={combineManagers,findCoworkManager};
