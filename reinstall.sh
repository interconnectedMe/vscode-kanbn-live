#!/usr/bin/env bash
set -euo pipefail

# Build, package, install, and patch VS Code profile registries
cd "$(dirname "$0")"

echo "==> Building..."
npm run build

echo "==> Packaging..."
npx @vscode/vsce package

VSIX="$(ls -t vscode-kanbn-live-*.vsix | head -1)"
echo "==> Installing $VSIX..."
code --install-extension "$VSIX" --force

echo "==> Patching VS Code profile extension registries..."
python3 -c "
import json, glob, os

ext_dir = os.path.expanduser('~/.vscode/extensions')
config_dir = os.path.expanduser('~/.config/Code/User/profiles')

# Read the entry from main extensions.json
main_path = os.path.join(ext_dir, 'extensions.json')
with open(main_path) as f:
    main_data = json.load(f)

kanbn_entry = None
for ext in main_data:
    if ext.get('identifier', {}).get('id', '') == 'interconnectedme.vscode-kanbn-live':
        kanbn_entry = ext
        break

if kanbn_entry is None:
    print('ERROR: kanbn entry not found in main extensions.json')
    exit(1)

# Patch each profile
for profile_ext in glob.glob(os.path.join(config_dir, '*/extensions.json')):
    with open(profile_ext) as f:
        data = json.load(f)
    data = [e for e in data if e.get('identifier', {}).get('id', '') != 'interconnectedme.vscode-kanbn-live']
    data.append(kanbn_entry)
    with open(profile_ext, 'w') as f:
        json.dump(data, f, indent=2)
    print(f'  Patched {profile_ext}')

print('Done.')
"

echo "==> Reload VS Code (Ctrl+Shift+P → 'Developer: Reload Window')"
