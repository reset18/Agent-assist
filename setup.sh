#!/bin/bash

# Agent-Assist - Super Installer (OpenClaw Master Edition)
# Unificado para Ubuntu/Debian
# Version: 1.2.0

set -e

# Colores para la terminal
GREEN='\033[0-32m'
BLUE='\033[0-34m'
RED='\033[0-31m'
YELLOW='\033[1-33m'
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
echo -e "${BLUE}##################################################${NC}"
echo -e "${BLUE}#            AGENT-ASSIST INSTALLER v1.2.0       #${NC}"
echo -e "${BLUE}##################################################${NC}"
echo ""

# 2. Advertencia de Seguridad
echo -e "${RED}⚠️  ADVERTENCIA DE SEGURIDAD${NC}"
echo -e "Estás a punto de instalar Agent-Assist. Este script instalará dependencias"
echo -e "del sistema, configurará servicios persistentes y tomará control de"
echo -e "las capacidades de automatización de esta máquina."
echo ""
read -p "¿Estás seguro de que deseas continuar? (Si/No): " SECURITY_CONFIRM </dev/tty
if [[ "$SECURITY_CONFIRM" != "Si" && "$SECURITY_CONFIRM" != "si" && "$SECURITY_CONFIRM" != "S" && "$SECURITY_CONFIRM" != "s" ]]; then
    echo -e "${YELLOW}Instalación cancelada por el usuario.${NC}"
    exit 0
fi

# 3. Verificar Sudo
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Por favor, ejecuta este script como root o con sudo.${NC}"
  exit 1
fi

# 4. Actualizar Sistema y Dependencias
echo -e "\n${GREEN}[1/7] Actualizando repositorios del sistema...${NC}"
apt update && apt upgrade -y

echo -e "${GREEN}[2/7] Instalando librerías críticas (Puppeteer Ready)...${NC}"
LIBASOUND="libasound2"
if apt-cache show libasound2t64 >/dev/null 2>&1; then LIBASOUND="libasound2t64"; fi

DEPENDENCIES="git python3 make g++ curl openssh-client libgbm-dev libnss3 \
libatk-bridge2.0-0 libgtk-3-0 $LIBASOUND libxss1 libpangocairo-1.0-0 \
libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 libxi6 libxtst6 \
libcups2 libxrandr2 libpango-1.0-0 libatk1.0-0 libfontconfig1 wget jq"
apt install -y $DEPENDENCIES

# 5. Configurar Node.js (v22 recomendado para mayor compatibilidad)
echo -e "${GREEN}[3/7] Configurando Node.js Engine (v22)...${NC}"
if ! command -v node &> /dev/null; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  nvm install 22
  nvm use 22
  nvm alias default 22
else
  echo -e "${BLUE}Node.js ya está instalado: $(node -v)${NC}"
fi

# 6. Preparar Código
echo -e "${GREEN}[4/7] Sincronizando repositorio Agent-assist...${NC}"
npm install

# 7. Asistente de Configuración (IA & Master Config)
echo -e "\n${BLUE}##################################################${NC}"
echo -e "${BLUE}#           ASISTENTE DE INTELIGENCIA            #${NC}"
echo -e "${BLUE}##################################################${NC}"

if [ ! -f ".env" ]; then cp .env.example .env; fi

# Selector de Proveedor
echo -e "\n${YELLOW}Selecciona el cerebro (IA) para tu agente:${NC}"
options=("OpenRouter" "OpenAI" "Google Gemini" "Anthropic" "Groq")
select opt in "${options[@]}"
do
    case $REPLY in
        1) LLM_PROVIDER="openrouter"; break ;;
        2) LLM_PROVIDER="openai"; break ;;
        3) LLM_PROVIDER="google"; break ;;
        4) LLM_PROVIDER="anthropic"; break ;;
        5) LLM_PROVIDER="groq"; break ;;
        *) echo -e "${RED}Opción inválida.${NC}" ;;
    esac
done </dev/tty

read -p "Introduce tu API Key para $LLM_PROVIDER: " API_KEY </dev/tty

# Selector de Modelo según Proveedor
echo -e "\n${YELLOW}Selecciona el modelo específico para $LLM_PROVIDER:${NC}"
case $LLM_PROVIDER in
    openrouter)
        m_opts=("openrouter/auto" "google/gemini-2.0-flash-001" "openai/gpt-4o-mini" "deepseek/deepseek-chat")
        ;;
    openai)
        m_opts=("gpt-4o" "gpt-4o-mini" "o1-preview")
        ;;
    google)
        m_opts=("gemini-2.0-flash-exp" "gemini-1.5-pro")
        ;;
    anthropic)
        m_opts=("claude-3-5-sonnet-20241022" "claude-3-5-haiku-20241022")
        ;;
    groq)
        m_opts=("llama-3.3-70b-versatile" "mixtral-8x7b-32768")
        ;;
esac

select m_opt in "${m_opts[@]}"
do
    if [ -n "$m_opt" ]; then LLM_MODEL=$m_opt; break; else echo "Opción inválida."; fi
done </dev/tty

read -p "Puerto del servidor [3005]: " PORT </dev/tty
PORT=${PORT:-3005}

# Actualizar .env preliminar
sed -i "s|LLM_PROVIDER=.*|LLM_PROVIDER=$LLM_PROVIDER|" .env
sed -i "s|PORT=.*|PORT=$PORT|" .env

# Mapeo de Keys
if [ "$LLM_PROVIDER" == "openrouter" ]; then sed -i "s|OPENROUTER_API_KEY=.*|OPENROUTER_API_KEY=$API_KEY|" .env; fi
if [ "$LLM_PROVIDER" == "openai" ]; then sed -i "s|OPENAI_API_KEY=.*|OPENAI_API_KEY=$API_KEY|" .env; fi
if [ "$LLM_PROVIDER" == "google" ]; then sed -i "s|GEMINI_API_KEY=.*|GEMINI_API_KEY=$API_KEY|" .env; fi
if [ "$LLM_PROVIDER" == "anthropic" ]; then sed -i "s|ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$API_KEY|" .env; fi
if [ "$LLM_PROVIDER" == "groq" ]; then sed -i "s|GROQ_API_KEY=.*|GROQ_API_KEY=$API_KEY|" .env; fi

# Guardar modelo en DB (vía SQLite cli si está disponible o lo hará el script de platform)
# De momento lo dejamos para que el agente lo inicie.

# 8. Configuración de Red Social (WhatsApp / Telegram)
echo -e "\n${GREEN}[5/7] Configurando plataforma de comunicación...${NC}"
npx tsx scripts/setup-platform.ts

# 9. CLI Setup
echo -e "\n${GREEN}[6/7] Instalando comandos CLI 'agent-assist'...${NC}"
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

# 10. Compilación y Arranque
echo -e "\n${GREEN}[7/7] Compilando e Iniciando el motor de Agent-Assist...${NC}"
npm install -g pm2
npm run build
pm2 start dist/index.js --name agent-assist
pm2 save
pm2 startup | bash || true

# 11. Finalización
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
echo -e "${GREEN}   AGENT-ASSIST INSTALADO Y VINCULADO!          ${NC}"
echo -e "${BLUE}##################################################${NC}"
echo -e "\nTu agente ya está operando y listo para recibir órdenes."
echo -e "\n${YELLOW}Enlaces de acceso:${NC}"
echo -e "Local:   ${CYAN}http://localhost:$PORT${NC}"
echo -e "Remoto:  ${CYAN}http://$(hostname -I | awk '{print $1}'):$PORT${NC}"
echo ""
echo -e "Usa el comando '${GREEN}agent-assist logs${NC}' para ver la actividad en tiempo real."
echo -e "${BLUE}##################################################${NC}"
