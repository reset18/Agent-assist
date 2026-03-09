import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

    // IA Setup
    const aiConfig = await prompts([
        {
            type: 'select',
            name: 'provider',
            message: 'Selecciona tu cerebro (IA):',
            choices: [
                { title: 'OpenRouter (Recomendado)', value: 'openrouter' },
                { title: 'OpenAI (ChatGPT)', value: 'openai' },
                { title: 'Google Gemini', value: 'google' },
                { title: 'Anthropic (Claude)', value: 'anthropic' },
                { title: 'Groq (Velocidad)', value: 'groq' }
            ]
        },
        {
            type: 'password',
            name: 'apiKey',
            message: prev => `Introduce tu API Key para ${prev}:`,
            validate: val => val.length > 0 ? true : 'La API Key es obligatoria'
        }
    ]);

    if (!aiConfig.provider || !aiConfig.apiKey) process.exit(1);

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

    // Puerto Setup
    const portConfig = await prompts([{
        type: 'select',
        name: 'useDefault',
        message: '¿Quieres usar el puerto predeterminado (3005)?',
        choices: [
            { title: 'Sí (3005)', value: true },
            { title: 'No, quiero otro', value: false }
        ]
    }]);

    if (portConfig.useDefault === undefined) process.exit(1);

    const finalPort = portConfig.useDefault ? '3005' : (await prompts([{
        type: 'number',
        name: 'customPort',
        message: 'Introduce el puerto deseado:',
        validate: val => val > 1024 ? true : 'Debe ser un puerto válido > 1024'
    }])).customPort;

    // Guardar Config Base
    updateEnv('LLM_PROVIDER', aiConfig.provider);
    updateEnv('PORT', finalPort.toString());
    const keyMap: any = {
        openrouter: 'OPENROUTER_API_KEY',
        openai: 'OPENAI_API_KEY',
        google: 'GEMINI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        groq: 'GROQ_API_KEY'
    };
    updateEnv(keyMap[aiConfig.provider], aiConfig.apiKey);

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
        const tg = await prompts([
            { type: 'text', name: 'token', message: 'Introduce el Token de tu Bot de Telegram:' },
            { type: 'text', name: 'userId', message: 'Introduce tu ID de usuario de Telegram:' }
        ]);
        if (!tg.token || !tg.userId) process.exit(1);
        updateEnv('TELEGRAM_BOT_TOKEN', tg.token);
        updateEnv('TELEGRAM_ALLOWED_USER_IDS', tg.userId);
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

    // Obtener IP local
    const nets = os.networkInterfaces();
    let localIp = 'localhost';
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]!) {
            if (net.family === 'IPv4' && !net.internal) {
                localIp = net.address;
                break;
            }
        }
    }

    console.log('\n' + chalk.blue('##################################################'));
    console.log(chalk.green('   ¡CONFIGURACIÓN MAESTRA COMPLETADA!           '));
    console.log(chalk.blue('##################################################'));
    console.log(`\nAcceso Local: ${chalk.cyan(`http://localhost:${finalPort}`)}`);
    console.log(`Acceso Red (LAN/VM): ${chalk.cyan(`http://${localIp}:${finalPort}`)}`);
    process.exit(0);
}

startSetup().catch(err => {
    console.error(chalk.red('\n❌ Error crítico en el instalador:'), err.message);
    process.exit(1);
});
