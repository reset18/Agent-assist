#!/bin/bash

# Agent-Assist - Super Installer (OpenClaw Style)
# Unificado para Ubuntu/Debian
# Version: 1.1.0

set -e

# Colores para la terminal
GREEN='\033[0-32m'
BLUE='\033[0-34m'
RED='\033[0-31m'
YELLOW='\033[1-33m'
CYAN='\033[0-36m'
NC='\033[0m' # No Color

# Logo ASCII Premium (Forzado al inicio)
clear
echo -e "${CYAN}"
echo "    ___                         __           ___                _      __ "
echo "   /   |  ____ ____  ____  / /_         /   |  _____ _____(_)____/ /_"
echo "  / /| | / __ \`/ _ \/ __ \/ __/______ / /| | / ___// ___/ / ___/ __/"
echo " / ___ |/ /_/ /  __/ / / / /_/_____// ___ |(__  )(__  ) (__  ) /_  "
echo "/_/  |_|\__, /\___/_/ /_/\__/      /_/  |_/____//____/_/____/\__/  "
echo "       /____/                                                      "
echo -e "${NC}"
echo -e "${BLUE}##################################################${NC}"
echo -e "${BLUE}#            AGENT-ASSIST INSTALLER v1.1.0       #${NC}"
echo -e "${BLUE}##################################################${NC}"
echo -e "${YELLOW}Preparando instalación profesional...${NC}"
echo ""

# 1. Verificar Sudo
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Por favor, ejecuta este script como root o con sudo.${NC}"
  exit 1
fi

# 2. Actualizar Sistema
echo -e "${GREEN}[1/7] Actualizando repositorios del sistema...${NC}"
apt update && apt upgrade -y

# 3. Instalar Dependencias Base
echo -e "${GREEN}[2/7] Instalando librerías críticas (Puppeteer Ready)...${NC}"

# Manejar diferencias de nombres en librerías (Ubuntu 24.04+)
LIBASOUND="libasound2"
if apt-cache show libasound2t64 >/dev/null 2>&1; then
    LIBASOUND="libasound2t64"
fi

DEPENDENCIES="git python3 make g++ curl openssh-client libgbm-dev libnss3 \
libatk-bridge2.0-0 libgtk-3-0 $LIBASOUND libxss1 libpangocairo-1.0-0 \
libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 libxi6 libxtst6 \
libcups2 libxrandr2 libpango-1.0-0 libatk1.0-0 libfontconfig1 wget jq"

apt install -y $DEPENDENCIES

# 4. Instalar Node.js via NVM
echo -e "${GREEN}[3/7] Configurando Node.js Engine (v20)...${NC}"
if ! command -v node &> /dev/null; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
  nvm alias default 20
else
  echo -e "${BLUE}Node.js ya está instalado: $(node -v)${NC}"
fi

# 5. Configurar el Proyecto
echo -e "${GREEN}[4/7] Sincronizando repositorio Agent-assist...${NC}"
if [ ! -f "package.json" ]; then
  echo -e "${RED}Error: package.json no encontrado.${NC}"
  echo -e "Debes ejecutar este script desde la carpeta central del proyecto."
  exit 1
fi

npm install

# 6. Asistente de Configuración Interactiva (Selector Premium)
echo -e "\n${BLUE}##################################################${NC}"
echo -e "${BLUE}#           ASISTENTE DE CONFIGURACIÓN           #${NC}"
echo -e "${BLUE}##################################################${NC}"

if [ ! -f ".env" ]; then
    cp .env.example .env
fi

# Selector Estilo OpenClaw
echo -e "\n${YELLOW}¿Qué cerebro (IA) quieres usar para tu agente?${NC}"
options=("OpenRouter (Recomendado)" "OpenAI (GPT-4o)" "Google Gemini" "Anthropic (Claude)" "Grok (xAI)" "Groq (Fast)")
PS3=$'\nSelecciona una opción [1-6]: '
select opt in "${options[@]}"
do
    case $REPLY in
        1) LLM_PROVIDER="openrouter"; break ;;
        2) LLM_PROVIDER="openai"; break ;;
        3) LLM_PROVIDER="google"; break ;;
        4) LLM_PROVIDER="anthropic"; break ;;
        5) LLM_PROVIDER="xai"; break ;;
        6) LLM_PROVIDER="groq"; break ;;
        *) echo -e "${RED}Opción inválida. Elige del 1 al 6.${NC}" ;;
    esac
done </dev/tty

echo -e "\nHas seleccionado: ${GREEN}$LLM_PROVIDER${NC}"
read -p "Introduce tu API Key para $LLM_PROVIDER: " API_KEY </dev/tty
read -p "Puerto del servidor [3000]: " PORT </dev/tty
PORT=${PORT:-3000}

# Actualizar .env
sed -i "s|LLM_PROVIDER=.*|LLM_PROVIDER=$LLM_PROVIDER|" .env

if [ "$LLM_PROVIDER" == "openrouter" ]; then
    sed -i "s|OPENROUTER_API_KEY=.*|OPENROUTER_API_KEY=$API_KEY|" .env
elif [ "$LLM_PROVIDER" == "openai" ]; then
    grep -q "OPENAI_API_KEY" .env || echo "OPENAI_API_KEY=$API_KEY" >> .env
    sed -i "s|OPENAI_API_KEY=.*|OPENAI_API_KEY=$API_KEY|" .env
elif [ "$LLM_PROVIDER" == "google" ]; then
    grep -q "GEMINI_API_KEY" .env || echo "GEMINI_API_KEY=$API_KEY" >> .env
    sed -i "s|GEMINI_API_KEY=.*|GEMINI_API_KEY=$API_KEY|" .env
elif [ "$LLM_PROVIDER" == "anthropic" ]; then
    grep -q "ANTHROPIC_API_KEY" .env || echo "ANTHROPIC_API_KEY=$API_KEY" >> .env
    sed -i "s|ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$API_KEY|" .env
fi

sed -i "s|PORT=.*|PORT=$PORT|" .env

echo -e "\n${GREEN}✔ Configuración guardada correctamente.${NC}"

# 7. Preparar Agent-Assist CLI + Doctor + Uninstall
echo -e "${GREEN}[5/7] Instalando Agent-Assist CLI Master...${NC}"
cat << 'EOF' > /usr/local/bin/agent-assist
#!/bin/bash
GREEN='\033[0-32m'
BLUE='\033[0-34m'
RED='\033[0-31m'
YELLOW='\033[1-33m'
CYAN='\033[0-36m'
NC='\033[0m'

case "$1" in
  logs)
    pm2 logs agent-assist
    ;;
  restart)
    pm2 restart agent-assist
    ;;
  status)
    pm2 status agent-assist
    ;;
  stop)
    pm2 stop agent-assist
    ;;
  doctor)
    echo -e "${BLUE}=== Agent-Assist System Doctor ===${NC}"
    NODE_V=$(node -v 2>/dev/null || echo "No instalado")
    echo -n "Node.js: "
    if [[ $NODE_V == v20* ]] || [[ $NODE_V == v22* ]]; then
        echo -e "${GREEN}$NODE_V (OK)${NC}"
    else
        echo -e "${RED}$NODE_V (Incompatible - se requiere v20+)${NC}"
    fi

    echo -n "Librerías Puppeteer: "
    MISSING_LIBS=""
    for lib in libgbm1 libnss3 libatk-bridge2.0-0 libgtk-3-0; do
        if ! dpkg -l | grep -q $lib; then
            MISSING_LIBS="$MISSING_LIBS $lib"
        fi
    done
    if ! dpkg -l | grep -E "libasound2|libasound2t64" >/dev/null; then MISSING_LIBS="$MISSING_LIBS libasound2"; fi

    if [ -z "$MISSING_LIBS" ]; then
        echo -e "${GREEN}Presentes (OK)${NC}"
    else
        echo -e "${YELLOW}Faltan: $MISSING_LIBS${NC}"
        echo -e "${BLUE}Ejecutando autofix...${NC}"
        sudo apt update && sudo apt install -y libgbm-dev libnss3 libatk-bridge2.0-0 libgtk-3-0 libasound2 || sudo apt install -y libasound2t64
    fi

    echo -n "Proceso PM2: "
    if pm2 status agent-assist | grep -q "online"; then echo -e "${GREEN}Online (OK)${NC}"; else
        echo -e "${RED}Offline${NC}"
        pm2 restart agent-assist || pm2 start dist/index.js --name agent-assist
    fi
    ;;
  uninstall)
    echo -e "${RED}⚠️  VAS A DESINSTALAR AGENT-ASSIST COMPLETAMENTE${NC}"
    read -p "¿Estás seguro? (s/n): " confirm </dev/tty
    if [[ "$confirm" == "s" || "$confirm" == "S" ]]; then
        echo -e "${YELLOW}Deteniendo servicios...${NC}"
        pm2 stop agent-assist || true
        pm2 delete agent-assist || true
        echo -e "${YELLOW}Eliminando binarios...${NC}"
        rm /usr/local/bin/agent-assist
        echo -e "${GREEN}✔ Desinstalado. Nota: Los archivos del proyecto y base de datos no se han borrado manualmente por seguridad.${NC}"
    fi
    ;;
  *)
    echo -e "${CYAN}Agent-Assist Master Command:${NC}"
    echo "  agent-assist status    - Ver estado del proceso"
    echo "  agent-assist logs      - Ver logs en tiempo real"
    echo "  agent-assist restart   - Reiniciar el agente"
    echo "  agent-assist stop      - Detener el agente"
    echo "  agent-assist doctor    - Diagnosticar y reparar el sistema"
    echo "  agent-assist uninstall - Eliminar el agente del sistema"
    ;;
esac
EOF
chmod +x /usr/local/bin/agent-assist

# 8. Iniciar con PM2
echo -e "${GREEN}[6/7] Compilando e Iniciando Agente...${NC}"
npm install -g pm2
npm run build
pm2 start dist/index.js --name agent-assist || pm2 restart agent-assist
pm2 save
pm2 startup | bash || true

# 9. Finalización
echo -e "\n${BLUE}##################################################${NC}"
echo -e "${GREEN}   AGENT-ASSIST INSTALADO CORRECTAMENTE!        ${NC}"
echo -e "${BLUE}##################################################${NC}"
echo -e "Acceso Web: http://$(hostname -I | awk '{print $1}'):$PORT"
echo -e "Versión: 1.1.0"
echo -e "Uso: ${GREEN}agent-assist${NC}"
echo -e "${BLUE}##################################################${NC}"
