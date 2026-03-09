import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

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

        // Extraer modelos
        let models: any[] = [];
        if (provider === 'google') {
            models = response.data.models
                .filter((m: any) => m.name.includes('gemini'))
                .map((m: any) => ({ name: m.displayName, value: m.name.replace('models/', '') }));
        } else if (provider === 'anthropic') {
            models = [
                { name: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
                { name: 'Claude 3.5 Haiku', value: 'claude-3-5-haiku-20241022' },
                { name: 'Claude 3 Opus', value: 'claude-3-opus-20240229' }
            ];
        } else {
            models = (response.data.data || []).map((m: any) => ({ name: m.id, value: m.id }));
        }

        return models.slice(0, 20); // Limitar a los 20 primeros para no saturar
    } catch (error: any) {
        spinner.fail(chalk.red(`Error de validación: ${error.response?.status || error.message}`));
        return null;
    }
}

async function startSetup() {
    console.clear();
    console.log(logo);
    console.log(chalk.blue('##################################################'));
    console.log(chalk.blue('#            AGENT-ASSIST MASTER v2.0            #'));
    console.log(chalk.blue('##################################################\n'));
    console.log(chalk.yellow('💡 Usa las flechas [↑/↓] del teclado para seleccionar y [Enter] para confirmar.\n'));

    const security = await inquirer.prompt([
        {
            type: 'list',
            name: 'confirm',
            message: chalk.red('⚠️  ADVERTENCIA: Esta instalación tomará el CONTROL TOTAL de este sistema y modificará archivos críticos. ¿Estás seguro de continuar?'),
            choices: [
                { name: 'Sí, acepto el control total y deseo continuar', value: true },
                { name: 'No, cancelar instalación', value: false }
            ]
        }
    ]);

    if (!security.confirm) {
        console.log(chalk.yellow('Instalación cancelada.'));
        process.exit(0);
    }

    // IA Setup
    const aiConfig = await inquirer.prompt([
        {
            type: 'list',
            name: 'provider',
            message: 'Selecciona tu cerebro (IA):',
            choices: [
                { name: 'OpenRouter (Recomendado)', value: 'openrouter' },
                { name: 'OpenAI (ChatGPT)', value: 'openai' },
                { name: 'Google Gemini', value: 'google' },
                { name: 'Anthropic (Claude)', value: 'anthropic' },
                { name: 'Groq (Velocidad)', value: 'groq' }
            ]
        },
        {
            type: 'password',
            name: 'apiKey',
            message: (answers) => `Introduce tu API Key para ${answers.provider}:`,
            validate: (val) => val.length > 0 || 'La API Key es obligatoria'
        }
    ]);

    const models = await validateApiKey(aiConfig.provider, aiConfig.apiKey);
    if (!models) {
        console.log(chalk.red('\nNo se pudo verificar la API Key. Por favor, reinicia el instalador con una clave válida.'));
        process.exit(1);
    }

    const modelSelect = await inquirer.prompt([
        {
            type: 'list',
            name: 'model',
            message: 'Selecciona el modelo que deseas usar:',
            choices: models
        }
    ]);

    // Puerto Setup
    const portConfig = await inquirer.prompt([
        {
            type: 'list',
            name: 'useDefault',
            message: '¿Quieres usar el puerto predeterminado (3005)?',
            choices: [
                { name: 'Sí (3005)', value: true },
                { name: 'No, quiero otro', value: false }
            ]
        },
        {
            type: 'input',
            name: 'customPort',
            message: 'Introduce el puerto deseado:',
            when: (answers) => !answers.useDefault,
            validate: (val) => !isNaN(parseInt(val)) || 'Debe ser un número válido'
        }
    ]);

    const finalPort = portConfig.useDefault ? '3005' : portConfig.customPort;

    // Guardar Config Base
    updateEnv('LLM_PROVIDER', aiConfig.provider);
    updateEnv('PORT', finalPort);
    const keyMap: any = {
        openrouter: 'OPENROUTER_API_KEY',
        openai: 'OPENAI_API_KEY',
        google: 'GEMINI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        groq: 'GROQ_API_KEY'
    };
    updateEnv(keyMap[aiConfig.provider], aiConfig.apiKey);

    // TODO: Guardar modelo en DB (Agent-assist lo hará al arrancar si el .env tiene el provider)

    // Plataforma Setup
    const platformConfig = await inquirer.prompt([
        {
            type: 'list',
            name: 'platform',
            message: 'Selecciona la plataforma de red social para tu agente:',
            choices: [
                { name: 'WhatsApp (Login vía QR)', value: 'whatsapp' },
                { name: 'Telegram (Token + ID)', value: 'telegram' }
            ]
        }
    ]);

    if (platformConfig.platform === 'telegram') {
        const tg = await inquirer.prompt([
            { type: 'input', name: 'token', message: 'Introduce el Token de tu Bot de Telegram:' },
            { type: 'input', name: 'userId', message: 'Introduce tu ID de usuario de Telegram:' }
        ]);
        updateEnv('TELEGRAM_BOT_TOKEN', tg.token);
        updateEnv('TELEGRAM_ALLOWED_USER_IDS', tg.userId);
        console.log(chalk.green('\n✔ Telegram configurado.'));
    } else {
        console.log(chalk.cyan('\nIniciando cliente de WhatsApp. Espera al código QR...'));
        const client = new Client({
            authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
            puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
        });

        const qrSpinner = ora('Generando QR...').start();
        client.on('qr', (qr) => {
            qrSpinner.stop();
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

    console.log('\n' + chalk.blue('##################################################'));
    console.log(chalk.green('   ¡CONFIGURACIÓN MAESTRA COMPLETADA!           '));
    console.log(chalk.blue('##################################################'));
    console.log(`\nAcceso Web: ${chalk.cyan(`http://localhost:${finalPort} / http://TU_IP:${finalPort}`)}`);
    console.log(chalk.yellow('\nFinalizando instalación del servicio...'));
    process.exit(0);
}

startSetup().catch(err => {
    console.error(chalk.red('\n❌ Error crítico en el instalador:'), err.message);
    process.exit(1);
});
