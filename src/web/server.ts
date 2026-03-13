import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { getSetting, setSetting, getLLMAccounts, saveLLMAccount, removeLLMAccount, isToolEnabled, setToolEnabled, clearMessages, getSessions, createSession, deleteSession, getTokenUsageHistory, getToolRuntimeMetricsHistory } from '../db/index.js';
import { whatsappGlobalState } from '../bots/whatsapp.js';
import { getToolRuntimeDiagnostics } from '../agent/loop.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html') || filePath.endsWith('auth.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

function sanitizeChatOutput(text: string) {
    if (!text) return text;
    let out = String(text);
    out = out.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '').trim();
    out = out.replace(/#\s*Plan Mode\s*-\s*System Reminder[\s\S]*$/gi, '').trim();
    out = out.replace(/CRITICAL:\s*Plan mode ACTIVE[\s\S]*$/gi, '').trim();
    out = out.replace(/\{\s*"command"\s*:\s*"[\s\S]*?\}\s*$/gi, '').trim();
    out = out.replace(/```(?:bash|sh|shell|json)?[\s\S]*?(?:ip route|getent|awk|python3|bash -lc)[\s\S]*?```/gi, '').trim();
    return out;
}

// Cache-busting: Asegurar que index.html no se guarde en caché para que las actualizaciones sean inmediatas
app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(join(__dirname, 'public', 'index.html'));
});

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
        openai_tts_model: getSetting('openai_tts_model') || 'auto',
        openai_tts_unavailable_until: getSetting('openai_tts_unavailable_until') || '0',
        openai_api_key_audio: getSetting('openai_api_key_audio') || process.env.OPENAI_API_KEY || '',
        piper_bin_path: getSetting('piper_bin_path') || '',
        piper_model_path: getSetting('piper_model_path') || '',
        piper_speaker: getSetting('piper_speaker') || '',
        piper_speed: getSetting('piper_speed') || '',
        elevenlabs_api_key: getSetting('elevenlabs_api_key') || '',
        elevenlabs_voice_id: getSetting('elevenlabs_voice_id') || '',

        // Multi-tier & Multi-account
        llm_accounts: getLLMAccounts(),
        llm_primary_account_id: getSetting('llm_primary_account_id') || '',
        llm_secondary_account_id: getSetting('llm_secondary_account_id') || '',
        llm_tertiary_account_id: getSetting('llm_tertiary_account_id') || '',
        llm_primary_model: getSetting('llm_primary_model') || '',
        llm_secondary_model: getSetting('llm_secondary_model') || '',
        llm_tertiary_model: getSetting('llm_tertiary_model') || '',
        llm_relay_hopping_enabled: getSetting('llm_relay_hopping_enabled') !== '0',
        codex_store_enabled: getSetting('codex_store_enabled') !== '0',
        codex_compaction_enabled: getSetting('codex_compaction_enabled') !== '0',
        codex_compact_threshold: getSetting('codex_compact_threshold') || '80000',
        ui_show_thinking: getSetting('ui_show_thinking') === '1',
        tool_hooks_enabled: getSetting('tool_hooks_enabled') !== '0',
        tool_hooks_strict_mode: getSetting('tool_hooks_strict_mode') !== '0',
        tool_loop_warning_threshold: getSetting('tool_loop_warning_threshold') || '6',
        tool_loop_critical_threshold: getSetting('tool_loop_critical_threshold') || '12',
        tool_loop_global_threshold: getSetting('tool_loop_global_threshold') || '40',
    });
});

const SUPPORTED_PROVIDERS = new Set(['openai', 'anthropic', 'google', 'openrouter', 'groq', 'qwen', 'xai']);

app.post('/api/accounts/add', (req, res) => {
    try {
        const { provider, name, apiKey, model } = req.body;
        if (!provider || !name || !apiKey) {
            return res.status(400).json({ success: false, error: 'Faltan campos' });
        }
        if (!SUPPORTED_PROVIDERS.has(provider)) {
            return res.status(400).json({ success: false, error: 'Proveedor no soportado actualmente' });
        }

        const id = 'acc_' + crypto.randomBytes(6).toString('hex');
        saveLLMAccount({
            id,
            provider,
            name,
            apiKey,
            isOauth: false,
            refreshToken: null,
            model: model || ''
        });

        // Auto-set como primaria si es la primera cuenta
        if (!getSetting('llm_primary_account_id')) {
            setSetting('llm_primary_account_id', id);
            if (model) setSetting('llm_primary_model', model);
        }

        res.json({ success: true, id });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/accounts/remove', (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: 'Falta ID' });

        removeLLMAccount(id);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/accounts/update-model', (req, res) => {
    try {
        const { id, model } = req.body;
        if (!id || !model) return res.status(400).json({ success: false, error: 'Falta ID o modelo' });

        const accounts = getLLMAccounts();
        const acc = accounts.find((a: any) => a.id === id);
        if (!acc) return res.status(404).json({ success: false, error: 'Cuenta no encontrada' });

        acc.model = model;
        saveLLMAccount(acc);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Endpoint para probar una API Key antes de guardarla
app.post('/api/test-llm', async (req, res) => {
    const { provider, apiKey, model } = req.body;
    if (!apiKey) return res.status(400).json({ success: false, error: 'API Key requerida' });

    try {
        const { chatCompletion } = await import('../agent/llm.js');
        // Prueba mínima: un mensaje de 1 token para validar
        // IMPORTANTE: forzar el test contra ESTA credencial (sin fallback multi-tier)
        await chatCompletion(model || 'gpt-4o-mini', provider, [{ role: 'user', content: 'test connection' }], [], apiKey);
        res.json({ success: true });
    } catch (error: any) {
        res.status(401).json({ success: false, error: error.message });
    }
});

// Endpoint para listar modelos disponibles de un proveedor
app.post('/api/models', async (req, res) => {
    const { provider, apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ success: false, error: 'API Key requerida' });

    try {
        const baseURLs: Record<string, string> = {
            openai: 'https://api.openai.com/v1',
            openrouter: 'https://openrouter.ai/api/v1',
            groq: 'https://api.groq.com/openai/v1',
            google: 'https://generativelanguage.googleapis.com/v1beta/openai',
            qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            xai: 'https://api.x.ai/v1'
        };

        if (provider === 'anthropic') {
            // Anthropic no tiene endpoint de modelos — devolver lista estática
            return res.json({
                models: [
                    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
                    { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet' },
                    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
                    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' }
                ]
            });
        }

        const baseURL = baseURLs[provider];
        if (!baseURL) {
            return res.status(400).json({ success: false, error: 'Proveedor no soportado: ' + provider });
        }

        const modelsRes = await fetch(`${baseURL}/models`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (!modelsRes.ok) {
            const errText = await modelsRes.text();
            return res.status(modelsRes.status).json({ success: false, error: 'Error del proveedor: ' + errText });
        }

        const data: any = await modelsRes.json();
        const models = (data.data || [])
            .map((m: any) => ({ id: m.id, name: m.id }))
            .sort((a: any, b: any) => a.id.localeCompare(b.id));

        res.json({ models });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint para "Login" sincronizado con CLI o Web
app.post('/api/verify-llm', async (req, res) => {
    const { provider, apiKey, model } = req.body;
    if (!apiKey) return res.status(400).json({ success: false, error: 'API Key requerida' });

    try {
        const { chatCompletion } = await import('../agent/llm.js');
        await chatCompletion(model || 'gpt-4o-mini', provider, [{ role: 'user', content: 'verify login' }], [], apiKey);

        // Guardar en DB
        setSetting('model_provider', provider);
        setSetting('llm_api_key', apiKey);
        if (model) setSetting('model_name', model);

        // Sincronizar con .env para el instalador
        updateEnv('LLM_PROVIDER', provider);
        const keyMap: any = {
            openrouter: 'OPENROUTER_API_KEY',
            groq: 'GROQ_API_KEY',
            openai: 'OPENAI_API_KEY',
            anthropic: 'ANTHROPIC_API_KEY',
            google: 'GEMINI_API_KEY'
        };
        if (keyMap[provider]) updateEnv(keyMap[provider], apiKey);
        if (model) updateEnv('MODEL_NAME', model);

        res.json({ success: true });
    } catch (error: any) {
        res.status(401).json({ success: false, error: error.message });
    }
});

// --- Integración ChatGPT OAuth (paste-URL approach, como OpenClaw) ---

let currentCodeVerifier: string = '';
const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OAUTH_REDIRECT_URI = 'http://localhost:1455/auth/callback'; // Registrado en OpenAI

function generatePKCE() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
}

// Paso 1: Generar la URL de autorización
app.get('/api/auth/:provider/start', (req, res) => {
    const { provider } = req.params;
    try {
        const { verifier, challenge } = generatePKCE();
        currentCodeVerifier = verifier;
        const stateStr = crypto.randomBytes(16).toString('hex');

        const authUrl = `https://auth.openai.com/oauth/authorize?response_type=code&client_id=${OAUTH_CLIENT_ID}&redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}&scope=openid+profile+email+offline_access&code_challenge=${challenge}&code_challenge_method=S256&state=${stateStr}&id_token_add_organizations=true&codex_cli_simplified_flow=true&originator=pi&prompt=login`;

        console.log(`[OAuth] Auth URL generada. redirect_uri: ${OAUTH_REDIRECT_URI}`);
        res.json({ success: true, url: authUrl });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Paso 2: Recibir la URL pegada por el usuario, extraer code, canjear por token
app.post('/api/auth/:provider/exchange', async (req, res) => {
    const { provider } = req.params;
    try {
        const { callbackUrl, accountName } = req.body;
        if (!callbackUrl) {
            return res.status(400).json({ success: false, error: 'Falta la URL de callback' });
        }

        // Extraer el code del URL
        const urlObj = new URL(callbackUrl);
        const code = urlObj.searchParams.get('code');
        if (!code) {
            return res.status(400).json({ success: false, error: 'No se encontró el parámetro "code" en la URL' });
        }

        console.log("[OAuth Exchange] Code:", code.substring(0, 15) + "...");
        console.log("[OAuth Exchange] Verifier:", currentCodeVerifier.substring(0, 15) + "...");

        const bodyParams = new URLSearchParams();
        bodyParams.append('grant_type', 'authorization_code');
        bodyParams.append('client_id', OAUTH_CLIENT_ID);
        bodyParams.append('code', code);
        bodyParams.append('redirect_uri', OAUTH_REDIRECT_URI);
        bodyParams.append('code_verifier', currentCodeVerifier);

        const tokenRes = await fetch('https://auth.openai.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: bodyParams
        });

        console.log("[OAuth Exchange] Token Response Status:", tokenRes.status);

        if (!tokenRes.ok) {
            const err = await tokenRes.text();
            console.error("[OAuth Exchange] Error canjeando token:", err);
            return res.status(400).json({ success: false, error: 'Error canjeando token con OpenAI: ' + err });
        }

        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;
        const refreshToken = tokenData.refresh_token;

        console.log("[OAuth Exchange] Tokens recibidos correctamente!");

        // Guardar como cuenta
        const accountId = 'oa_' + crypto.randomBytes(6).toString('hex');
        const finalAccountName = accountName || ('ChatGPT Web (' + new Date().toLocaleDateString() + ')');
        saveLLMAccount({
            id: accountId,
            provider: provider === 'chatgpt' ? 'openai' : provider,
            name: finalAccountName,
            apiKey: accessToken,
            isOauth: true,
            refreshToken: refreshToken || null,
            model: 'auto'
        });

        // Auto-set como primaria si no hay ninguna
        if (!getSetting('llm_primary_account_id')) {
            setSetting('llm_primary_account_id', accountId);
            setSetting('llm_primary_model', 'auto');
        }

        // Legado
        setSetting('model_provider', 'openai');
        setSetting('llm_api_key', accessToken);
        setSetting('model_name', 'gpt-4o');
        if (refreshToken) setSetting('chatgpt_refresh_token', refreshToken);

        updateEnv('LLM_PROVIDER', 'openai');
        updateEnv('OPENAI_API_KEY', accessToken);

        res.json({ success: true, accountId });
    } catch (e: any) {
        console.error("[OAuth Exchange] Excepción:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/auth-provider', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'auth.html'));
});

app.get('/api/check-update', async (req, res) => {
    const normalizeVersion = (v: string) => String(v || '').trim().replace(/^v/, '');
    const isRemoteNewer = (remote: string, current: string) => {
        const r = normalizeVersion(remote).split('.').map((n) => parseInt(n, 10) || 0);
        const c = normalizeVersion(current).split('.').map((n) => parseInt(n, 10) || 0);
        const len = Math.max(r.length, c.length);
        for (let i = 0; i < len; i++) {
            const rv = r[i] || 0;
            const cv = c[i] || 0;
            if (rv > cv) return true;
            if (rv < cv) return false;
        }
        return false;
    };

    try {
        const pkg = JSON.parse(fs.readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
        const currentVersion = normalizeVersion(pkg.version);

        let remoteVersion = currentVersion;
        let source = 'local';

        try {
            // 1) Intentar desde release latest (más fiable para el botón de actualización)
            const latestRelease = await fetch('https://api.github.com/repos/reset18/Agent-assist/releases/latest?t=' + Date.now(), {
                headers: { 'Accept': 'application/vnd.github+json' }
            });
            if (latestRelease.ok) {
                const rel: any = await latestRelease.json();
                const tag = normalizeVersion(rel?.tag_name || '');
                if (tag) {
                    remoteVersion = tag;
                    source = 'github_release';
                }
            }
        } catch {
            // fallback abajo
        }

        if (source === 'local') {
            // 2) Fallback a package.json de main
            const fetchRemote = await fetch('https://raw.githubusercontent.com/reset18/Agent-assist/main/package.json?t=' + Date.now(), {
                cache: 'no-store'
            });
            if (!fetchRemote.ok) {
                const txt = await fetchRemote.text();
                throw new Error(`No se pudo leer package remoto (${fetchRemote.status}): ${txt.slice(0, 120)}`);
            }
            const githubPkg: any = await fetchRemote.json();
            remoteVersion = normalizeVersion(githubPkg.version);
            source = 'github_main';
        }

        const updateAvailable = isRemoteNewer(remoteVersion, currentVersion);

        console.log(`[UpdateCheck] Local: ${currentVersion}, Remote: ${remoteVersion}, Source: ${source}, Available: ${updateAvailable}`);

        res.json({ current: currentVersion, remote: remoteVersion, updateAvailable, source });
    } catch (e) {
        const pkg = JSON.parse(fs.readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
        res.json({ current: pkg.version, remote: pkg.version, updateAvailable: false, error: 'No se pudo consultar la versión remota' });
    }
});

function normalizeCodexModelList(rawData: any) {
    const rawModels = Array.isArray(rawData?.models)
        ? rawData.models
        : Array.isArray(rawData?.data)
            ? rawData.data
            : [];

    const out: Array<{ id: string; slug: string; name: string }> = [];
    const seen = new Set<string>();

    for (const m of rawModels) {
        const id = String(
            m?.slug ||
            m?.id ||
            m?.model_slug ||
            m?.default_model_slug ||
            m?.name ||
            ''
        ).trim();
        if (!id) continue;

        // Algunos catálogos de cuenta devuelven flags inconsistentes; no filtramos por `active === false`.
        const disabled = m?.disabled === true || m?.is_disabled === true;
        if (disabled) continue;

        if (seen.has(id)) continue;
        seen.add(id);

        out.push({
            id,
            slug: id,
            name: String(m?.title || m?.display_name || m?.name || id)
        });
    }

    const score = (id: string) => {
        const n = id.toLowerCase();
        if (n.startsWith('gpt-5')) return 0;
        if (n.startsWith('gpt-4o')) return 1;
        if (n.startsWith('o1') || n.startsWith('o3') || n.startsWith('o4')) return 2;
        if (n.startsWith('gpt-4')) return 3;
        return 5;
    };

    out.sort((a, b) => {
        const sa = score(a.id);
        const sb = score(b.id);
        if (sa !== sb) return sa - sb;
        return a.id.localeCompare(b.id);
    });

    return out;
}

async function validateCodexModelForAccount(accessToken: string, model: string) {
    const body = {
        model,
        instructions: 'Valida disponibilidad del modelo para esta cuenta.',
        input: [{ role: 'user', content: 'ping' }],
        store: false,
        stream: false,
        max_output_tokens: 8
    };

    const resp = await fetch('https://chatgpt.com/backend-api/codex/responses', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Modelo no válido para esta cuenta (${resp.status}): ${err.slice(0, 220)}`);
    }
}

// Proxy para obtener modelos de ChatGPT Codex (v0.2.51)
app.get('/api/auth/:provider/models', async (req, res) => {
    const accountId = req.query.accountId as string;
    if (!accountId) return res.status(400).json({ error: 'accountId required' });

    const accounts = getLLMAccounts();
    const acc = accounts.find(a => a.id === accountId);
    if (!acc || !acc.apiKey) return res.status(404).json({ error: 'Account not found or no token' });

    try {
        const fetchModels = await fetch('https://chatgpt.com/backend-api/models', {
            headers: { 'Authorization': `Bearer ${acc.apiKey}` }
        });
        if (!fetchModels.ok) {
            const err = await fetchModels.text();
            return res.status(fetchModels.status).json({ error: `Error obteniendo catálogo: ${err.slice(0, 220)}` });
        }

        const data: any = await fetchModels.json();
        const models = normalizeCodexModelList(data);
        res.json({ models });
    } catch (e: any) {
        res.status(500).json({ error: 'Error fetching models: ' + e.message });
    }
});

app.post('/api/auth/:provider/validate-model', async (req, res) => {
    const { provider } = req.params;
    const { accountId, model } = req.body || {};
    if (provider !== 'openai') {
        return res.status(400).json({ success: false, error: 'Validación soportada solo para OpenAI OAuth.' });
    }
    if (!accountId || !model) {
        return res.status(400).json({ success: false, error: 'Faltan accountId o model.' });
    }

    const accounts = getLLMAccounts();
    const acc = accounts.find((a) => a.id === accountId);
    if (!acc || !acc.apiKey) {
        return res.status(404).json({ success: false, error: 'Cuenta no encontrada o sin token.' });
    }

    try {
        await validateCodexModelForAccount(acc.apiKey, String(model));
        return res.json({ success: true });
    } catch (e: any) {
        return res.status(400).json({ success: false, error: e.message || 'Modelo no válido.' });
    }
});

app.post('/api/perform-update', async (req, res) => {
    const { exec } = await import('child_process');
    exec('npx ts-node scripts/updater.ts', (error, stdout, stderr) => {
        if (error) {
            console.error(`Update Error: ${error.message}`);
            return;
        }
        console.log(`Update Output: ${stdout}`);
    });
    res.json({ success: true, message: 'Actualización iniciada en segundo plano.' });
});

app.get('/api/whatsapp/status', (req, res) => {
    res.json(whatsappGlobalState);
});

app.get('/api/status', (req, res) => {
    const port = process.env.PORT || '3005';
    const tgEnabled = getSetting('bot_telegram_enabled') !== '0';
    const waEnabled = getSetting('bot_whatsapp_enabled') === '1';

    const provider = getSetting('model_provider') || process.env.LLM_PROVIDER || 'openrouter';
    let model = getSetting('model_name') || process.env.MODEL_NAME || 'n/a';

    // Lógica de modelo efectivo para reportar info correcta
    if (provider === 'openai' && (model.includes('openrouter') || model === 'n/a')) {
        model = 'gpt-4o-mini';
    } else if (provider === 'groq' && (model.includes('openrouter') || model === 'n/a')) {
        model = 'llama-3.3-70b-versatile';
    } else if (provider === 'anthropic' && (model.includes('openrouter') || model === 'n/a')) {
        model = 'claude-3-5-sonnet-20241022';
    } else if (provider === 'google' && (model.includes('openrouter') || model === 'n/a')) {
        model = 'gemini-1.5-flash';
    }

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
            status: 'online'
        },
        llm: {
            provider: provider,
            model: model,
            primary: getSetting('llm_primary_provider'),
            secondary: getSetting('llm_secondary_provider'),
            tertiary: getSetting('llm_tertiary_provider')
        },
        runtimeGuards: getToolRuntimeDiagnostics(),
    });
});

app.get('/api/tool-runtime', (req, res) => {
    res.json(getToolRuntimeDiagnostics());
});

app.get('/api/tool-runtime/history', (req, res) => {
    const hours = Number.parseInt(String(req.query.hours || '24'), 10);
    try {
        const history = getToolRuntimeMetricsHistory(Number.isFinite(hours) ? hours : 24);
        res.json({ history });
    } catch (e: any) {
        res.status(500).json({ error: e.message || 'No se pudo obtener el histórico de estabilidad.' });
    }
});

app.post('/api/voice/test-tts', async (req, res) => {
    try {
        const voiceId = String(req.body?.voiceId || getSetting('openai_voice_id') || 'alloy');
        const model = String(req.body?.model || getSetting('openai_tts_model') || 'auto');
        const providedApiKey = String(req.body?.apiKey || '').trim();

        let apiKey = providedApiKey || String(getSetting('openai_api_key_audio') || process.env.OPENAI_API_KEY || '').trim();
        if (!apiKey || apiKey === 'SUTITUYE POR EL TUYO') {
            return res.status(400).json({ success: false, error: 'No hay API Key de OpenAI para TTS.' });
        }

        const models = model === 'auto' ? ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'] : [model];
        let lastError = '';
        let deniedCount = 0;

        for (const candidate of models) {
            const resp = await fetch('https://api.openai.com/v1/audio/speech', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ model: candidate, voice: voiceId, input: 'Prueba de voz.' })
            });

            if (resp.ok) {
                setSetting('openai_tts_unavailable_until', '0');
                return res.json({ success: true, modelUsed: candidate });
            }

            const err = await resp.text();
            lastError = `${resp.status}: ${err}`;

            const denied = resp.status === 403 && (
                err.includes('does not have access to model') ||
                err.includes('model_not_found')
            );
            if (denied) deniedCount++;
        }

        if (deniedCount === models.length) {
            setSetting('openai_tts_unavailable_until', String(Date.now() + 10 * 60 * 1000));
            return res.status(400).json({
                success: false,
                error: `Tu proyecto OpenAI no tiene acceso a modelos TTS (${models.join(', ')}). Usa motor local (Piper) o ElevenLabs.`
            });
        }

        return res.status(400).json({ success: false, error: `TTS no disponible: ${lastError}` });
    } catch (e: any) {
        return res.status(500).json({ success: false, error: e.message || 'Error interno validando TTS.' });
    }
});

app.post('/api/voice/test-local', async (req, res) => {
    try {
        const fsMod = await import('fs');
        const osMod = await import('os');
        const pathMod = await import('path');
        const child = await import('child_process');

        const defaults = process.platform === 'win32'
            ? { bin: 'C:\\piper\\piper.exe', model: 'C:\\piper\\es_ES-sharvard-medium.onnx' }
            : { bin: pathMod.join(osMod.homedir(), 'piper', 'piper', 'piper'), model: pathMod.join(osMod.homedir(), 'piper', 'es_ES-sharvard-medium.onnx') };

        const piperBin = String(req.body?.piperBinPath || getSetting('piper_bin_path') || defaults.bin).trim();
        const piperModel = String(req.body?.piperModelPath || getSetting('piper_model_path') || defaults.model).trim();

        if (!piperBin || !fsMod.existsSync(piperBin)) {
            return res.status(400).json({ success: false, error: `No se encuentra el binario Piper en: ${piperBin}` });
        }
        if (!piperModel || !fsMod.existsSync(piperModel)) {
            return res.status(400).json({ success: false, error: `No se encuentra el modelo Piper en: ${piperModel}` });
        }

        const ffmpegCheck = child.spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
        const ffmpegOk = ffmpegCheck.status === 0;

        const piperCheck = child.spawnSync(piperBin, ['--help'], { encoding: 'utf8' });
        if (piperCheck.status !== 0) {
            return res.status(400).json({ success: false, error: 'Piper existe pero no pudo ejecutarse correctamente.' });
        }

        return res.json({ success: true, ffmpeg: ffmpegOk, piperBin, piperModel });
    } catch (e: any) {
        return res.status(500).json({ success: false, error: e.message || 'Error validando Piper local.' });
    }
});

app.post('/api/voice/test-chain', async (req, res) => {
    const errors: string[] = [];

    // 1) local
    try {
        const r: any = await (async () => {
            const fsMod = await import('fs');
            const osMod = await import('os');
            const pathMod = await import('path');
            const child = await import('child_process');

            const defaults = process.platform === 'win32'
                ? { bin: 'C:\\piper\\piper.exe', model: 'C:\\piper\\es_ES-sharvard-medium.onnx' }
                : { bin: pathMod.join(osMod.homedir(), 'piper', 'piper', 'piper'), model: pathMod.join(osMod.homedir(), 'piper', 'es_ES-sharvard-medium.onnx') };

            const piperBin = String(req.body?.piperBinPath || getSetting('piper_bin_path') || defaults.bin).trim();
            const piperModel = String(req.body?.piperModelPath || getSetting('piper_model_path') || defaults.model).trim();
            if (!piperBin || !fsMod.existsSync(piperBin)) throw new Error(`Piper no encontrado en ${piperBin}`);
            if (!piperModel || !fsMod.existsSync(piperModel)) throw new Error(`Modelo Piper no encontrado en ${piperModel}`);
            const piperCheck = child.spawnSync(piperBin, ['--help'], { encoding: 'utf8' });
            if (piperCheck.status !== 0) throw new Error('Piper existe pero no pudo ejecutarse.');
            return { ok: true };
        })();
        if (r?.ok) {
            return res.json({ success: true, engineUsed: 'local', details: 'Piper local operativo.' });
        }
    } catch (e: any) {
        errors.push(`local: ${e?.message || String(e)}`);
    }

    // 2) openai
    try {
        const voiceId = String(req.body?.voiceId || getSetting('openai_voice_id') || 'alloy');
        const model = String(req.body?.model || getSetting('openai_tts_model') || 'auto');
        let apiKey = String(req.body?.apiKey || getSetting('openai_api_key_audio') || process.env.OPENAI_API_KEY || '').trim();
        if (apiKey && apiKey !== 'SUTITUYE POR EL TUYO') {
            const models = model === 'auto' ? ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'] : [model];
            for (const candidate of models) {
                const resp = await fetch('https://api.openai.com/v1/audio/speech', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: candidate, voice: voiceId, input: 'Prueba de voz.' })
                });
                if (resp.ok) {
                    setSetting('openai_tts_unavailable_until', '0');
                    return res.json({ success: true, engineUsed: 'openai', details: `OpenAI TTS operativo (${candidate}).` });
                }
            }
            setSetting('openai_tts_unavailable_until', String(Date.now() + 10 * 60 * 1000));
            errors.push('openai: sin acceso a modelos TTS para este proyecto.');
        } else {
            errors.push('openai: sin API key válida para TTS.');
        }
    } catch (e: any) {
        errors.push(`openai: ${e?.message || String(e)}`);
    }

    // 3) elevenlabs
    try {
        const apiKey = getSetting('elevenlabs_api_key');
        const voiceId = getSetting('elevenlabs_voice_id');
        if (!apiKey || !voiceId) throw new Error('faltan credenciales');
        const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'xi-api-key': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text: 'Prueba de voz.', model_id: 'eleven_multilingual_v2' })
        });
        if (resp.ok) {
            return res.json({ success: true, engineUsed: 'elevenlabs', details: 'ElevenLabs operativo.' });
        }
        errors.push(`elevenlabs: status ${resp.status}`);
    } catch (e: any) {
        errors.push(`elevenlabs: ${e?.message || String(e)}`);
    }

    return res.status(400).json({ success: false, error: `No hay motores de voz disponibles: ${errors.join(' | ')}` });
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
    console.log(`[Web v0.2.50] Recibida actualización de ajustes:`, JSON.stringify({
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
        voice_enabled, voice_engine, openai_voice_id, openai_tts_model, openai_api_key_audio,
        piper_bin_path, piper_model_path, piper_speaker, piper_speed,
        elevenlabs_api_key, elevenlabs_voice_id,
        llm_primary_account_id, llm_primary_model,
        llm_secondary_account_id, llm_secondary_model,
        llm_tertiary_account_id, llm_tertiary_model
    } = req.body;

    if (req.body.tool_hooks_enabled !== undefined) setSetting('tool_hooks_enabled', req.body.tool_hooks_enabled ? '1' : '0');
    if (req.body.tool_hooks_strict_mode !== undefined) setSetting('tool_hooks_strict_mode', req.body.tool_hooks_strict_mode ? '1' : '0');
    if (req.body.tool_loop_warning_threshold !== undefined) setSetting('tool_loop_warning_threshold', String(req.body.tool_loop_warning_threshold));
    if (req.body.tool_loop_critical_threshold !== undefined) setSetting('tool_loop_critical_threshold', String(req.body.tool_loop_critical_threshold));
    if (req.body.tool_loop_global_threshold !== undefined) setSetting('tool_loop_global_threshold', String(req.body.tool_loop_global_threshold));

    if (llm_primary_account_id !== undefined) setSetting('llm_primary_account_id', llm_primary_account_id);
    if (llm_primary_model !== undefined) setSetting('llm_primary_model', llm_primary_model);
    if (llm_secondary_account_id !== undefined) setSetting('llm_secondary_account_id', llm_secondary_account_id);
    if (llm_secondary_model !== undefined) setSetting('llm_secondary_model', llm_secondary_model);
    if (llm_tertiary_account_id !== undefined) setSetting('llm_tertiary_account_id', llm_tertiary_account_id);
    if (llm_tertiary_model !== undefined) setSetting('llm_tertiary_model', llm_tertiary_model);
    if (req.body.llm_relay_hopping_enabled !== undefined) setSetting('llm_relay_hopping_enabled', req.body.llm_relay_hopping_enabled ? '1' : '0');
    if (req.body.codex_store_enabled !== undefined) setSetting('codex_store_enabled', req.body.codex_store_enabled ? '1' : '0');
    if (req.body.codex_compaction_enabled !== undefined) setSetting('codex_compaction_enabled', req.body.codex_compaction_enabled ? '1' : '0');
    if (req.body.codex_compact_threshold !== undefined) setSetting('codex_compact_threshold', req.body.codex_compact_threshold);
    if (req.body.ui_show_thinking !== undefined) setSetting('ui_show_thinking', req.body.ui_show_thinking ? '1' : '0');

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
        if (providerToUse === 'qwen') { updateEnv('QWEN_API_KEY', llm_api_key); process.env.QWEN_API_KEY = llm_api_key; }
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
    if (openai_tts_model !== undefined) setSetting('openai_tts_model', openai_tts_model);
    if (openai_api_key_audio !== undefined) setSetting('openai_api_key_audio', openai_api_key_audio);
    if (piper_bin_path !== undefined) setSetting('piper_bin_path', piper_bin_path);
    if (piper_model_path !== undefined) setSetting('piper_model_path', piper_model_path);
    if (piper_speaker !== undefined) setSetting('piper_speaker', piper_speaker);
    if (piper_speed !== undefined) setSetting('piper_speed', piper_speed);
    if (elevenlabs_api_key !== undefined) setSetting('elevenlabs_api_key', elevenlabs_api_key);
    if (elevenlabs_voice_id !== undefined) setSetting('elevenlabs_voice_id', elevenlabs_voice_id);

    res.json({ success: true });
});

app.post('/api/models', async (req, res) => {
    const { provider, apiKey } = req.body;
    if (!SUPPORTED_PROVIDERS.has(provider)) {
        return res.status(400).json({ error: 'Proveedor no soportado actualmente' });
    }
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



    if (provider === 'qwen') {
        return res.json({
            models: [
                { id: 'qwen-turbo', name: 'Qwen Turbo' },
                { id: 'qwen-plus', name: 'Qwen Plus' },
                { id: 'qwen-max', name: 'Qwen Max' }
            ]
        });
    }

    let url = '';
    const headers: any = {};

    if (provider === 'openrouter') url = 'https://openrouter.ai/api/v1/models';
    if (provider === 'groq') url = 'https://api.groq.com/openai/v1/models';
    if (provider === 'openai') url = 'https://api.openai.com/v1/models';
    if (provider === 'qwen') url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/models';
    if (provider === 'google') url = `https://generativelanguage.googleapis.com/v1beta/models?key=${token}`;

    if (token && token !== 'SUTITUYE POR EL TUYO' && provider !== 'google') {
        headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            return res.status(response.status).json({ error: `El proveedor rechazó la conexión (${response.status}). ¿API Key válida?` });
        }

        const data = await response.json();
        let formatted = [];

        if (provider === 'google') {
            formatted = (data.models || [])
                .filter((m: any) => m.name.includes('gemini'))
                .map((m: any) => ({
                    id: m.name.replace('models/', ''),
                    name: m.displayName || m.name
                }));
        } else {
            const modelList = data.data || [];
            formatted = modelList.map((m: any) => ({
                id: m.id,
                name: m.name || m.id
            }));
        }

        res.json({ models: formatted });
    } catch (e: any) {
        res.status(500).json({ error: 'Error de red contactando al proveedor de IA.' });
    }
});

import { getTokenUsageToday } from '../db/index.js';
app.get('/api/tokens/today', (req, res) => {
    try {
        const stats = getTokenUsageToday();
        res.json(stats);
    } catch (e) {
        res.status(500).json({ error: 'Error obteniendo estadísticas' });
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

app.get('/api/tokens/history', (req, res) => {
    try {
        const history = getTokenUsageHistory(7);
        res.json({ history });
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

app.delete('/api/sessions/:id', (req, res) => {
    const { id } = req.params;
    try {
        deleteSession(id);
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
        // processUserMessage ahora espera a que se complete el procesamiento (aunque esté en cola)
        const reply = await processUserMessage('web_user', 'web', message, false, sessionId || 'default');

        res.json({ reply: sanitizeChatOutput(reply) });
    } catch (e: any) {
        res.status(500).json({ error: sanitizeChatOutput(e.message) });
    }
});

app.get('/api/chat/stream', async (req, res) => {
    const { message, sessionId } = req.query;
    if (!message) return res.status(400).json({ error: 'Mensaje vacío' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        const reply = await processUserMessage(
            'web_user',
            'web',
            message as string,
            false,
            (sessionId as string) || 'default',
            (delta) => {
                if (delta.type === 'status' || delta.stage) {
                    sendEvent({ type: 'status', stage: delta.stage || 'thinking', message: sanitizeChatOutput(delta.message || '') });
                } else if (delta.reasoning) {
                    // No exponer razonamiento crudo al frontend (puede incluir contenido interno)
                    sendEvent({ type: 'status', stage: 'thinking', message: 'Procesando...' });
                } else if (delta.content) {
                    sendEvent({ type: 'delta', delta: sanitizeChatOutput(delta.content) });
                }
            }
        );

        sendEvent({ type: 'done', reply: sanitizeChatOutput(reply) });
    } catch (e: any) {
        sendEvent({ type: 'error', message: sanitizeChatOutput(e.message) });
    } finally {
        res.end();
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
