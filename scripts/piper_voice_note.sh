#!/bin/bash
# piper_voice_note.sh - Genera notas de voz para Telegram (OGG/Opus)
# Uso: ./piper_voice_note.sh "Texto a convertir" "/ruta/salida.ogg"

TEXT=$1
OUT_OGG=$2

# Configuración de Rutas (Prioridad: Usuario > Horus Default)
PIPER_BIN="$HOME/piper/piper/piper"
if [ ! -f "$PIPER_BIN" ]; then PIPER_BIN="piper"; fi # Si está en PATH

MODEL="$HOME/.local/share/piper-voices/es_ES-sharvard-medium/model.onnx"
if [ ! -f "$MODEL" ]; then
    MODEL="$HOME/piper/es_ES-sharvard-medium.onnx"
fi

if [ -z "$TEXT" ] || [ -z "$OUT_OGG" ]; then
    echo "Uso: $0 \"TEXTO\" /ruta/salida.ogg"
    exit 1
fi

if [ ! -f "$MODEL" ]; then
    echo "Error: Modelo no encontrado en $MODEL"
    exit 1
fi

# 1. Crear WAV temporal
TEMP_WAV=$(mktemp /tmp/piper_XXXXXX.wav)

echo "[Piper] Generando WAV..."
echo "$TEXT" | "$PIPER_BIN" --model "$MODEL" --output_file "$TEMP_WAV"

if [ ! -f "$TEMP_WAV" ] || [ ! -s "$TEMP_WAV" ]; then
    echo "Error: Falló la generación del WAV."
    exit 1
fi

# 2. Convertir a OGG/Opus (formato Telegram Voice Note)
echo "[FFmpeg] Convirtiendo a OGG/Opus..."
ffmpeg -y -i "$TEMP_WAV" \
  -c:a libopus -b:a 24k -vbr on -compression_level 10 \
  -application voip -ac 1 -ar 48000 \
  "$OUT_OGG"

# 3. Limpieza
rm "$TEMP_WAV"

if [ -f "$OUT_OGG" ]; then
    echo "¡Éxito! Nota de voz generada en: $OUT_OGG"
else
    echo "Error: Falló la conversión a OGG."
    exit 1
fi
