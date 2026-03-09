import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';

const execAsync = promisify(exec);

async function runUpdate() {
    console.log(chalk.blue('🚀 Iniciando actualización desde GitHub...'));

    try {
        // 1. Git Pull (Hard Reset to recover from failed builds)
        console.log(chalk.gray('  - Descargando cambios (git reset & pull)...'));
        await execAsync('git fetch origin main');
        await execAsync('git reset --hard origin/main');

        // 2. Install dependencies (if needed)
        console.log(chalk.gray('  - Instalando posibles nuevas dependencias...'));
        await execAsync('npm install');

        // 3. Rebuild
        console.log(chalk.gray('  - Reconstruyendo el proyecto (build)...'));
        await execAsync('npm run build');

        console.log(chalk.green('✅ Actualización completada con éxito.'));
        console.log(chalk.yellow('🔄 El servidor se reiniciará automáticamente vía PM2.'));

        // 4. Restart
        console.log(chalk.gray('  - Reiniciando servicio (pm2 restart)...'));
        await execAsync('pm2 restart agent-assist');

    } catch (error: any) {
        console.error(chalk.red('❌ Error durante la actualización:'), error.message);
        process.exit(1);
    }
}

runUpdate();
