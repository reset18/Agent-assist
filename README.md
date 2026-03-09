# Agent-Assist Core

![Agent-Assist Logo](https://via.placeholder.com/150x150.png?text=Agent-Assist)

Un Agente IA autónomo, premium y multi-plataforma diseñado para centralizar tus flujos de trabajo con capacidades de auto-aprendizaje, gestión de archivos y herramientas de automatización.

## 🚀 Características Principales

- **Multi-plataforma**: Conexión nativa con Telegram, WhatsApp y Web.
- **Identificación de Sesiones**: Identifica el origen de tus chats y continúa conversaciones cruzadas sin problemas.
- **Habilidades Autónomas (MCP)**: Capacidad para ejecutar código, leer/escribir archivos locales, gestionar servidores Proxmox vía SSH, y más.
- **Auto-aprendizaje**: Motor de autonomía que permite al agente crear y documentar sus propias herramientas.
- **Interfaz Premium**: Diseño visual de alta fidelidad con soporte para temas claro/oscuro, centrado en la usabilidad.
- **Voz Nativa**: Integración con OpenAI TTS y ElevenLabs para interacciones audibles y transcripción de notas de voz.

## 🛠️ Requisitos

- **Node.js**: v20 o superior.
- **SQLite**: Incluido (usa `better-sqlite3`).
- **API Keys**: Necesitarás al menos una de las siguientes: OpenRouter (recomendado), Groq, OpenAI, Anthropic o Google Gemini.

## 📦 Instalación

### 🚀 Instalación en 1 solo paso (Recomendado)
Para un despliegue limpio y profesional (borra instalaciones previas y limpia procesos bloqueados):

```bash
sudo pm2 stop agent-assist || true; sudo pkill -9 node || true; cd ..; sudo rm -rf Agent-assist; git clone https://github.com/reset18/Agent-assist.git && cd Agent-assist && sudo bash setup.sh
```
*Este comando hará TODO por ti: instalar dependencias, configurar tu IA, vincular tu WhatsApp/Telegram y encender el servidor en el puerto **3005**.*

#### 🛠️ Agent-Assist CLI (Gestión Pro)
Una vez instalado, gestiona tu agente con comandos globales:
- `agent-assist status` - Ver si el agente está vivo.
- `agent-assist logs` - Ver lo que está pensando el agente en tiempo real.
- `agent-assist restart` - Reiniciar el sistema.
- `agent-assist doctor` - Diagnóstico y auto-reparación.
- `agent-assist uninstall` - Desinstalación limpia.

### Método 2: Manual / Docker
1. **Clonar el repositorio**:
   ```bash
   git clone https://github.com/reset18/Agent-assist.git
   cd Agent-assist
   ```
2. **Docker**:
   ```bash
   docker-compose up -d
   ```
3. **Manual**:
   ```bash
   npm install
   npm run build
   npm start
   ```

## 🔐 Seguridad y Privacidad

- **Zero-Cloud**: Los datos de tus sesiones y configuraciones se guardan localmente en `memory.db`.
- **Exclusiones**: El archivo `.gitignore` previene la subida accidental de tus API Keys y bases de datos.

---

Desarrollado con ❤️ para la automatización total.
