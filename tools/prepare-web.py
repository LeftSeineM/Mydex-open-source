"""Version and compress a fresh Flutter web build."""
from pathlib import Path
import json
import shutil
import gzip
import hashlib
root = Path(__file__).resolve().parents[1] / 'build/web'
main = root / 'main.dart.js'
project = Path(__file__).resolve().parents[1]
version = hashlib.sha256(main.read_bytes() + (project / 'web/mydex-update.js').read_bytes() + (root / 'index.html').read_bytes()).hexdigest()[:12]
(root / 'web-release.json').write_text(json.dumps({'build': version}), encoding='utf-8')
shutil.copyfile(Path(__file__).resolve().parents[1] / 'web/mydex-update.js', root / 'mydex-update.js')
name = f'main.{version}.js'
(root / name).write_bytes(main.read_bytes())
p = root / 'flutter_bootstrap.js'
p.write_text(p.read_text(encoding='utf-8').replace('main.dart.js', name), encoding='utf-8')
p = root / 'index.html'
p.write_text(p.read_text(encoding='utf-8').replace('src="flutter_bootstrap.js"', f'src="flutter_bootstrap.js?v={version}"'), encoding='utf-8')
for p in root.rglob('*'):
    if p.is_file() and p.suffix in {'.js', '.json', '.css', '.html', '.wasm'}:
        p.with_name(p.name + '.gz').write_bytes(gzip.compress(p.read_bytes(), compresslevel=9))
print('Web build:', version)
