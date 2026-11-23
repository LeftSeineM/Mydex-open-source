import test from 'node:test';import assert from 'node:assert/strict';import {serviceDefinition} from '../posix-service.mjs';
// Definitions must keep chosen paths as a single argument, without a shell.
test('Linux user unit supervises the stable launcher and escapes specifiers',()=>{
 const d=serviceDefinition({root:'/opt/Mydex Agent%u',home:'/home/test',platform:'linux',uid:1000});
 assert.match(d.content,/Type=exec/);assert.match(d.content,/Mydex Agent%%u/);assert.match(d.content,/Restart=on-failure/);assert.match(d.content,/KillMode=control-group/);
 assert.deepEqual(d.start[1].slice(0,3),['--user','enable','--now']);assert.ok(!d.content.includes('sh -c'));
});
test('macOS LaunchAgent uses direct argument array and user session',()=>{
 const d=serviceDefinition({root:'/Applications/Mydex & Agent',home:'/Users/test',platform:'darwin',uid:501});
 assert.match(d.content,/Mydex &amp; Agent/);assert.match(d.content,/<key>KeepAlive<\/key><true\/>/);assert.equal(d.start[1][1],'gui/501');assert.match(d.content,/<key>ProgramArguments/);
});
test('service definitions reject control characters and unsupported platforms',()=>{
 for(const root of ['/opt/a\nb','/opt/a\0b'])assert.throws(()=>serviceDefinition({root,home:'/home/test',platform:'linux',uid:1}));
 assert.throws(()=>serviceDefinition({root:'/opt/a',home:'/home/test',platform:'darwin',uid:-1}));
 assert.throws(()=>serviceDefinition({root:'/opt/a',home:'/home/test',platform:'other',uid:1}));
});
