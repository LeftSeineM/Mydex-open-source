export function permissionState(state={}){
 const history=state.turnHistory?.history?.entitiesByKey;
 const turns=history?Object.values(history):state.turns||[];
 const last=[...turns].sort((a,b)=>(a.turnStartedAtMs||0)-(b.turnStartedAtMs||0)).at(-1)?.params||{};
 const latest=state.latestThreadSettings||{},current=state.currentPermissions||{};
 const approvalPolicy=latest.approvalPolicy??last.approvalPolicy??current.approvalPolicy??null;
 const approvalsReviewer=latest.approvalsReviewer??last.approvalsReviewer??current.approvalsReviewer??null;
 const sandboxPolicy=latest.sandboxPolicy??last.sandboxPolicy??current.sandboxPolicy??null;
 const sandbox=typeof sandboxPolicy==='string'?sandboxPolicy:sandboxPolicy?.type;
 let mode='unknown',label='权限状态未知';
 if(sandbox){mode='custom';label='自定义权限';}
 if(sandbox==='dangerFullAccess'&&approvalPolicy==='never'){mode='full';label='完全访问';}
 else if(sandbox==='readOnly'){mode='read-only';label='只读';}
 else if(sandbox==='workspaceWrite'&&approvalPolicy==='on-request'){
  if(['auto_review','guardian_subagent'].includes(approvalsReviewer)){mode='auto-review';label='替我审批';}
  else if(approvalsReviewer==='user'){mode='ask';label='需要时询问我';}
 }
 const reviewer=approvalPolicy==='never'?'不主动请求审批':['auto_review','guardian_subagent'].includes(approvalsReviewer)?'自动审查':approvalsReviewer==='user'?'由我审批':'审批方式未知';
 return {mode,label,reviewer,approvalPolicy,approvalsReviewer,sandboxType:sandbox||null};
}
export function permissionPreset(mode,confirmed){
 if(!['ask','auto-review','full','read-only'].includes(mode))throw Error('无效的权限模式');
 if(['full','auto-review'].includes(mode)&&confirmed!==true)throw Error('请先确认权限切换');
 return {approvalPolicy:mode==='full'?'never':'on-request',approvalsReviewer:mode==='auto-review'?'auto_review':'user',sandboxPolicy:mode==='full'?{type:'dangerFullAccess'}:mode==='read-only'?{type:'readOnly',networkAccess:false}:{type:'workspaceWrite',writableRoots:[],networkAccess:false,excludeTmpdirEnvVar:false,excludeSlashTmp:false}};
}
export function interaction(request){
 const p=request.params||{},base={id:String(request.id),rpcId:request.id};
 if(request.method==='item/tool/requestUserInput')return {...base,kind:'user-input',title:'需要你的回答',questions:p.questions||[],blocking:p.isBlocking!==false};
 if(request.method==='item/permissions/requestApproval')return {...base,kind:'permissions',title:'允许本轮申请的权限？',description:p.reason||'仅授权这次申请的范围，不切换为完全访问。',permissions:p.permissions||{},details:JSON.stringify(p.permissions||{},null,2)};
 const kind=request.method==='item/commandExecution/requestApproval'?'command':request.method==='item/fileChange/requestApproval'?'file':null;
 return kind?{...base,kind,title:kind==='file'?'允许修改文件？':'允许执行此操作？',description:p.reason||p.command||'Codex 请求你的许可',details:JSON.stringify(p,null,2)}:null;
}
export function messageQuestions(item){
 if(item.type!=='agentMessage'||!Array.isArray(item.questions)||!item.questions.length)return null;
 const questions=item.questions.map((q,index)=>({id:JSON.stringify(['request_user_input_async',item.id,index]),question:q.title||'',isOther:true,options:(q.options||[]).map(o=>typeof o==='string'?{label:o,description:''}:o)}));
 return {id:'questions:'+item.id,kind:'user-input',source:'message-questions',title:'需要你的回答',blocking:false,questions};
}
export function answeredMessageQuestions(messages){
 const ids=new Set();for(const m of messages){if(m.role!=='user')continue;const match=String(m.text||'').match(/<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>/);if(!match)continue;try{const raw=JSON.parse(match[1]);for(const a of Array.isArray(raw)?raw:[raw])if(typeof a.questionItemId==='string')ids.add(a.questionItemId);}catch{}}
 return ids;
}
export function validateAnswers(questions,answers){
 if(!answers||typeof answers!=='object'||Array.isArray(answers))throw Error('请填写回答');
 const ids=new Set(questions.map(q=>q.id));if(Object.keys(answers).some(k=>!ids.has(k)))throw Error('回答不属于当前问题');
 const result=Object.create(null);
 for(const q of questions){const values=answers[q.id]?.answers;if(!Array.isArray(values)||values.length!==1||typeof values[0]!=='string'||!values[0].trim()||values[0].length>12000)throw Error('请回答每个问题');
  if(q.options?.length&&!q.isOther&&!q.options.some(o=>o.label===values[0]))throw Error('请选择当前问题提供的选项');
  result[q.id]={answers:[values[0]]};
 }
 return {answers:result};
}
