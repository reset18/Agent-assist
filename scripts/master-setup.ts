import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { createServer } from 'http';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import prompts from 'prompts';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Logo ASCII
const logo = `
${chalk.cyan('    ___                         __           ___                _      __ ')}
${chalk.cyan('   /   |  ____ ____  ____  / /_         /   |  _____ _____(_)____/ /_')}
${chalk.cyan('  / /| | / __ \`/ _ \/ __ \/ __/______ / /| | / ___// ___/ / ___/ __/')}
${chalk.cyan(' / ___ |/ /_/ /  __/ / / / /_/_____// ___ |(__  )(__  ) (__  ) /_  ')}
${chalk.cyan('/_/  |_|\\__, /\\___/_/ /_/\\__/      /_/  |_/____//____/_/____/\\__/  ')}
${chalk.cyan('       /____/                                                      ')}
`;

function updateEnv(key: string, value: string) {
    const envPath = path.join(process.cwd(), '.env');
    let content = '';
    if (fs.existsSync(envPath)) {
        content = fs.readFileSync(envPath, 'utf8');
    }
    const regex = new RegExp(`^${key}=.*`, 'm');
    const newValue = `${key}="${value}"`;
    if (regex.test(content)) {
        content = content.replace(regex, newValue);
    } else {
        content += `\n${newValue}`;
    }
    fs.writeFileSync(envPath, content.trim() + '\n');
}

function getEnv(key: string): string | null {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return null;
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(new RegExp(`^${key}="(.*)"$`, 'm')) || content.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match ? match[1] : null;
}

// Servidor temporal para login vía Web durante instalación
async function startTempAuthServer(provider: string): Promise<string> {
    const app = express();
    app.use(express.json());
    const port = 3005;

    // Servir la página de auth
    app.get('/auth-provider', (req, res) => {
        const authPath = path.join(process.cwd(), 'src', 'web', 'public', 'auth.html');
        // Pequeño hack: si no existe (nuevo repo), servimos un string
        if (fs.existsSync(authPath)) {
            res.sendFile(authPath);
        } else {
            res.send('<h1>Error: auth.html no encontrado. Usa el modo manual.</h1>');
        }
    });

    return new Promise((resolve) => {
        const server = createServer(app);

        // Endpoint para recibir la clave desde el navegador
        app.post('/api/verify-llm', (req, res) => {
            const { apiKey } = req.body;
            if (apiKey) {
                res.json({ success: true });
                server.close(() => {
                    resolve(apiKey);
                });
            } else {
                res.status(400).json({ error: 'Key vacía' });
            }
        });

        // Usamos puerto 0 para que el SO asigne uno libre
        server.listen(0, () => {
            const assignedPort = (server.address() as any).port;
            const networkInterfaces = os.networkInterfaces();
            let localIp = 'localhost';

            // Intentar encontrar una IP de red local (IPv4, no interna)
            for (const iface of Object.values(networkInterfaces)) {
                if (!iface) continue;
                for (const details of iface) {
                    if (details.family === 'IPv4' && !details.internal) {
                        localIp = details.address;
                        break;
                    }
                }
                if (localIp !== 'localhost') break;
            }

            console.log(chalk.cyan(`\n🌐 Portal de Login activo en:`));
            console.log(chalk.white(`   - Local:    ${chalk.underline(`http://localhost:${assignedPort}/auth-provider?p=${provider}`)}`));
            if (localIp !== 'localhost') {
                console.log(chalk.white(`   - Red (VM): ${chalk.underline(`http://${localIp}:${assignedPort}/auth-provider?p=${provider}`)}`));
            }
            console.log(chalk.yellow('\nEsperando a que completes el login en tu navegador...\n'));
        });
    });
}

async function validateApiKey(provider: string, apiKey: string) {
    const spinner = ora(`Validando API Key para ${provider}...`).start();
    try {
        let url = '';
        const headers: any = { 'Authorization': `Bearer ${apiKey}` };

        if (provider === 'openrouter') url = 'https://openrouter.ai/api/v1/models';
        if (provider === 'openai') url = 'https://api.openai.com/v1/models';
        if (provider === 'groq') url = 'https://api.groq.com/openai/v1/models';
        if (provider === 'google') {
            url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
            delete headers['Authorization'];
        }
        if (provider === 'anthropic') {
            url = 'https://api.anthropic.com/v1/models';
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
            delete headers['Authorization'];
        }
        if (provider === 'qwen') {
            url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/models';
        }

        const response = await axios.get(url, { headers, timeout: 10000 });
        spinner.succeed(chalk.green('¡API Key válida!'));

        let models: any[] = [];
        if (provider === 'google') {
            models = response.data.models
                .filter((m: any) => m.name.includes('gemini'))
                .map((m: any) => ({ title: m.displayName, value: m.name.replace('models/', '') }));
        } else if (provider === 'anthropic') {
            models = [
                { title: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
                { title: 'Claude 3.5 Haiku', value: 'claude-3-5-haiku-20241022' }
            ];
        } else if (provider === 'qwen') {
            models = [
                { title: 'Qwen Turbo', value: 'qwen-turbo' },
                { title: 'Qwen Plus', value: 'qwen-plus' },
                { title: 'Qwen Max', value: 'qwen-max' }
            ];
        } else {
            models = (response.data.data || []).map((m: any) => ({ title: m.id, value: m.id }));
        }

        return models.slice(0, 15);
    } catch (error: any) {
        spinner.fail(chalk.red(`Error de validación: ${error.response?.status || error.message}`));
        return null;
    }
}

async function startSetup() {
    console.log(logo);
    console.log(chalk.blue('##################################################'));
    console.log(chalk.blue('#            AGENT-ASSIST MASTER v2.0            #'));
    console.log(chalk.blue('##################################################\n'));
    console.log(chalk.yellow('💡 Usa las flechas [↑/↓] del teclado para seleccionar y [Enter] para confirmar.\n'));

    const security = await prompts({
        type: 'select',
        name: 'confirm',
        message: chalk.red('⚠️  ADVERTENCIA: Esta instalación tomará el CONTROL TOTAL de este sistema. ¿Deseas continuar?'),
        choices: [
            { title: '✅ Sí, acepto el CONTROL TOTAL y deseo continuar', value: true },
            { title: '❌ No, cancelar instalación', value: false }
        ]
    });

    if (!security.confirm || security.confirm === undefined) {
        console.log(chalk.yellow('Instalación cancelada.'));
        process.exit(0);
    }

    // Revisar credenciales existentes
    const existingProvider = getEnv('LLM_PROVIDER');
    let aiConfig: any = {};
    const keyMap: any = {
        openrouter: 'OPENROUTER_API_KEY',
        openai: 'OPENAI_API_KEY',
        google: 'GEMINI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        groq: 'GROQ_API_KEY',
        qwen: 'QWEN_API_KEY'
    };

    if (existingProvider && getEnv(keyMap[existingProvider])) {
        const keepExisting = await prompts([{
            type: 'confirm',
            name: 'keep',
            message: `Detectamos una configuración previa de IA (${chalk.cyan(existingProvider)}). ¿Deseas mantenerla?`,
            initial: true
        }]);

        if (keepExisting.keep) {
            aiConfig = {
                provider: existingProvider,
                apiKey: getEnv(keyMap[existingProvider])
            };
        }
    }

    if (!aiConfig.provider) {
        const selection = await prompts([
            {
                type: 'select',
                name: 'provider',
                message: 'Selecciona tu cerebro (IA):',
                choices: [
                    { title: 'OpenAI (ChatGPT)', value: 'openai' },
                    { title: 'Anthropic (Claude)', value: 'anthropic' },
                    { title: 'Google Gemini', value: 'google' },
                    { title: 'Groq (Velocidad)', value: 'groq' },
                    { title: 'Qwen (Alibaba Cloud)', value: 'qwen' },
                    { title: 'OpenRouter (Recomendado)', value: 'openrouter' }
                ]
            },
            {
                type: 'select',
                name: 'method',
                message: '¿Cómo deseas conectar?',
                choices: [
                    { title: '🌐 Login vía Navegador (Recomendado)', value: 'web' },
                    { title: '🔑 Introducir API Key Manualmente', value: 'manual' }
                ]
            }
        ]);

        if (!selection.provider) process.exit(1);

        aiConfig.provider = selection.provider;

        if (selection.method === 'web') {
            aiConfig.apiKey = await startTempAuthServer(selection.provider);
        } else {
            const manual = await prompts([
                {
                    type: 'password',
                    name: 'apiKey',
                    message: `Introduce tu API Key para ${selection.provider}:`,
                    validate: val => val.length > 0 ? true : 'La API Key es obligatoria'
                }
            ]);
            aiConfig.apiKey = manual.apiKey;
        }

        if (!aiConfig.apiKey) process.exit(1);
    }

    const models = await validateApiKey(aiConfig.provider, aiConfig.apiKey);
    if (!models) {
        console.log(chalk.red('\nNo se pudo verificar la API Key. Por favor, reinicia el instalador con una clave válida.'));
        process.exit(1);
    }

    const modelSelect = await prompts([{
        type: 'select',
        name: 'model',
        message: 'Selecciona el modelo que deseas usar:',
        choices: models
    }]);

    if (!modelSelect.model) process.exit(1);

    // Guardar Config Base IA
    updateEnv('LLM_PROVIDER', aiConfig.provider);
    updateEnv(keyMap[aiConfig.provider], aiConfig.apiKey);
    updateEnv('MODEL_NAME', modelSelect.model);

    const finalPort = getEnv('PORT') || '3005';
    updateEnv('PORT', finalPort.toString());

    // Plataforma Setup
    const platformConfig = await prompts([{
        type: 'select',
        name: 'platform',
        message: 'Selecciona la plataforma de red social para tu agente:',
        choices: [
            { title: 'WhatsApp (Login vía QR)', value: 'whatsapp' },
            { title: 'Telegram (Token + ID)', value: 'telegram' }
        ]
    }]);

    if (!platformConfig.platform) process.exit(1);

    if (platformConfig.platform === 'telegram') {
        const existingTgToken = getEnv('TELEGRAM_BOT_TOKEN');
        const existingTgUser = getEnv('TELEGRAM_ALLOWED_USER_IDS');
        let useExistingTg = false;

        if (existingTgToken && existingTgToken !== 'SUTITUYE POR EL TUYO' && existingTgUser) {
            const keepTg = await prompts([{
                type: 'confirm',
                name: 'keep',
                message: 'Detectamos una configuración previa de Telegram. ¿Deseas mantenerla?',
                initial: true
            }]);
            useExistingTg = keepTg.keep;
        }

        if (!useExistingTg) {
            const tg = await prompts([
                { type: 'text', name: 'token', message: 'Introduce el Token de tu Bot de Telegram:' },
                { type: 'text', name: 'userId', message: 'Introduce tu ID de usuario de Telegram:' }
            ]);
            if (!tg.token || !tg.userId) process.exit(1);
            updateEnv('TELEGRAM_BOT_TOKEN', tg.token);
            updateEnv('TELEGRAM_ALLOWED_USER_IDS', tg.userId);
        }
        console.log(chalk.green('\n✔ Telegram configurado.'));
    } else {
        console.log(chalk.cyan('\nIniciando cliente de WhatsApp. Espera al código QR...'));
        const client = new Client({
            authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
            puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
        });

        client.on('qr', (qr) => {
            console.log(chalk.yellow('\nESCANEA ESTE CÓDIGO QR CON TU WHATSAPP:\n'));
            qrcode.generate(qr, { small: true });
        });

        await new Promise((resolve) => {
            client.once('ready', () => {
                console.log(chalk.green('\n✔ ¡WhatsApp vinculado con éxito!'));
                resolve(true);
            });
            client.initialize();
        });
    }

    // El mensaje final lo muestra setup.sh una vez que el proceso arranca correctamente.
    const confFile = path.join(process.cwd(), '.setup_done');
    fs.writeFileSync(confFile, finalPort.toString());
    process.exit(0);
}

startSetup().catch(err => {
    console.error(chalk.red('\n❌ Error crítico en el instalador:'), err.message);
    process.exit(1);
});
