"""Select an installed iPhone simulator and report exact coverage, never fake latest."""
import json
import os
import subprocess
from pathlib import Path

root = Path('build/ios-validation')
root.mkdir(parents=True, exist_ok=True)
data = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', '--json']))
(root / 'simulator-inventory.json').write_text(json.dumps(data, indent=2))
candidates = []
for runtime in data['runtimes']:
    if not runtime.get('isAvailable') or not runtime['name'].startswith('iOS'):
        continue
    version = tuple(int(n) for n in runtime['version'].split('.'))
    candidates.append((version, runtime))
if not candidates:
    raise SystemExit('No available iPhone simulator runtime')
requested = os.environ.get('REQUESTED_IOS', '27.2')
_, runtime = max(candidates, key=lambda item: (item[1]['version'] == requested, item[0]))
devices = [d for d in data['devices'].get(runtime['identifier'], [])
           if d.get('isAvailable') and d['name'].startswith('iPhone')]
if devices:
    device = devices[-1]
else:
    # Downloading a runtime does not necessarily create a simulator device.
    types = [d for d in data['devicetypes'] if d['name'].startswith('iPhone')]
    preferred = next((d for d in types if d['name'] == 'iPhone 17 Pro'), types[-1])
    udid = subprocess.check_output(['xcrun', 'simctl', 'create', 'Mydex iPhone',
                                   preferred['identifier'], runtime['identifier']], text=True).strip()
    device = {'name': preferred['name'], 'udid': udid, 'state': 'Shutdown'}
report = {'requestedIOS': requested, 'actualIOS': runtime['version'],
          'device': device['name'], 'udid': device['udid'],
          'exactRequestedVersion': runtime['version'] == requested,
          'scope': 'Simulator only; no device distribution/signing validation'}
(root / 'coverage.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report))
with open(os.environ['GITHUB_ENV'], 'a') as stream:
    stream.write(f"SIMULATOR_ID={device['udid']}\n")
if device['state'] != 'Booted':
    subprocess.run(['xcrun', 'simctl', 'boot', device['udid']], check=True)
subprocess.run(['xcrun', 'simctl', 'bootstatus', device['udid'], '-b'], check=True)
