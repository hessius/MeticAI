#!/bin/bash

EN_FILE="apps/web/public/locales/en/translation.json"
SV_FILE="apps/web/public/locales/sv/translation.json"
DE_FILE="apps/web/public/locales/de/translation.json"
ES_FILE="apps/web/public/locales/es/translation.json"
FR_FILE="apps/web/public/locales/fr/translation.json"
IT_FILE="apps/web/public/locales/it/translation.json"

echo "=== UNTRANSLATED STRINGS CHECK ==="
echo "(Looking for values identical to English, excluding proper nouns, brand names, units, technical terms)"
echo ""

# Create a jq script to compare
compare_locale() {
  local locale_file=$1
  local locale_name=$2
  
  echo "Checking $locale_name for untranslated strings:"
  
  # Get all keys/values from both files and compare
  jq -r '
    def paths_with_values:
      paths(scalars) as $p | {key: ($p | join(".")), value: getpath($p)};
    [paths_with_values] | sort_by(.key)
  ' "$EN_FILE" > /tmp/en_values.json
  
  jq -r '
    def paths_with_values:
      paths(scalars) as $p | {key: ($p | join(".")), value: getpath($p)};
    [paths_with_values] | sort_by(.key)
  ' "$locale_file" > /tmp/locale_values.json
  
  # Compare and find identical values
  jq -r '
    . as $en_data |
    input as $locale_data |
    # Create maps for faster lookup
    ($en_data | map({(.key): .value}) | add) as $en_map |
    ($locale_data | map({(.key): .value}) | add) as $locale_map |
    # Find keys where values are identical (excluding technical stuff)
    $en_map | to_entries | map(
      select(
        .value == $locale_map[.key] and
        (.value | test("^[A-Z0-9_]+$") | not) and
        (.value | length > 5) and
        (.key | test("^(smartGreeting|generic)") | not)
      )
    ) | .[] | "\(.key): \(.value)"
  ' /tmp/en_values.json /tmp/locale_values.json 2>/dev/null | head -15
}

compare_locale "$SV_FILE" "SV"
echo ""
compare_locale "$DE_FILE" "DE"
echo ""
compare_locale "$ES_FILE" "ES"
echo ""
compare_locale "$FR_FILE" "FR"
echo ""
compare_locale "$IT_FILE" "IT"

