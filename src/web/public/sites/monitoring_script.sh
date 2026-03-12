#!/bin/bash

# Lista de dispositivos conocidos
KNOWN_DEVICES="/path/to/known_devices.txt"

# Obtener la lista actual de dispositivos en la red
CURRENT_DEVICES=$(arp-scan --localnet)

# Comprobar si hay nuevos dispositivos
if ! grep -F -q "" <(echo "$CURRENT_DEVICES") <(cat "$KNOWN_DEVICES"); then
    echo "¡Nuevo dispositivo detectado!" >> /var/log/new_devices.log
fi

# Actualizar la lista conocida
arp-scan --localnet > "$KNOWN_DEVICES"