#!/bin/bash

EN_FILE="apps/web/public/locales/en/translation.json"

echo "=== VERIFYING PLACEHOLDER MISMATCH ==="
echo ""

echo "The mismatch warning output seems confusing. Let me check the actual values:"
echo ""

echo "Raw English value:"
jq -r '.smartGreeting.topProfile' "$EN_FILE" | od -c | head -20
echo ""

echo "Raw SV value:"
jq -r '.smartGreeting.topProfile' apps/web/public/locales/sv/translation.json | od -c | head -20
echo ""

echo "Displayed as normal text:"
echo "EN:"
jq '.smartGreeting.topProfile' "$EN_FILE"
echo ""
echo "SV:"
jq '.smartGreeting.topProfile' apps/web/public/locales/sv/translation.json
echo ""

echo "Checking if both have {{name}} and {{percent}}:"
echo ""
echo "EN has {{name}}: $(jq -r '.smartGreeting.topProfile' "$EN_FILE" | grep -o '{{name}}' | wc -l)"
echo "EN has {{percent}}: $(jq -r '.smartGreeting.topProfile' "$EN_FILE" | grep -o '{{percent}}' | wc -l)"
echo ""
echo "SV has {{name}}: $(jq -r '.smartGreeting.topProfile' apps/web/public/locales/sv/translation.json | grep -o '{{name}}' | wc -l)"
echo "SV has {{percent}}: $(jq -r '.smartGreeting.topProfile' apps/web/public/locales/sv/translation.json | grep -o '{{percent}}' | wc -l)"

