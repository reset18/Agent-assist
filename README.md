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

### Método 1: Máquina Virtual Linux (Recomendado)
Como tu repositorio es **Privado**, el comando directo `wget` no funcionará. Usa este proceso de 2 pasos:

1. **Clona el repositorio** usando tu Token:
   ```bash
   git clone https://reset18:TU_TOKEN_AQUI@github.com/reset18/Agent-assist.git
   cd Agent-assist
   ```
2. **Ejecuta el instalador** localmente:
   ```bash
   sudo bash setup.sh
   ```
*Este comando instalará Node.js, todas las dependencias de WhatsApp (Puppeteer), ejecutará el asistente y configurará Agent-Assist con PM2.*

#### 🛠️ Agent-Assist CLI (Gestión del Agente)
Una vez instalado, puedes usar el comando `agent-assist` para gestionar todo el sistema:
- `agent-assist status` - Ver el estado actual del agente.
- `agent-assist logs` - Ver logs en tiempo real.
- `agent-assist restart` - Reiniciar el servicio.
- `agent-assist doctor` - **Novedad**: Diagnostica automáticamente problemas de dependencias, Node.js o red, y ofrece autofix.

### Método 2: Manual / Docker
...
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
