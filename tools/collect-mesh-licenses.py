"""Run after go list -m -f '{{.Dir}}|{{.Path}}|{{.Version}}' all.
Only installed dependency modules are included. No user configuration is read.
"""
from pathlib import Path
import sys

modules = Path(sys.argv[1]).read_text(encoding='utf-8-sig').splitlines()
parts = ['Mydex embedded networking — third-party notices\n'
         'Tailscale / tsnet, Go and their dependencies. Mydex is not an official Tailscale app.\n']
for line in modules:
    directory, name, version = line.split('|', 2)
    if not directory or name == 'dev.mydex/mesh':
        continue
    for p in sorted(Path(directory).iterdir()):
        if p.is_file() and p.name.upper().startswith(('LICENSE', 'COPYING', 'NOTICE')):
            parts.append(f'\n===== {name} {version} / {p.name} =====\n')
            parts.append(p.read_text(encoding='utf-8', errors='replace'))
parts.append('\n===== Go standard library =====\n')
parts.append(Path(sys.argv[2], 'LICENSE').read_text(encoding='utf-8'))
target = Path(__file__).resolve().parent.parent / 'assets/mesh-notices.txt'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text('\n'.join(parts), encoding='utf-8')
print(f'Wrote {target.stat().st_size} bytes of notices')
