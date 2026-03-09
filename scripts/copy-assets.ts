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
const webSrc = path.join(process.cwd(), 'src', 'web', 'public');
const webDest = path.join(process.cwd(), 'dist', 'web', 'public');

if (!fs.existsSync(webSrc)) {
    console.error(`❌ ERROR: No se encuentra la carpeta de origen: ${webSrc}`);
    process.exit(1);
}

copyRecursiveSync(webSrc, webDest);
console.log(`✅ Assets copiados a: ${webDest}`);

console.log('Copiando esquema de la base de datos a dist/db...');
const dbSrc = path.join(process.cwd(), 'src', 'db', 'schema.sql');
const dbDistPath = path.join(process.cwd(), 'dist', 'db');
const dbDest = path.join(dbDistPath, 'schema.sql');

if (!fs.existsSync(dbDistPath)) {
    fs.mkdirSync(dbDistPath, { recursive: true });
}

if (fs.existsSync(dbSrc)) {
    fs.copyFileSync(dbSrc, dbDest);
    console.log(`✅ Esquema copiado a: ${dbDest}`);
} else {
    console.warn(`⚠️ Advertencia: No se encontró el esquema en ${dbSrc}`);
}

console.log('Copia finalizada.');
