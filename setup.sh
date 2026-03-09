#!/bin/bash

# Agent-Assist - Super Installer (OpenClaw Master Edition v2)
# Unificado para Ubuntu/Debian
# Version: 2.0.0

set -e

# Colores para la terminal
CYAN='\033[0-36m'
NC='\033[0m'

# 1. Logo ASCII Premium (Forzado al inicio)
clear
echo -e "${CYAN}"
echo "    ___                         __           ___                _      __ "
echo "   /   |  ____ ____  ____  / /_         /   |  _____ _____(_)____/ /_"
echo "  / /| | / __ \`/ _ \/ __ \/ __/______ / /| | / ___// ___/ / ___/ __/"
echo " / ___ |/ /_/ /  __/ / / / /_/_____// ___ |(__  )(__  ) (__  ) /_  "
echo "/_/  |_|\__, /\___/_/ /_/\__/      /_/  |_/____//____/_/____/\__/  "
echo "       /____/                                                      "
echo -e "${NC}"

# 2. Verificar Sudo
if [ "$EUID" -ne 0 ]; then
  echo -e "\033[0-31mError: Por favor, ejecuta este script como root o con sudo.\033[0m"
  exit 1
fi

# 3. Actualizar Sistema y Dependencias
echo -e "\033[0-32m[1/5] Preparando cimientos del sistema...\033[0m"
apt update && apt upgrade -y

LIBASOUND="libasound2"
if apt-cache show libasound2t64 >/dev/null 2>&1; then LIBASOUND="libasound2t64"; fi

DEPENDENCIES="git python3 make g++ curl openssh-client libgbm-dev libnss3 \
libatk-bridge2.0-0 libgtk-3-0 $LIBASOUND libxss1 libpangocairo-1.0-0 \
libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 libxi6 libxtst6 \
libcups2 libxrandr2 libpango-1.0-0 libatk1.0-0 libfontconfig1 wget jq"
apt install -y $DEPENDENCIES

# 4. Configurar Node.js (v22)
echo -e "\033[0-32m[2/5] Configurando motor de ejecución (Node.js v22)...\033[0m"
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# 5. Instalar dependencias del proyecto
echo -e "\033[0-32m[3/5] Sincronizando librerías del Agente...\033[0m"
npm install --no-audit

# 6. Lanzar Configurador Maestro v2.0 (Interactivo)
echo -e "\033[0-32m[4/5] Iniciando Asistente de Configuración Inteligente v2.0...\033[0m"
NODE_NO_WARNINGS=1 npx tsx scripts/master-setup.ts

# 7. CLI Setup
echo -e "\033[0-32m[5/5] Instalando comandos globales 'agent-assist'...\033[0m"
cat << 'EOF' > /usr/local/bin/agent-assist
#!/bin/bash
case "$1" in
  logs) pm2 logs agent-assist ;;
  restart) pm2 restart agent-assist ;;
  status) pm2 status agent-assist ;;
  stop) pm2 stop agent-assist ;;
  doctor)
    echo "Ejecutando diagnóstico..."
    pm2 status agent-assist
    node -v
    ;;
  uninstall)
    echo -e "\033[0-31m⚠️  DESINSTALANDO AGENT-ASSIST...\033[0m"
    pm2 delete agent-assist && rm /usr/local/bin/agent-assist && echo "Hecho."
    ;;
  *)
    echo "Uso: agent-assist {status|logs|restart|stop|doctor|uninstall}"
    ;;
esac
EOF
chmod +x /usr/local/bin/agent-assist

# 8. Compilación y Arranque final
npm install -g pm2
npm run build

# Detener cualquier instancia como root previa
pm2 kill || true

# Arrancar agente como el usuario original usando 'su' o ejecutándolo sin sudo en el entorno
REAL_USER=${SUDO_USER:-$USER}
echo -e "\033[0-32mIniciando PM2 como usuario: $REAL_USER\033[0m"

# Dar permisos al usuario original sobre la carpeta
chown -R $REAL_USER:$REAL_USER .

sudo -u $REAL_USER bash -c "pm2 start dist/index.js --name agent-assist && pm2 save"
env PATH=$PATH:/usr/bin /usr/bin/pm2 startup systemd -u $REAL_USER --hp $(eval echo ~$REAL_USER) || true

# Mensaje final
