import 'dotenv/config';
import fs from 'fs';
import { initDb, getSetting, setSetting } from './db/index.js';
import { startWebServer } from './web/server.js';
import { startTelegramBot } from './bots/telegram.js';
import { startWhatsappBot } from './bots/whatsapp.js';
import { initMCPClient } from './mcp/client.js';

async function main() {
    console.log('🤖 Iniciando AgentAssist...');

    // 1. Inicializar base de datos
    initDb();
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    setSetting('agent_version', pkg.version);
    const agentName = getSetting('agent_name');
    console.log(`[Core] Nombre del agente: ${agentName}`);

    // 2. Iniciar servidor web local
    startWebServer();

    // 2.5 Iniciar Servidores y Clientes MCP externos
    await initMCPClient();

    // 3. Iniciar bots
    try {
        if (getSetting('bot_telegram_enabled') !== '0') {
            await startTelegramBot();
        } else {
            console.log('[Core] Bot de Telegram deshabilitado en ajustes.');
        }
    } catch (error) {
        console.error('[Core] Error al iniciar el bot de Telegram:', error);
    }

    try {
        if (getSetting('bot_whatsapp_enabled') !== '0') {
            await startWhatsappBot();
        } else {
            console.log('[Core] Bot de WhatsApp deshabilitado en ajustes.');
        }
    } catch (error) {
        console.error('[Core] Error al iniciar el bot de WhatsApp:', error);
    }

    console.log('✅ AgentAssist está corriendo y listo para interactuar.');
}

main().catch(console.error);
