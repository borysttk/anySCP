#!/usr/bin/env python3
"""Add `const { t } = useTranslation();` to components that have import but no call."""
import os, re

os.chdir('/home/ttk/anySCP')

components = [
    'src/components/snippets/SnippetFolderModal.tsx',
    'src/components/snippets/VariableDialog.tsx',
    'src/components/snippets/SnippetEditModal.tsx',
    'src/components/snippets/SnippetsPage.tsx',
    'src/components/s3/S3ConnectDialog.tsx',
    'src/components/s3/S3Browser.tsx',
    'src/components/s3/S3Page.tsx',
    'src/components/history/HistoryPage.tsx',
    'src/components/layout/StatusBar.tsx',
    'src/components/layout/UnifiedTabBar.tsx',
    'src/components/port-forwarding/PortForwardingPage.tsx',
    'src/components/transfers/TransfersPage.tsx',
    'src/components/transfers/TransferList.tsx',
    'src/components/dashboard/GroupModal.tsx',
    'src/components/dashboard/HostEditModal.tsx',
    'src/components/dashboard/HostsDashboard.tsx',
    'src/components/dashboard/ImportSshConfigModal.tsx',
    'src/components/sftp/SftpSessionPicker.tsx',
    'src/components/explorer/FilePropertiesDialog.tsx',
]

for path in components:
    full = f'/home/ttk/anySCP/{path}'
    with open(full, 'r', encoding='utf-8') as f:
        content = f.read()

    if 'useTranslation()' in content:
        print(f"SKIP {path} - already has call")
        continue

    # Find the first function declaration and add `const { t } = useTranslation();` after the first `{`
    # Pattern: export function Name() { or function Name() {
    match = re.search(r'(export\s+)?function\s+\w+\s*\([^)]*\)\s*\{', content)
    if not match:
        print(f"SKIP {path} - no function found")
        continue

    insert_pos = match.end()
    # Check if already has const { t }
    after = content[insert_pos:insert_pos+200]
    if 'const { t }' in after:
        print(f"SKIP {path} - already has const {{ t }}")
        continue

    # Insert `const { t } = useTranslation();` after the opening `{`
    new_content = content[:insert_pos] + '\n  const { t } = useTranslation();' + content[insert_pos:]
    with open(full, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print(f"OK {path}")