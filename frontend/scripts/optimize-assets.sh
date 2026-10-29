#!/usr/bin/env bash
# Reduce los GLB de Hunyuan (50k triángulos, texturas enormes) a algo que el
# navegador pueda cargar sin ahogarse. 50k -> ~10k triángulos y texturas de
# 512-768 px en WebP.
set -euo pipefail

SRC="${1:-$HOME/Downloads/COSOS 3D}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/assets/hero"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$OUT"

# fuente:destino:textura
MAP=(
  "DNA:dna:768"
  "BACTERIA:bacteria:512"
  "FUNGI:fungi:512"
  "PLANT:plant:512"
  "CUCARRON:beetle:512"
  "CONSHA:shell:512"
  "HUMAN:human:512"
)

for entry in "${MAP[@]}"; do
  IFS=":" read -r source target size <<< "$entry"
  input="$SRC/$source.glb"
  [ -f "$input" ] || { echo "falta $input"; continue; }

  echo "→ $source.glb"
  npx --yes gltf-transform weld "$input" "$TMP/$target.1.glb"
  npx --yes gltf-transform simplify "$TMP/$target.1.glb" "$TMP/$target.2.glb" \
    --ratio 0.22 --error 0.0025
  npx --yes gltf-transform resize "$TMP/$target.2.glb" "$TMP/$target.3.glb" \
    --width "$size" --height "$size"
  npx --yes gltf-transform webp "$TMP/$target.3.glb" "$OUT/$target.glb" \
    --quality 82
  printf "   %-14s %6s\n" "$target.glb" "$(du -h "$OUT/$target.glb" | cut -f1)"
done

echo "listo en $OUT"
