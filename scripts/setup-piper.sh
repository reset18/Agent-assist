#!/bin/bash
set -e

PIPER_DIR="$HOME/piper"
VOICE_URL="https://github.com/rhasspy/piper-voices/releases/download/v1.0.0/es_ES-gestecho-medium.onnx"
CONFIG_URL="https://github.com/rhasspy/piper-voices/releases/download/v1.0.0/es_ES-gestecho-medium.onnx.json"

echo "[Piper Setup] Iniciando instalación en $PIPER_DIR..."

# 1. Limpieza de instalaciones erróneas previas
echo "[Piper Setup] Desinstalando paquetes conflictivos..."
sudo apt-get remove -y piper || true
sudo apt-get autoremove -y || true

# 2. Descarga e instalación de Piper
mkdir -p "$PIPER_DIR"
cd "$PIPER_DIR"

if [ ! -f "piper" ]; then
    echo "[Piper Setup] Descargando binario de Piper..."
    curl -L https://github.com/rhasspy/piper/releases/latest/download/piper_linux_x86_64.tar.gz | tar -xz
else
    echo "[Piper Setup] El binario de Piper ya existe, saltando descarga."
fi

# 3. Descarga de modelo de voz (Español Masculino - GESTECHO)
echo "[Piper Setup] Descargando modelo de voz es-ES (Masculino)..."
curl -L "$VOICE_URL" -o es_ES-gestecho-medium.onnx
curl -L "$CONFIG_URL" -o es_ES-gestecho-medium.onnx.json

# 4. Prueba rápida
echo "[Piper Setup] Realizando prueba de síntesis..."
echo "Hola, soy el motor de voz Piper, instalado correctamente." | ./piper/piper --model es_ES-gestecho-medium.onnx --output_file test.wav

if [ -f "test.wav" ]; then
    echo "[Piper Setup] INSTALACIÓN COMPLETADA CON ÉXITO."
    ls -la "$PIPER_DIR"
else
    echo "[Piper Setup] ERROR: No se pudo generar el audio de prueba."
    exit 1
fi
