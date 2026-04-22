#!/bin/bash

EN_FILE="apps/web/public/locales/en/translation.json"
SV_FILE="apps/web/public/locales/sv/translation.json"
DE_FILE="apps/web/public/locales/de/translation.json"
ES_FILE="apps/web/public/locales/es/translation.json"
FR_FILE="apps/web/public/locales/fr/translation.json"
IT_FILE="apps/web/public/locales/it/translation.json"

echo "=== PLACEHOLDER CONSISTENCY CHECK ==="
echo ""

# Extract all keys with values that contain placeholders
echo "Finding all keys with {{...}} placeholders in English:"
jq -r '
  def paths_with_values:
    paths(scalars) as $p | select(getpath($p) | type == "string" and test("\\{\\{")) | {key: ($p | join(".")), value: getpath($p)};
  [paths_with_values] | sort_by(.key) | .[] | "\(.key): \(.value)"
' "$EN_FILE" > /tmp/en_placeholders.txt

echo "Total keys with placeholders in EN: $(wc -l < /tmp/en_placeholders.txt)"
echo ""

# For each placeholder key in English, check if the same placeholders exist in other locales
echo "Checking placeholder consistency across all locales..."
echo ""

# Create a function to check a specific locale
check_locale() {
  local locale_file=$1
  local locale_name=$2
  
  echo "Checking $locale_name:"
  
  jq -r '
    def paths_with_values:
      paths(scalars) as $p | select(getpath($p) | type == "string" and test("\\{\\{")) | {key: ($p | join(".")), value: getpath($p)};
    [paths_with_values] | map(.key) | sort | .[]
  ' "$locale_file" > /tmp/${locale_name}_placeholders_keys.txt
  
  # Compare with EN
  EN_COUNT=$(wc -l < /tmp/en_placeholders.txt)
  LOCALE_COUNT=$(wc -l < /tmp/${locale_name}_placeholders_keys.txt)
  
  if [ "$EN_COUNT" -ne "$LOCALE_COUNT" ]; then
    echo "  WARNING: Placeholder count mismatch! EN has $EN_COUNT, $locale_name has $LOCALE_COUNT"
  fi
  
  # Find keys with placeholders in EN but not in locale
  comm -23 <(cut -d: -f1 /tmp/en_placeholders.txt | sort) /tmp/${locale_name}_placeholders_keys.txt | while read key; do
    if [ ! -z "$key" ]; then
      echo "  Missing placeholder in key: $key"
    fi
  done
  
  # Check for mismatched placeholder content
  while IFS= read line; do
    key=$(echo "$line" | cut -d: -f1)
    en_value=$(echo "$line" | cut -d: -f2-)
    en_placeholders=$(echo "$en_value" | grep -oE '{{[^}]+}}' | sort)
    
    locale_value=$(jq -r --arg k "$key" 'getpath($k | split("."))' "$locale_file" 2>/dev/null)
    if [ ! -z "$locale_value" ]; then
      locale_placeholders=$(echo "$locale_value" | grep -oE '{{[^}]+}}' | sort)
      if [ "$en_placeholders" != "$locale_placeholders" ]; then
        echo "  MISMATCH in '$key':"
        echo "    EN placeholders: $en_placeholders"
        echo "    $locale_name placeholders: $locale_placeholders"
      fi
    fi
  done < /tmp/en_placeholders.txt
}

check_locale "$SV_FILE" "SV"
echo ""
check_locale "$DE_FILE" "DE"
echo ""
check_locale "$ES_FILE" "ES"
echo ""
check_locale "$FR_FILE" "FR"
echo ""
check_locale "$IT_FILE" "IT"

