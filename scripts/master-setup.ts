import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Interfaz de lectura nativa para máxima compatibilidad
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query: string): Promise<string> => new Promise((resolve) => rl.question(query, resolve));

async function selectOption(message: string, options: { name: string, value: any }[]): Promise<any> {
    console.log(`\n${chalk.cyan('?')} ${chalk.bold(message)}`);
    options.forEach((opt, idx) => {
        console.log(`  ${chalk.yellow(idx + 1 + ')')} ${opt.name}`);
    });

    while (true) {
        const answer = await question(chalk.cyan('Selecciona una opción [número]: '));
        const num = parseInt(answer);
        if (!isNaN(num) && num > 0 && num <= options.length) {
            return options[num - 1].value;
        }
        console.log(chalk.red('❌ Opción inválida. Inténtalo de nuevo.'));
    }
}

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
                .map((m: any) => ({ name: m.displayName, value: m.name.replace('models/', '') }));
        } else if (provider === 'anthropic') {
            models = [
                { name: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
                { name: 'Claude 3.5 Haiku', value: 'claude-3-5-haiku-20241022' }
            ];
        } else {
            models = (response.data.data || []).map((m: any) => ({ name: m.id, value: m.id }));
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

    const confirm = await selectOption(chalk.red('⚠️  ADVERTENCIA: Esta instalación tomará el CONTROL TOTAL de este sistema. ¿Deseas continuar?'), [
        { name: 'Sí, acepto el CONTROL TOTAL y deseo continuar', value: true },
        { name: 'No, cancelar instalación', value: false }
    ]);

    if (!confirm) {
        console.log(chalk.yellow('Instalación cancelada.'));
        process.exit(0);
    }

    // IA Setup
    const provider = await selectOption('Selecciona tu cerebro (IA):', [
        { name: 'OpenRouter (Recomendado)', value: 'openrouter' },
        { name: 'OpenAI (ChatGPT)', value: 'openai' },
        { name: 'Google Gemini', value: 'google' },
        { name: 'Anthropic (Claude)', value: 'anthropic' },
        { name: 'Groq (Velocidad)', value: 'groq' }
    ]);

    let apiKey = '';
    while (!apiKey) {
        apiKey = await question(`Introduce tu API Key para ${provider}: `);
        if (!apiKey) console.log(chalk.red('La API Key es obligatoria.'));
    }

    const models = await validateApiKey(provider, apiKey);
    if (!models) {
        console.log(chalk.red('\nNo se pudo verificar la API Key. Reinicia el instalador con una clave válida.'));
        process.exit(1);
    }

    const model = await selectOption('Selecciona el modelo que deseas usar:', models);

    // Puerto Setup
    const useDefault = await selectOption('¿Quieres usar el puerto predeterminado (3005)?', [
        { name: 'Sí (3005)', value: true },
        { name: 'No, quiero otro', value: false }
    ]);

    let finalPort = '3005';
    if (!useDefault) {
        finalPort = await question('Introduce el puerto deseado: ');
    }

    // Guardar Config Base
    updateEnv('LLM_PROVIDER', provider);
    updateEnv('PORT', finalPort);
    const keyMap: any = {
        openrouter: 'OPENROUTER_API_KEY',
        openai: 'OPENAI_API_KEY',
        google: 'GEMINI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        groq: 'GROQ_API_KEY'
    };
    updateEnv(keyMap[provider], apiKey);

    // Plataforma Setup
    const platform = await selectOption('Selecciona la red social:', [
        { name: 'WhatsApp (Login vía QR)', value: 'whatsapp' },
        { name: 'Telegram (Token + ID)', value: 'telegram' }
    ]);

    if (platform === 'telegram') {
        const token = await question('Introduce el Token de tu Bot de Telegram: ');
        const userId = await question('Introduce tu ID de usuario de Telegram: ');
        updateEnv('TELEGRAM_BOT_TOKEN', token);
        updateEnv('TELEGRAM_ALLOWED_USER_IDS', userId);
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

    console.log('\n' + chalk.blue('##################################################'));
    console.log(chalk.green('   ¡CONFIGURACIÓN MAESTRA COMPLETADA!           '));
    console.log(chalk.blue('##################################################'));
    console.log(`\nAcceso Web: ${chalk.cyan(`http://localhost:${finalPort}`)}`);
    process.exit(0);
}

startSetup().catch(err => {
    console.error(chalk.red('\n❌ Error:'), err.message);
    process.exit(1);
});
