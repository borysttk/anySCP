#!/usr/bin/env python3
"""Fix useTranslation in SettingsPage.tsx - add to functions that use t, remove from those that don't."""
import os, re

path = '/home/ttk/anySCP/src/components/settings/SettingsPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find all function declarations
func_pattern = r'(export\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{'
functions = list(re.finditer(func_pattern, content))

for match in functions:
    func_name = match.group(2)
    func_start = match.end()
    
    # Find end of function by counting braces
    brace_count = 1
    pos = func_start
    while brace_count > 0 and pos < len(content):
        if content[pos] == '{':
            brace_count += 1
        elif content[pos] == '}':
            brace_count -= 1
        pos += 1
    func_end = pos
    
    func_body = content[func_start:func_end]
    
    has_t_usage = "t('" in func_body
    has_useTranslation = 'useTranslation()' in func_body
    
    if has_t_usage and not has_useTranslation:
        # Add useTranslation after opening {
        insert_pos = func_start
        new_body = '\n  const { t } = useTranslation();' + func_body
        content = content[:func_start] + new_body + content[func_end:]
        print(f"  Added useTranslation to {func_name}")
    elif has_useTranslation and not has_t_usage:
        # Remove unused useTranslation
        # Find the exact declaration
        decl = '  const { t } = useTranslation();\n'
        if decl in func_body:
            func_body = func_body.replace(decl, '')
            content = content[:func_start] + func_body + content[func_end:]
            print(f"  Removed unused useTranslation from {func_name}")

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print(f"Fixed {path}")