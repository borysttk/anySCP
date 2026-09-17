#!/usr/bin/env python3
"""Replace hardcoded UI strings in anySCP components with t('key') calls."""
import os, re, json

os.chdir('/home/ttk/anySCP')

with open('src/locales/catalog.json', 'r') as f:
    catalog = json.load(f)

en_strings = catalog['en']
text_to_key = {text: key for key, text in en_strings.items()}

def replace_in_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content
    changes = 0

    # Pattern 1: >Text< in JSX (capitalized, no braces)
    def replace_jsx_text(m):
        nonlocal changes
        text = m.group(1).strip()
        if text in text_to_key:
            changes += 1
            return f">{{t('{text_to_key[text]}')}}<"
        return m.group(0)

    content = re.sub(r'>([A-ZĄĆĘŁŃÓŚŚŹŻ][^<>{]{2,100})<', replace_jsx_text, content)

    # Pattern 2: title="Text"
    def replace_title(m):
        nonlocal changes
        text = m.group(1)
        if text in text_to_key:
            changes += 1
            return f"title={{t('{text_to_key[text]}')}}"
        return m.group(0)

    content = re.sub(r'title="([^"]{2,100})"', replace_title, content)

    # Pattern 3: placeholder="Text"
    def replace_placeholder(m):
        nonlocal changes
        text = m.group(1)
        if text in text_to_key:
            changes += 1
            return f"placeholder={{t('{text_to_key[text]}')}}"
        return m.group(0)

    content = re.sub(r'placeholder="([^"]{2,100})"', replace_placeholder, content)

    if content != original:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"  {path}: {changes} strings replaced")
    return changes

# Process all TSX files
total = 0
for root, dirs, files in os.walk('src'):
    if 'node_modules' in root or '__tests__' in root or '.test.' in root:
        continue
    for f in files:
        if f.endswith('.tsx'):
            path = os.path.join(root, f)
            try:
                c = replace_in_file(path)
                total += c
            except Exception as e:
                print(f"  ERROR {path}: {e}")

print(f"\nTotal strings replaced: {total}")