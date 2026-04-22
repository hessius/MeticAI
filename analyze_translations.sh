#!/bin/bash

# Define file paths
EN_FILE="apps/web/public/locales/en/translation.json"
SV_FILE="apps/web/public/locales/sv/translation.json"
DE_FILE="apps/web/public/locales/de/translation.json"
ES_FILE="apps/web/public/locales/es/translation.json"
FR_FILE="apps/web/public/locales/fr/translation.json"
IT_FILE="apps/web/public/locales/it/translation.json"

echo "=== ANALYZING TRANSLATION FILES ==="
echo ""

# Function to extract all keys (dot-path notation)
extract_keys() {
  local file=$1
  jq -r '
    def paths_to_keys:
      paths(scalars) as $p | ($p | join("."));
    [paths_to_keys] | sort | .[]
  ' "$file"
}

# Function to extract keys with their values for checking translations
extract_keys_with_values() {
  local file=$1
  jq -r '
    def paths_with_values:
      paths(scalars) as $p | {key: ($p | join(".")), value: getpath($p)};
    [paths_with_values] | sort_by(.key) | .[] | "\(.key):\(.value)"
  ' "$file"
}

# Extract keys from all files
echo "Extracting keys from all translation files..."
extract_keys "$EN_FILE" > /tmp/en_keys.txt
extract_keys "$SV_FILE" > /tmp/sv_keys.txt
extract_keys "$DE_FILE" > /tmp/de_keys.txt
extract_keys "$ES_FILE" > /tmp/es_keys.txt
extract_keys "$FR_FILE" > /tmp/fr_keys.txt
extract_keys "$IT_FILE" > /tmp/it_keys.txt

echo "Total keys in each locale:"
echo "EN: $(wc -l < /tmp/en_keys.txt)"
echo "SV: $(wc -l < /tmp/sv_keys.txt)"
echo "DE: $(wc -l < /tmp/de_keys.txt)"
echo "ES: $(wc -l < /tmp/es_keys.txt)"
echo "FR: $(wc -l < /tmp/fr_keys.txt)"
echo "IT: $(wc -l < /tmp/it_keys.txt)"
echo ""

# Check SWEDISH (SV) for missing/orphaned keys
echo "=== SWEDISH (SV) ==="
echo "Keys in EN but MISSING from SV:"
comm -23 /tmp/en_keys.txt /tmp/sv_keys.txt | head -20
MISSING_SV=$(comm -23 /tmp/en_keys.txt /tmp/sv_keys.txt | wc -l)
echo "Total missing: $MISSING_SV"
echo ""

echo "Keys in SV but MISSING from EN (orphaned):"
comm -13 /tmp/en_keys.txt /tmp/sv_keys.txt | head -20
ORPHANED_SV=$(comm -13 /tmp/en_keys.txt /tmp/sv_keys.txt | wc -l)
echo "Total orphaned: $ORPHANED_SV"
echo ""

# Check GERMAN (DE) for missing/orphaned keys
echo "=== GERMAN (DE) ==="
echo "Keys in EN but MISSING from DE:"
comm -23 /tmp/en_keys.txt /tmp/de_keys.txt | head -20
MISSING_DE=$(comm -23 /tmp/en_keys.txt /tmp/de_keys.txt | wc -l)
echo "Total missing: $MISSING_DE"
echo ""

echo "Keys in DE but MISSING from EN (orphaned):"
comm -13 /tmp/en_keys.txt /tmp/de_keys.txt | head -20
ORPHANED_DE=$(comm -13 /tmp/en_keys.txt /tmp/de_keys.txt | wc -l)
echo "Total orphaned: $ORPHANED_DE"
echo ""

# Check SPANISH (ES) for missing/orphaned keys
echo "=== SPANISH (ES) ==="
echo "Keys in EN but MISSING from ES:"
comm -23 /tmp/en_keys.txt /tmp/es_keys.txt | head -20
MISSING_ES=$(comm -23 /tmp/en_keys.txt /tmp/es_keys.txt | wc -l)
echo "Total missing: $MISSING_ES"
echo ""

echo "Keys in ES but MISSING from EN (orphaned):"
comm -13 /tmp/en_keys.txt /tmp/es_keys.txt | head -20
ORPHANED_ES=$(comm -13 /tmp/en_keys.txt /tmp/es_keys.txt | wc -l)
echo "Total orphaned: $ORPHANED_ES"
echo ""

# Check FRENCH (FR) for missing/orphaned keys
echo "=== FRENCH (FR) ==="
echo "Keys in EN but MISSING from FR:"
comm -23 /tmp/en_keys.txt /tmp/fr_keys.txt | head -20
MISSING_FR=$(comm -23 /tmp/en_keys.txt /tmp/fr_keys.txt | wc -l)
echo "Total missing: $MISSING_FR"
echo ""

echo "Keys in FR but MISSING from EN (orphaned):"
comm -13 /tmp/en_keys.txt /tmp/fr_keys.txt | head -20
ORPHANED_FR=$(comm -13 /tmp/en_keys.txt /tmp/fr_keys.txt | wc -l)
echo "Total orphaned: $ORPHANED_FR"
echo ""

# Check ITALIAN (IT) for missing/orphaned keys
echo "=== ITALIAN (IT) ==="
echo "Keys in EN but MISSING from IT:"
comm -23 /tmp/en_keys.txt /tmp/it_keys.txt | head -20
MISSING_IT=$(comm -23 /tmp/en_keys.txt /tmp/it_keys.txt | wc -l)
echo "Total missing: $MISSING_IT"
echo ""

echo "Keys in IT but MISSING from EN (orphaned):"
comm -13 /tmp/en_keys.txt /tmp/it_keys.txt | head -20
ORPHANED_IT=$(comm -13 /tmp/en_keys.txt /tmp/it_keys.txt | wc -l)
echo "Total orphaned: $ORPHANED_IT"
echo ""

