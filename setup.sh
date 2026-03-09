#!/bin/bash

# Horus AgentAssist - Super Installer (OpenClaw Style)
# Unificado para Ubuntu/Debian

set -e

# Colores para la terminal
GREEN='\033[0-32m'
BLUE='\033[0-34m'
RED='\033[0-31m'
YELLOW='\033[1-33m'
NC='\033[0m' # No Color

echo -e "${BLUE}##################################################${NC}"
echo -e "${BLUE}#        HORUS AGENTASSIST - SUPER INSTALLER     #${NC}"
echo -e "${BLUE}##################################################${NC}"

# 1. Verificar Sudo
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Por favor, ejecuta este script como root o con sudo.${NC}"
  exit 1
fi

# 2. Actualizar Sistema
echo -e "${GREEN}[1/7] Actualizando repositorios...${NC}"
apt update && apt upgrade -y

# 3. Instalar Dependencias Base
echo -e "${GREEN}[2/7] Instalando dependencias del sistema (Puppeteer Ready)...${NC}"
DEPENDENCIES="git python3 make g++ curl openssh-client libgbm-dev libnss3 \
libatk-bridge2.0-0 libgtk-3-0 libasound2 libxss1 libpangocairo-1.0-0 \
libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 libxi6 libxtst6 \
libcups2 libxrandr2 libpango-1.0-0 libatk1.0-0 libfontconfig1 wget jq"

apt install -y $DEPENDENCIES

# 4. Instalar Node.js via NVM
echo -e "${GREEN}[3/7] Configurando Node.js (v20)...${NC}"
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
echo -e "${GREEN}[4/7] Configurando el proyecto Agent-assist...${NC}"
# Asumimos que el script se ejecuta dentro de la carpeta clonada
if [ ! -f "package.json" ]; then
  echo -e "${RED}Error: package.json no encontrado. Debes ejecutar este script desde la raíz del proyecto.${NC}"
  exit 1
fi

npm install

# 6. Asistente de Configuración Interactiva
echo -e "${BLUE}##################################################${NC}"
echo -e "${BLUE}#           ASISTENTE DE CONFIGURACIÓN           #${NC}"
echo -e "${BLUE}##################################################${NC}"

if [ ! -f ".env" ]; then
    cp .env.example .env
fi

read -p "Introduce tu OpenRouter/LLM API Key: " API_KEY
read -p "Nombre del Agente [Horus]: " AGENT_NAME
AGENT_NAME=${AGENT_NAME:-Horus}
read -p "Puerto del servidor [3000]: " PORT
PORT=${PORT:-3000}

# Actualizar .env (usando sed de forma segura)
sed -i "s|OPENROUTER_API_KEY=.*|OPENROUTER_API_KEY=$API_KEY|" .env
sed -i "s|PORT=.*|PORT=$PORT|" .env
# Añadir nombre si no existe o actualizar
if grep -q "AGENT_NAME" .env; then
    sed -i "s|AGENT_NAME=.*|AGENT_NAME=$AGENT_NAME|" .env
else
    echo "AGENT_NAME=$AGENT_NAME" >> .env
fi

echo -e "${GREEN}Configuración básica guardada en .env${NC}"

# 7. Preparar Horus CLI + Doctor
echo -e "${GREEN}[5/7] Creando Horus CLI & Doctor...${NC}"
cat << 'EOF' > /usr/local/bin/horus
#!/bin/bash
GREEN='\033[0-32m'
BLUE='\033[0-34m'
RED='\033[0-31m'
YELLOW='\033[1-33m'
NC='\033[0m'

case "$1" in
  logs)
    pm2 logs horus
    ;;
  restart)
    pm2 restart horus
    ;;
  status)
    pm2 status horus
    ;;
  stop)
    pm2 stop horus
    ;;
  doctor)
    echo -e "${BLUE}=== Horus System Doctor ===${NC}"
    
    # Check Node
    NODE_V=$(node -v 2>/dev/null || echo "No instalado")
    echo -n "Node.js: "
    if [[ $NODE_V == v20* ]] || [[ $NODE_V == v22* ]]; then
        echo -e "${GREEN}$NODE_V (OK)${NC}"
    else
        echo -e "${RED}$NODE_V (Incompatible - se requiere v20+)${NC}"
    fi

    # Check dependencies
    echo -n "Librerías Puppeteer: "
    MISSING_LIBS=""
    for lib in libgbm1 libnss3 libatk-bridge2.0-0 libgtk-3-0 libasound2; do
        if ! dpkg -l | grep -q $lib; then
            MISSING_LIBS="$MISSING_LIBS $lib"
        fi
    done
    if [ -z "$MISSING_LIBS" ]; then
        echo -e "${GREEN}Presentes (OK)${NC}"
    else
        echo -e "${YELLOW}Faltan: $MISSING_LIBS${NC}"
        echo -e "${BLUE}Ejecutando autofix...${NC}"
        sudo apt update && sudo apt install -y libgbm-dev libnss3 libatk-bridge2.0-0 libgtk-3-0 libasound2
    fi

    # Check PM2
    echo -n "Proceso PM2: "
    if pm2 status horus | grep -q "online"; then
        echo -e "${GREEN}Online (OK)${NC}"
    else
        echo -e "${RED}Offline${NC}"
        echo -e "${BLUE}Intentando reiniciar...${NC}"
        pm2 restart horus || pm2 start dist/index.js --name horus
    fi

    # Check Env
    echo -n "Archivo .env: "
    if [ -f ".env" ]; then
        echo -e "${GREEN}Presente (OK)${NC}"
    else
        echo -e "${RED}No encontrado${NC}"
    fi
    ;;
  *)
    echo -e "${BLUE}Comandos de Horus:${NC}"
    echo "  horus status  - Ver estado del proceso"
    echo "  horus logs    - Ver logs en tiempo real"
    echo "  horus restart - Reiniciar el agente"
    echo "  horus stop    - Detener el agente"
    echo "  horus doctor  - Diagnosticar y reparar el sistema"
    ;;
esac
EOF
chmod +x /usr/local/bin/horus

# 8. Iniciar con PM2
echo -e "${GREEN}[6/7] Compilando e Iniciando Agente...${NC}"
npm install -g pm2
npm run build
pm2 start dist/index.js --name horus || pm2 restart horus
pm2 save
pm2 startup | bash || true

# 9. Finalización
echo -e "${BLUE}##################################################${NC}"
echo -e "${GREEN}   ¡HORUS AGENTASSIST INSTALADO CORRECTAMENTE!   ${NC}"
echo -e "${BLUE}##################################################${NC}"
echo -e "Acceso Web: http://$(hostname -I | awk '{print $1}'):$PORT"
echo -e "Comando Maestro: ${GREEN}horus${NC}"
echo -e "Para diagnosticar en el futuro: ${GREEN}horus doctor${NC}"
echo -e "${BLUE}##################################################${NC}"
