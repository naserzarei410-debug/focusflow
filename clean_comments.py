import os
import re

def clean_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    new_lines = []
    for line in lines:
        stripped = line.strip()
        # if it's a full line comment and doesn't have special keywords
        if stripped.startswith('//'):
            if any(kw in stripped.upper() for kw in ['TODO', 'ESLINT', 'PRETTIER', '@TS']):
                new_lines.append(line)
            else:
                continue # drop the comment
        else:
            new_lines.append(line)
            
    with open(filepath, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)

for root, _, files in os.walk('js'):
    for file in files:
        if file.endswith('.js') and file != 'icons-data.js':
            clean_file(os.path.join(root, file))

print("Comments cleaned.")
