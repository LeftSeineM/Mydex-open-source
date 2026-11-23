"""Stage a reversible LOCAL Claude bridge; never redistribute the vendor bundle.

Does not install or stop applications. Keeps Electron's integrity validation
enabled, recalculating the modified ASAR's digest in the local executable.
The resulting executable is a locally modified build, not vendor-signed.
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


def prepare(app, output, runtime, descriptor):
    exe_path = app / 'claude.exe'
    asar_path = app / 'resources' / 'app.asar'
    original = asar_path.read_bytes()
    sizes = struct.unpack('<4I', original[:16])
    raw_header = original[16:16 + sizes[3]]
    header = json.loads(raw_header)
    body = original[8 + sizes[1]:]
    package = header['files']['package.json']
    package_json = json.loads(body[int(package['offset']):int(package['offset']) + package['size']])
    if package_json.get('version') != '2.42304.0':
        raise RuntimeError('Unverified Claude version; adaptation required')
    modules = header['files']['.vite']['files']['build']['files']
    target = modules['index.chunk-Bn6onBlX.js']
    start, size = int(target['offset']), target['size']
    source = body[start:start + size]
    if b'exports.claudeCodeSessionManager=' not in source or b'[Mydex native bridge]' in source:
        raise RuntimeError('Unexpected or already patched desktop session module')
    payload = ('\n/* [Mydex native bridge] local compatibility build */\n'
        'try { require(' + json.dumps(str(runtime.resolve())) + ').startSessionServer({'
        'manager:exports.claudeCodeSessionManager,descriptorPath:' + json.dumps(str(descriptor.resolve())) +
        '}).catch(e=>console.error("[Mydex native bridge]",e.message)); }'
        'catch(e){ console.error("[Mydex native bridge]",e.message); }\n').encode()
    modified_source = source + payload
    for entry in entries(header):
        if int(entry['offset']) > start:
            entry['offset'] = str(int(entry['offset']) + len(payload))
    target['size'] = len(modified_source)
    if 'integrity' in target:
        info = target['integrity']
        if info['algorithm'] != 'SHA256':
            raise RuntimeError('Unsupported ASAR integrity algorithm')
        block_size = info['blockSize']
        info['hash'] = digest(modified_source)
        info['blocks'] = [digest(modified_source[i:i + block_size]) for i in range(0, len(modified_source), block_size)]
    new_header = json.dumps(header, ensure_ascii=False, separators=(',', ':')).encode()
    inner = struct.pack('<I', len(new_header)) + new_header
    inner += b'\0' * (-len(inner) % 4)
    pickle = struct.pack('<I', len(inner)) + inner
    modified_asar = struct.pack('<II', 4, len(pickle)) + pickle + body[:start] + modified_source + body[start + size:]
    exe = exe_path.read_bytes()
    old_hash, new_hash = digest(raw_header).encode(), digest(new_header).encode()
    if exe.count(old_hash) != 1:
        raise RuntimeError('Expected exactly one embedded ASAR digest; original files unchanged')
    marker = b'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'
    fuse_offset = exe.find(marker)
    if fuse_offset < 0 or exe[fuse_offset + len(marker) + 2 + 4] != ord('1'):
        raise RuntimeError('Expected enabled ASAR integrity validation')
    modified_exe = exe.replace(old_hash, new_hash, 1)
    output.mkdir(parents=True, exist_ok=False)
    (output / 'claude.exe').write_bytes(modified_exe)
    (output / 'app.asar').write_bytes(modified_asar)
    manifest = {'version': package_json['version'], 'preparedAt': datetime.datetime.now().isoformat(),
        'appDirectory': str(app.resolve()), 'runtime': str(runtime.resolve()),
        'original': {'exe': digest(exe), 'asar': digest(original)},
        'modified': {'exe': digest(modified_exe), 'asar': digest(modified_asar)},
        'originalHeaderDigest': old_hash.decode(), 'modifiedHeaderDigest': new_hash.decode(),
        'integrityValidationEnabled': True, 'vendorSignaturePreserved': False,
        'changes': ['Append local session bridge', 'Update embedded digest for local modified bundle']}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps({'prepared': str(output), 'version': package_json['version'], 'integrityValidationEnabled': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--app', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--runtime', type=pathlib.Path, required=True)
    parser.add_argument('--descriptor', type=pathlib.Path, required=True)
    args = parser.parse_args()
    prepare(args.app, args.output, args.runtime, args.descriptor)
