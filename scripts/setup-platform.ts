import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query: string) => new Promise<string>((resolve) => rl.question(query, resolve));

function updateEnv(key: string, value: string) {
    const envPath = path.join(process.cwd(), '.env');
    let content = '';
    if (fs.existsSync(envPath)) {
        content = fs.readFileSync(envPath, 'utf8');
    }
    const regex = new RegExp(`^${key}=.*`, 'm');
    if (regex.test(content)) {
        content = content.replace(regex, `${key}="${value}"`);
    } else {
        content += `\n${key}="${value}"`;
    }
    fs.writeFileSync(envPath, content.trim() + '\n');
}

async function setupTelegram() {
    console.log('\n--- Configuración de Telegram ---');
    const token = await question('Introduce el Token de tu Bot de Telegram: ');
    const userId = await question('Introduce tu ID de usuario de Telegram (para la lista blanca): ');

    updateEnv('TELEGRAM_BOT_TOKEN', token.toString());
    updateEnv('TELEGRAM_ALLOWED_USER_IDS', userId.toString());

    console.log('\n✔ Telegram configurado correctamente.');
    process.exit(0);
}

async function setupWhatsapp() {
    console.log('\n--- Configuración de WhatsApp ---');
    console.log('Iniciando cliente de WhatsApp. Por favor, espera a que se genere el código QR...');

    const client = new Client({
        authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', (qr) => {
        console.log('\n==================================================');
        console.log('ESCANEA EL SIGUIENTE CÓDIGO CON TU WHATSAPP:');
        console.log('==================================================\n');
        qrcode.generate(qr, { small: true });
        console.log('\nEsperando escaneo...');
    });

    client.on('ready', () => {
        console.log('\n✔ ¡WhatsApp vinculado con éxito!');
        process.exit(0);
    });

    client.on('auth_failure', (msg) => {
        console.error('\n❌ Error de autenticación:', msg);
        process.exit(1);
    });

    try {
        await client.initialize();
    } catch (e) {
        console.error('\n❌ Error inicializando WhatsApp:', e);
        process.exit(1);
    }
}

async function main() {
    console.log('\n--- Configuración de Plataforma Social ---');
    console.log('1) WhatsApp (Login vía QR)');
    console.log('2) Telegram (Token + ID)');

    const choice = await question('Selecciona una plataforma [1-2]: ');

    if (choice === '1') {
        await setupWhatsapp();
    } else if (choice === '2') {
        await setupTelegram();
    } else {
        console.log('Opción no válida.');
        process.exit(1);
    }
}

main();
