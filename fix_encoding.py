#!/usr/bin/env python3
# Fix corrupted emoji encoding in script.js

with open('script.js', 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

# Replace corrupted characters with proper emojis
replacements = {
    'âœ…': '✅',
    'âŒ': '❌',
    'ðŸ"Š': '📊',
    'ðŸ'¾': '💾',
    'ðŸ—'ï¸': '🗑️',
    'âž•': '➕',
    'â‰¥': '≥',
    'â‰¤': '≤',
    'Monâ€"Sat': 'Mon-Sat',
}

for old, new in replacements.items():
    content = content.replace(old, new)

with open('script.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Fixed all emoji encoding issues!")
