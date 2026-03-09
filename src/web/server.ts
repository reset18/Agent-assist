import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import { getSetting, setSetting, isToolEnabled, setToolEnabled, clearMessages, getSessions, createSession } from '../db/index.js';
import { whatsappGlobalState } from '../bots/whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// API Config
app.get('/api/settings', (req, res) => {
    const provider = getSetting('model_provider') || process.env.LLM_PROVIDER || 'openrouter';
    let apiKey = getSetting('llm_api_key') || '';

    // Si no hay API Key en la DB, intentamos cargar de los .env como fallback
    if (!apiKey || apiKey === 'SUTITUYE POR EL TUYO') {
        const envKeyMap: any = {
            openrouter: 'OPENROUTER_API_KEY',
            groq: 'GROQ_API_KEY',
            openai: 'OPENAI_API_KEY',
            anthropic: 'ANTHROPIC_API_KEY',
            google: 'GEMINI_API_KEY'
        };
        const envKeyName = envKeyMap[provider];
        if (envKeyName) {
            apiKey = process.env[envKeyName] || '';
        }

        if (apiKey === 'SUTITUYE POR EL TUYO') apiKey = '';
    }

    res.json({
        agent_name: getSetting('agent_name') || '',
        user_name: getSetting('user_name') || '',
        agent_personality: getSetting('agent_personality') || '',
        agent_function: getSetting('agent_function') || '',
        model_provider: provider,
        model_name: getSetting('model_name') || process.env.MODEL_NAME || (provider === 'openai' ? 'gpt-4o-mini' : 'openrouter/free'),
        llm_api_key: apiKey,
        telegram_bot_token: process.env.TELEGRAM_BOT_TOKEN === 'SUTITUYE POR EL TUYO' ? '' : (process.env.TELEGRAM_BOT_TOKEN || ''),
        telegram_whitelist: process.env.TELEGRAM_ALLOWED_USER_IDS === 'SUTITUYE POR EL TUYO' ? '' : (process.env.TELEGRAM_ALLOWED_USER_IDS || ''),
        tool_get_current_time: isToolEnabled('get_current_time'),
        tool_read_file_local: isToolEnabled('read_file_local'),
        tool_write_file_local: isToolEnabled('write_file_local'),
        tool_list_dir_local: isToolEnabled('list_dir_local'),
        tool_run_shell_local: isToolEnabled('run_shell_local'),
        tool_run_ssh_command: isToolEnabled('run_ssh_command'),
        bot_telegram_enabled: getSetting('bot_telegram_enabled') === '1' || (getSetting('bot_telegram_enabled') == null && !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'SUTITUYE POR EL TUYO')),
        bot_whatsapp_enabled: getSetting('bot_whatsapp_enabled') === '1',
        gog_client_secret: getSetting('gog_client_secret') || '',
        gog_email: getSetting('gog_email') || '',
        elevenlabs_enabled: getSetting('elevenlabs_enabled') === '1', // Legacy check
        voice_enabled: getSetting('voice_enabled') === '1',
        voice_engine: getSetting('voice_engine') || 'openai',
        openai_voice_id: getSetting('openai_voice_id') || 'alloy',
        elevenlabs_api_key: getSetting('elevenlabs_api_key') || '',
        elevenlabs_voice_id: getSetting('elevenlabs_voice_id') || ''
    });
});

app.get('/api/whatsapp/status', (req, res) => {
    res.json(whatsappGlobalState);
});

app.get('/api/status', (req, res) => {
    const port = process.env.PORT || '3005';
    const tgEnabled = getSetting('bot_telegram_enabled') !== '0';
    const waEnabled = getSetting('bot_whatsapp_enabled') === '1';

    res.json({
        server: {
            status: 'online',
            port: port,
            url: `http://localhost:${port}`
        },
        whatsapp: {
            enabled: waEnabled,
            status: whatsappGlobalState.status
        },
        telegram: {
            enabled: tgEnabled,
            status: 'online' // Si el servidor corre, el bot de Telegram (polling) debería estar activo si está enabled
        },
        llm: {
            provider: getSetting('model_provider') || process.env.LLM_PROVIDER || 'openrouter',
            model: getSetting('model_name') || process.env.MODEL_NAME || 'n/a'
        }
    });
});

function updateEnv(key: string, value: string) {
    if (!value) return;
    process.env[key] = value;
    const envPath = join(process.cwd(), '.env');
    let content = '';
    if (fs.existsSync(envPath)) {
        content = fs.readFileSync(envPath, 'utf8');
    }

    // Solo si el usuario envía valor real, actualiza.
    const regex = new RegExp(`^${key}=.*`, 'm');
    if (regex.test(content)) {
        content = content.replace(regex, `${key}="${value}"`);
    } else {
        content += `\n${key}="${value}"`;
    }
    fs.writeFileSync(envPath, content.trim() + '\n');
}

app.post('/api/settings', (req, res) => {
    console.log(`[Web] Recibida actualización de ajustes:`, JSON.stringify({
        ...req.body,
        llm_api_key: req.body.llm_api_key ? 'RECIBIDA (' + req.body.llm_api_key.substring(0, 5) + '...)' : 'VACÍA',
        elevenlabs_api_key: req.body.elevenlabs_api_key ? 'RECIBIDA' : 'VACÍA'
    }));

    const {
        agent_name, user_name, agent_personality, agent_function,
        model_provider, model_name, llm_api_key,
        telegram_bot_token, telegram_whitelist,
        tool_get_current_time, tool_read_file_local, tool_write_file_local, tool_list_dir_local, tool_run_shell_local, tool_run_ssh_command,
        bot_telegram_enabled, bot_whatsapp_enabled,
        gog_client_secret, gog_email,
        voice_enabled, voice_engine, openai_voice_id,
        elevenlabs_api_key, elevenlabs_voice_id
    } = req.body;

    // Guardar dinámicamente cualquier skill enviada
    for (const key of Object.keys(req.body)) {
        if (key.startsWith('skill_enabled_')) {
            setSetting(key, req.body[key] ? '1' : '0');
        }
    }

    if (agent_name) {
        setSetting('agent_name', agent_name);
        setSetting('agent_setup_done', '1');
    }
    if (user_name) setSetting('user_name', user_name);
    if (agent_personality) setSetting('agent_personality', agent_personality);
    if (agent_function) setSetting('agent_function', agent_function);
    if (model_provider) setSetting('model_provider', model_provider);
    if (model_name) setSetting('model_name', model_name);

    if (llm_api_key && llm_api_key.trim() !== '') {
        setSetting('llm_api_key', llm_api_key);
        const providerToUse = model_provider || getSetting('model_provider') || 'openrouter';

        if (providerToUse === 'openrouter') { updateEnv('OPENROUTER_API_KEY', llm_api_key); process.env.OPENROUTER_API_KEY = llm_api_key; }
        if (providerToUse === 'groq') { updateEnv('GROQ_API_KEY', llm_api_key); process.env.GROQ_API_KEY = llm_api_key; }
        if (providerToUse === 'openai') { updateEnv('OPENAI_API_KEY', llm_api_key); process.env.OPENAI_API_KEY = llm_api_key; }
        if (providerToUse === 'anthropic') { updateEnv('ANTHROPIC_API_KEY', llm_api_key); process.env.ANTHROPIC_API_KEY = llm_api_key; }
        if (providerToUse === 'google') { updateEnv('GEMINI_API_KEY', llm_api_key); process.env.GEMINI_API_KEY = llm_api_key; }
    }

    if (telegram_bot_token !== undefined) updateEnv('TELEGRAM_BOT_TOKEN', telegram_bot_token);
    if (telegram_whitelist !== undefined) updateEnv('TELEGRAM_ALLOWED_USER_IDS', telegram_whitelist);

    if (typeof tool_get_current_time === 'boolean') setToolEnabled('get_current_time', tool_get_current_time);
    if (typeof tool_read_file_local === 'boolean') setToolEnabled('read_file_local', tool_read_file_local);
    if (typeof tool_write_file_local === 'boolean') setToolEnabled('write_file_local', tool_write_file_local);
    if (typeof tool_list_dir_local === 'boolean') setToolEnabled('list_dir_local', tool_list_dir_local);
    if (typeof tool_run_shell_local === 'boolean') setToolEnabled('run_shell_local', tool_run_shell_local);
    if (typeof tool_run_ssh_command === 'boolean') setToolEnabled('run_ssh_command', tool_run_ssh_command);

    if (gog_client_secret !== undefined) setSetting('gog_client_secret', gog_client_secret);
    if (gog_email !== undefined) setSetting('gog_email', gog_email);

    if (bot_telegram_enabled !== undefined) setSetting('bot_telegram_enabled', bot_telegram_enabled ? '1' : '0');
    if (bot_whatsapp_enabled !== undefined) setSetting('bot_whatsapp_enabled', bot_whatsapp_enabled ? '1' : '0');

    if (voice_enabled !== undefined) setSetting('voice_enabled', voice_enabled ? '1' : '0');
    if (voice_engine !== undefined) setSetting('voice_engine', voice_engine);
    if (openai_voice_id !== undefined) setSetting('openai_voice_id', openai_voice_id);
    if (elevenlabs_api_key !== undefined) setSetting('elevenlabs_api_key', elevenlabs_api_key);
    if (elevenlabs_voice_id !== undefined) setSetting('elevenlabs_voice_id', elevenlabs_voice_id);

    res.json({ success: true });
});

app.post('/api/models', async (req, res) => {
    const { provider, apiKey } = req.body;
    let token = apiKey;

    if (!token || token.trim() === '') {
        if (provider === 'openrouter') token = getSetting('llm_api_key') || process.env.OPENROUTER_API_KEY;
        if (provider === 'groq') token = getSetting('llm_api_key') || process.env.GROQ_API_KEY;
        if (provider === 'openai') token = getSetting('llm_api_key') || process.env.OPENAI_API_KEY;
        if (provider === 'anthropic') token = getSetting('llm_api_key') || process.env.ANTHROPIC_API_KEY;
        if (provider === 'google') token = getSetting('llm_api_key') || process.env.GEMINI_API_KEY;
    }

    if (provider === 'anthropic') {
        return res.json({
            models: [
                { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (Latest)' },
                { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Fast)' },
                { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus (Powerful)' }
            ]
        });
    }

    if (provider === 'google') {
        return res.json({
            models: [
                { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Recommended)' },
                { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
                { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash Exp' },
                { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }
            ]
        });
    }

    let url = '';
    if (provider === 'openrouter') url = 'https://openrouter.ai/api/v1/models';
    if (provider === 'groq') url = 'https://api.groq.com/openai/v1/models';
    if (provider === 'openai') url = 'https://api.openai.com/v1/models';

    try {
        const headers: any = {};
        if (token && token !== 'SUTITUYE POR EL TUYO') {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(url, { headers });
        if (!response.ok) {
            return res.status(response.status).json({ error: `El proveedor rechazó la conexión (${response.status}). ¿API Key válida?` });
        }

        const data = await response.json();
        const modelList = data.data || [];

        // Formatear para enviar solo ID y Nombre
        const formatted = modelList.map((m: any) => ({
            id: m.id,
            name: m.name || m.id
        }));

        res.json({ models: formatted });
    } catch (e: any) {
        res.status(500).json({ error: 'Error de red contactando al proveedor de IA.' });
    }
});

app.get('/api/skills', (req, res) => {
    try {
        const mcpPath = join(process.cwd(), 'MCP');
        if (!fs.existsSync(mcpPath)) {
            return res.json({ skills: [] });
        }

        const files = fs.readdirSync(mcpPath).filter(f => f.endsWith('.zip'));
        const skills: any[] = [];

        const getEmoji = (name: string) => {
            const n = name.toLowerCase();
            if (n.includes('secure') || n.includes('auditor') || n.includes('tls') || n.includes('ssh')) return '🛡️';
            if (n.includes('scrap') || n.includes('browser') || n.includes('crawl')) return '🕸️';
            if (n.includes('mail') || n.includes('gmail')) return '📧';
            if (n.includes('voice') || n.includes('speak') || n.includes('tts')) return '🎙️';
            if (n.includes('learn') || n.includes('reflex')) return '🧠';
            if (n.includes('dev') || n.includes('code') || n.includes('program')) return '💻';
            if (n.includes('file') || n.includes('dir')) return '📂';
            if (n.includes('calc') || n.includes('math')) return '📊';
            if (n.includes('time') || n.includes('day')) return '📅';
            return '⚡';
        };

        for (const file of files) {
            try {
                const zipPath = join(mcpPath, file);
                const zip = new AdmZip(zipPath);
                const skillEntry = zip.getEntry('SKILL.md');

                if (skillEntry) {
                    const content = skillEntry.getData().toString('utf8');
                    // Parse YAML frontmatter simple
                    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
                    let name = file.replace('.zip', '');
                    let description = 'Habilidad sin descripción.';

                    if (match) {
                        const parsed = match[1];
                        const nameMatch = parsed.match(/name:\s*(.+)/);
                        const descMatch = parsed.match(/description:\s*(.+)/);
                        if (nameMatch) name = nameMatch[1].trim();
                        if (descMatch) description = descMatch[1].trim();
                    }

                    // Forzar traducción manual de Skills habituales
                    const esTrads: any = {
                        'agent-development.zip': { n: 'Desarrollo del Agente', d: 'Conocimiento experto del proyecto base. Útil para modificar iterativamente el código del Agente.' },
                        'browser-use.zip': { n: 'Navegación Web Interactiva', d: 'Otorga habilidades completas para crear y controlar un sub-agente navegador que haga tareas en webs públicas e interactue con UI.' },
                        'command-development.zip': { n: 'Desarrollo de Comandos', d: 'Mejores prácticas para generar flujos de comandos robustos y seguros en Windows/Linux.' },
                        'gog.zip': { n: 'Integración Google (GOG)', d: 'Provee acceso OAuth a Google Cloud para leer, enviar y resumir correos de Gmail.' },
                        'integrations.zip': { n: 'Integraciones del Sistema', d: 'Documentación para interactuar con integraciones de Home Assistant y dispositivos externos.' },
                        'skill-lookup.zip': { n: 'Analizador de Habilidades', d: 'Permite leer y auto-aprender directrices de habilidades sin colapsar la memoria principal.' }
                    };



                    if (esTrads[file]) {
                        name = esTrads[file].n;
                        description = esTrads[file].d;
                    }

                    const enabled = getSetting(`skill_enabled_${file}`) === '1';
                    const emoji = getEmoji(name);
                    skills.push({ id: file, name, description, enabled, emoji });
                }
            } catch (err) {
                console.error(`[Skills] Error procesando archivo ZIP ${file}:`, err);
            }
        }

        res.json({ skills });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

import { processUserMessage } from '../agent/loop.js';
import { getRecentMessages } from '../db/index.js';

app.post('/api/clear-memory', (req, res) => {
    const { sessionId } = req.body;
    clearMessages(sessionId);
    res.json({ success: true });
});

app.get('/api/sessions', (req, res) => {
    try {
        const sessions = getSessions();
        res.json({ sessions });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/sessions', (req, res) => {
    const { id, name, platform } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'ID o Nombre faltante' });
    try {
        createSession(id, name, platform || 'web');
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/chat-history', (req, res) => {
    const { sessionId } = req.query;
    try {
        const messages = getRecentMessages(50, sessionId as string || 'default');
        res.json({ messages });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/chat', async (req, res) => {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensaje vacío' });
    try {
        const reply = await processUserMessage('web_user', 'web', message, false, sessionId || 'default');
        res.json({ reply });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export function startWebServer() {
    const port = parseInt(process.env.PORT || '3005', 10);
    const host = process.env.HOST || '0.0.0.0';

    app.listen(port, host, () => {
        console.log(`[Web] Interfaz de configuración disponible en http://${host}:${port}`);
        console.log(`[Web] Accesible desde tu red local.`);
    });
}
