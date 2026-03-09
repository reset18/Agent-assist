import fs from 'fs';
import path from 'path';

function copyRecursiveSync(src: string, dest: string) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats && stats.isDirectory();
    if (isDirectory) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        fs.readdirSync(src).forEach((childItemName) => {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

console.log('Copiando Assets web/public a dist...');
copyRecursiveSync(path.join(process.cwd(), 'src', 'web', 'public'), path.join(process.cwd(), 'dist', 'web', 'public'));

console.log('Copiando esquema de la base de datos a dist/db...');
const dbDistPath = path.join(process.cwd(), 'dist', 'db');
if (!fs.existsSync(dbDistPath)) {
    fs.mkdirSync(dbDistPath, { recursive: true });
}
copyRecursiveSync(path.join(process.cwd(), 'src', 'db', 'schema.sql'), path.join(dbDistPath, 'schema.sql'));

console.log('Copia finalizada.');
