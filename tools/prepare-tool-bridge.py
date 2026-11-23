"""Stage version-checked, reversible local ZCode/DeepSeek compatibility files.
Never redistribute patched vendor executables. Original binaries are saved alongside
staged files; integrity digests are updated when embedded, not disabled.
"""
import argparse
import hashlib
import json
import pathlib
import struct
import datetime


def digest(data):
    return hashlib.sha256(data).hexdigest()


def entries(node):
    for value in node.get('files', {}).values():
        if 'files' in value:
            yield from entries(value)
        elif 'offset' in value:
            yield value


def prepare(app, output, runtime, descriptor, kind):
    exe_path=app/('ZCode.exe' if kind=='zcode' else 'DeepSeek Harness.exe')
    asar_path=app/'resources/app.asar'
    original=asar_path.read_bytes(); sizes=struct.unpack('<4I',original[:16]); raw_header=original[16:16+sizes[3]]
    header=json.loads(raw_header); body=original[8+sizes[1]:]
    pkg=header['files']['package.json']; package=json.loads(body[int(pkg['offset']):int(pkg['offset'])+pkg['size']])
    if package['version'] != ('3.16.3' if kind=='zcode' else '0.2.1-rc.3'):raise RuntimeError('Unverified vendor version')
    target=header['files']['out']['files']['host']['files']['index.js'] if kind=='zcode' else header['files']['lib']['files']['main.js']
    start,size=int(target['offset']),target['size'];source=body[start:start+size]
    if b'[Mydex native bridge]' in source:raise RuntimeError('Already patched')
    if kind=='zcode':
        if b'Gt?.getOptional(Zr)' not in source:raise RuntimeError('Session service changed')
        payload=('\n/* [Mydex native bridge] */\nimport('+json.dumps(runtime.resolve().as_uri())+').then(m=>m.default.start({taskService:()=>Gt?.getOptional(Zr),descriptorPath:'+json.dumps(str(descriptor.resolve()))+'})).catch(e=>console.error("Mydex bridge",e.message));\n').encode()
        modified_source=source+payload
    else:
        needle=b'hostCookie = await authenticateWebHost(ready.url);'
        if source.count(needle)!=1:raise RuntimeError('Host authentication hook changed')
        payload=('\n/* [Mydex native bridge] */ mkdirSync('+json.dumps(str(descriptor.parent.resolve()))+',{recursive:true});writeFileSync('+json.dumps(str(descriptor.resolve()))+',JSON.stringify({protocol:1,toolId:"deepseek",pid:process.pid,base:new URL(ready.url).origin,cookie:hostCookie}),{mode:384});\n').encode()
        modified_source=source.replace(needle,needle+payload)
    delta=len(modified_source)-len(source)
    for entry in entries(header):
        if int(entry['offset'])>start:entry['offset']=str(int(entry['offset'])+delta)
    target['size']=len(modified_source)
    if 'integrity' in target:
        info=target['integrity'];bs=info['blockSize'];info['hash']=digest(modified_source);info['blocks']=[digest(modified_source[i:i+bs]) for i in range(0,len(modified_source),bs)]
    nh=json.dumps(header,ensure_ascii=False,separators=(',',':')).encode();inner=struct.pack('<I',len(nh))+nh;inner+=b'\0'*(-len(inner)%4);pickle=struct.pack('<I',len(inner))+inner
    asar=struct.pack('<II',4,len(pickle))+pickle+body[:start]+modified_source+body[start+size:]
    exe=exe_path.read_bytes();old=digest(raw_header).encode();new=digest(nh).encode()
    if exe.count(old)>1:raise RuntimeError('Ambiguous integrity digest')
    modified_exe=exe.replace(old,new,1) if old in exe else exe
    output.mkdir(parents=True,exist_ok=False)
    (output/exe_path.name).write_bytes(modified_exe);(output/'app.asar').write_bytes(asar)
    (output/'original.exe').write_bytes(exe);(output/'original.asar').write_bytes(original)
    (output/'manifest.json').write_text(json.dumps({'kind':kind,'version':package['version'],'originalAsar':digest(original),'modifiedAsar':digest(asar),'exeModified':exe!=modified_exe},indent=2))
    print(json.dumps({'prepared':str(output),'version':package['version']}))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for name in ['app','output','runtime','descriptor']:parser.add_argument('--'+name,type=pathlib.Path,required=True)
    parser.add_argument('--kind',choices=['zcode','deepseek'],required=True)
    a=parser.parse_args();prepare(a.app,a.output,a.runtime,a.descriptor,a.kind)
