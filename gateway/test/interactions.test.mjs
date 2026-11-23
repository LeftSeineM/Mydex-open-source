import test from 'node:test';
import assert from 'node:assert/strict';
import {permissionState,permissionPreset,interaction,validateAnswers} from '../permissions.mjs';
import {Adapter} from '../adapter.mjs';
import {Controls} from '../controls.mjs';
test('permission display distinguishes no prompts, full access and automatic review',()=>{
 assert.equal(permissionState().mode,'unknown');
 assert.equal(permissionState({currentPermissions:{sandboxPolicy:{type:'readOnly'},approvalPolicy:'never'}}).mode,'read-only');
 assert.equal(permissionState({currentPermissions:{sandboxPolicy:{type:'dangerFullAccess'},approvalPolicy:'never'}}).mode,'full');
 assert.equal(permissionState({currentPermissions:{sandboxPolicy:{type:'workspaceWrite'},approvalPolicy:'on-request',approvalsReviewer:'auto_review'}}).mode,'auto-review');
 assert.equal(permissionState({currentPermissions:{sandboxPolicy:{type:'workspaceWrite'},approvalPolicy:'on-request'}}).mode,'custom');
 assert.throws(()=>permissionPreset('full',false));assert.throws(()=>permissionPreset('auto-review',false));assert.throws(()=>permissionPreset('invented',true));
});
test('answers belong to the pending questions and retain free text and Unicode',()=>{
 const questions=[{id:'choice',options:[{label:'是'}]},{id:'fill',isSecret:true}];
 const input={choice:{answers:['是']},fill:{answers:['中文 & details']}};
 assert.equal(validateAnswers(questions,input).answers.fill.answers[0],'中文 & details');
 assert.throws(()=>validateAnswers(questions,{...input,unexpected:{answers:['bad']}}));
 assert.throws(()=>validateAnswers(questions,{...input,choice:{answers:['not offered']}}));
 assert.throws(()=>validateAnswers(questions,{choice:input.choice}));
});
test('permission change requires desktop confirmation and preserves unrelated model settings',async()=>{
 const c=Object.create(Controls.prototype);let call;
 c.adapter={native:{snapshot:async()=>({latestThreadSettings:{model:'existing',effort:'high'}}),control:async(...args)=>{call=args;return {applied:true};}}};
 assert.equal((await c.settings('desktop:one',{permissionMode:'full',confirmed:true})).appliedToDesktop,true);
 assert.equal(call[0],'one');assert.equal(call[1],'thread-follower-update-thread-settings');assert.equal(call[2].threadSettings.model,'existing');assert.equal(call[2].threadSettings.sandboxPolicy.type,'dangerFullAccess');
 c.adapter.native.control=async()=>({applied:false});await assert.rejects(c.settings('desktop:one',{permissionMode:'ask'}),/未确认/);
});
test('desktop questions and scoped permissions reply to original request without widening grant',async()=>{
 const a=Object.create(Adapter.prototype);a.summaries=new Map();a.registerImages=()=>{};let call;
 const question={id:7,method:'item/tool/requestUserInput',params:{questions:[{id:'q',question:'填写说明'}]}};
 const permission={id:8,method:'item/permissions/requestApproval',params:{permissions:{network:{enabled:true}}}};
 a.native={states:new Map([['one',{value:{id:'one',requests:[question,permission]}}]]),control:async(...args)=>{call=args;return {ok:true};}};
 await a.approve('desktop:one',{approvalId:'7',answers:{q:{answers:['hello']}}});assert.equal(call[1],'thread-follower-submit-user-input');assert.equal(call[2].requestId,7);
 await a.approve('desktop:one',{approvalId:'8',decision:'accept',permissions:{fileSystem:{write:['/']}}});assert.deepEqual(call[2].response,{permissions:{network:{enabled:true}},scope:'turn'});
 await a.approve('desktop:one',{approvalId:'8',decision:'decline'});assert.deepEqual(call[2].response,{permissions:{},scope:'turn'});
 await assert.rejects(a.approve('desktop:one',{approvalId:'missing',decision:'accept'}),/失效/);
 assert.equal(interaction({...question,params:{...question.params,isBlocking:false}}).blocking,false);
});
