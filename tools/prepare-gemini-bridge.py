"""Install the local interactive bridge into a verified Gemini CLI distribution.

Backs up original chunks. Does not launch CLI, change providers, or create sessions.
"""
import argparse
import json
import pathlib
import shutil

def prepare(package, backup):
    if json.loads((package / 'package.json').read_text())['version'] != '0.66.0':
        raise RuntimeError('Unverified Gemini version; adaptation required')
    needle = '  const lastOutputTime = Math.max('
    files = []
    for file in (package / 'bundle').glob('interactiveCli-*.js'):
        text = file.read_text(encoding='utf-8')
        if '[Mydex native bridge]' in text:
            raise RuntimeError('Already patched; restore the matching backup first')
        if text.count(needle) == 1:
            files.append((file, text))
    if not files:
        raise RuntimeError('Interactive submit hook not found; nothing changed')
    backup.mkdir(parents=True, exist_ok=False)
    runtime = pathlib.Path(__file__).resolve().parent.parent / 'desktop' / 'bridges'
    for name in ['gemini-session.cjs', 'session-server.cjs']:
        shutil.copy2(runtime / name, backup / name)
    hook = '  /* [Mydex native bridge] */ require(' + json.dumps(str((backup / 'gemini-session.cjs').resolve())) + ').update({config,history,pendingHistoryItems,streamingState,submitQuery});\n'
    for file, text in files:
        shutil.copy2(file, backup / file.name)
        file.write_text(text.replace(needle, hook + needle), encoding='utf-8')
    print('Installed interactive bridge; original chunks backed up:', len(files))

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--package', type=pathlib.Path, required=True)
    p.add_argument('--backup', type=pathlib.Path, required=True)
    a = p.parse_args()
    prepare(a.package, a.backup)
