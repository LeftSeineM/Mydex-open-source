import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {UsageQueries,codexUsage,claudeUsage} from '../usage.mjs';
test('Codex quota has separate windows and never forwards credentials or arbitrary account fields',()=>{
 const r=codexUsage({secret:'do-not-forward',rateLimits:{primary:{usedPercent:24,windowDurationMins:300,resetsAt:1700000000},secondary:{usedPercent:75,windowDurationMins:10080}}});
 assert.equal(r.windows[0].remainingPercent,76);assert.equal(r.windows[1].remainingPercent,25);assert(!JSON.stringify(r).includes('do-not-forward'));
 assert.equal(codexUsage({rateLimits:{primary:{usedPercent:null}}}).available,false);
});
test('Claude normalizes zero use and unknown reset without inventing a balance',()=>{
 const r=claudeUsage({five_hour:{utilization:0,resets_at:null},seven_day:{utilization:30,resets_at:'2026-11-05T00:00:00Z'},seven_day_opus:null});
 assert.equal(r.windows[0].remainingPercent,100);assert.equal(r.windows[0].resetsAt,null);assert.equal(r.windows[1].remainingPercent,70);assert.equal(r.balance,undefined);
});
test('queries coalesce and cache for 30 seconds, failures redact provider text',async()=>{
 let n=0,now=0;const u=new UsageQueries({controls:{rpc:async()=>{n++;return {rateLimits:{primary:{usedPercent:10}}};}}},{now:()=>now});
 await Promise.all([u.read('codex'),u.read('codex')]);assert.equal(n,1);await u.read('codex');assert.equal(n,1);now=31000;await u.read('codex');assert.equal(n,2);
 const failed=await new UsageQueries({controls:{rpc:async()=>{throw Error('private-token');}}}).read('codex');assert.equal(failed.available,false);assert(!JSON.stringify(failed).includes('private-token'));
 assert.equal((await u.read('claude-desktop')).available,false);
});
test('Claude token stays on host and only reaches the fixed official quota endpoint',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-usage-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));fs.mkdirSync(path.join(home,'.claude'));fs.writeFileSync(path.join(home,'.claude','.credentials.json'),JSON.stringify({claudeAiOauth:{accessToken:'private-test-token',expiresAt:Date.now()+100000}}));
 const u=new UsageQueries({}, {home,fetcher:async(url,opts)=>{assert.equal(url,'https://api.anthropic.com/api/oauth/usage');assert.equal(opts.redirect,'error');assert.equal(opts.headers.Authorization,'Bearer private-test-token');return new Response(JSON.stringify({five_hour:{utilization:12}}));}});
 const r=await u.read('claude');assert.equal(r.windows[0].remainingPercent,88);assert(!JSON.stringify(r).includes('private-test-token'));
});

test('Codex extra credit balance preserves the exact decimal and rejects non-numeric content',()=>{
 assert.deepEqual(codexUsage({rateLimits:{credits:{hasCredits:true,unlimited:false,balance:'12.3456'}}}).credits,{unlimited:false,balance:'12.3456'});
 assert.equal(codexUsage({rateLimits:{credits:{hasCredits:true,balance:'12.3456'}}}).available,true);
 assert.equal(codexUsage({rateLimits:{credits:{hasCredits:true,balance:'private-non-numeric-value'}}}).credits.balance,null);
});
