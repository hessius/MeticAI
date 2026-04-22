#!/bin/bash

EN_FILE="apps/web/public/locales/en/translation.json"

echo "=== MISSING KEYS FROM ALL LOCALES ==="
echo ""
echo "The following 3 keys are missing from all non-English locales:"
echo ""

# Show the actual values of the missing keys
echo "1. onboarding.machine.noMachinesFound:"
jq '.onboarding.machine.noMachinesFound' "$EN_FILE"
echo ""

echo "2. update.checkFailed:"
jq '.update.checkFailed' "$EN_FILE"
echo ""

echo "3. update.triggerFailed:"
jq '.update.triggerFailed' "$EN_FILE"
echo ""

echo "=== PLACEHOLDER MISMATCH DETAILS ==="
echo ""
echo "Key: smartGreeting.topProfile"
echo ""
echo "English value:"
jq '.smartGreeting.topProfile' "$EN_FILE"
echo ""

echo "Swedish value:"
jq '.smartGreeting.topProfile' apps/web/public/locales/sv/translation.json
echo ""

echo "The Swedish (and all other non-EN) versions have an extra {{percent}} placeholder"
echo ""

echo "=== UNTRANSLATED STRINGS SUMMARY ==="
echo ""
echo "Most common untranslated strings across locales:"
echo "- app.errors.* (error messages - mostly English)"
echo "- advancedCustomization.* (technical terms like 'Step-down', 'Dose (g)')"
echo "- app.loading: 'Loading...'"
echo "- app.meticulousEspresso: 'Meticulous Espresso' (app name - brand)"
echo "- appearance.* (UI setting descriptions, mostly technical)"
echo "- controlCenter.* (control panel labels)"
echo ""

echo "=== SUMMARY OF ISSUES ==="
echo ""
echo "1. MISSING KEYS (in all non-English locales):"
echo "   - onboarding.machine.noMachinesFound"
echo "   - update.checkFailed"
echo "   - update.triggerFailed"
echo ""

echo "2. PLACEHOLDER MISMATCHES:"
echo "   - smartGreeting.topProfile: SV/DE/ES/FR/IT have {{name}}{{percent}}, EN has {{name}}"
echo ""

echo "3. UNTRANSLATED STRINGS:"
echo "   - SV: ~14 untranslated"
echo "   - DE: ~15+ untranslated"
echo "   - ES: ~15+ untranslated"
echo "   - FR: ~15+ untranslated"
echo "   - IT: ~15+ untranslated"
echo "   Mostly technical terms, error messages, and UI labels"
echo ""

