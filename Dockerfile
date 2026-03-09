# Usa una imagen oficial ligera de Node.js
FROM node:20-alpine

# Instala dependencias necesarias para herramientas nativas de shell
# python3/make/g++ a veces son requeridos por node-sqlite3 o node-pty
RUN apk add --no-cache python3 make g++ bash nano openssh-client

# Directorio de trabajo en el contenedor
WORKDIR /app

# Copia los archivos de configuración
COPY package*.json ./
COPY tsconfig.json ./

# Instala todas las dependencias (incluyendo devDependecies para poder compilar TypeScript)
RUN npm install

# Copia el resto del código
COPY . .

# Crea los volúmenes para hacer persistentes las bases de datos y configuraciones MCP
VOLUME [ "/app/MCP", "/app/brain" ]

# Expone el puerto del servidor web
EXPOSE 3000

# Script de inicio
CMD ["npm", "start"]
