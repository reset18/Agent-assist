import axios from 'axios';
import chalk from 'chalk';
import 'dotenv/config';

async function getStatus() {
    const port = process.env.PORT || '3005';
    const url = `http://localhost:${port}/api/status`;

    console.log(chalk.cyan('\n 📊 AGENT-ASSIST - ESTADO DEL SISTEMA'));
    console.log(chalk.gray(' ===================================='));

    try {
        const response = await axios.get(url, { timeout: 3000 });
        const data = response.data;

        const tableData = [
            { service: 'Web Server', status: data.server.status === 'online' ? chalk.green('✅ ONLINE') : chalk.red('❌ OFFLINE'), detail: `Puerto: ${data.server.port}` },
            { service: 'WhatsApp', status: data.whatsapp.enabled ? (data.whatsapp.status === 'connected' ? chalk.green('✅ CONECTADO') : chalk.yellow('⏳ ' + data.whatsapp.status.toUpperCase())) : chalk.gray('⚪ DESHABILITADO'), detail: data.whatsapp.status === 'qr_ready' ? 'Pendiente de QR' : 'Sin sesión activa' },
            { service: 'Telegram', status: data.telegram.enabled ? chalk.green('✅ ACTIVO') : chalk.gray('⚪ DESHABILITADO'), detail: data.telegram.status },
            { service: 'Cerebro (IA)', status: chalk.blue('🧠 ' + data.llm.provider.toUpperCase()), detail: data.llm.model }
        ];

        console.table(tableData);
        console.log(chalk.gray(' ====================================\n'));
    } catch (error: any) {
        console.log(chalk.red('\n ❌ El servidor web no responde.'));
        console.log(chalk.yellow('    Asegúrate de que Agent-Assist esté corriendo (agent-assist restart)\n'));

        // Mostrar info básica de PM2 como fallback
        console.log(chalk.gray(' Info de PM2:'));
    }
}

getStatus();
