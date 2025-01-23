# Usar uma versão mais antiga do Debian (Bullseye)
FROM node:18-bullseye-slim

# Instalar dependências necessárias
RUN apt-get update && apt-get install -y \
    openssl \
    libssl1.1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependências
RUN npm install

# Copiar código fonte
COPY . .

# Gerar Prisma Client
RUN npx prisma generate

# Expor porta
EXPOSE 3000

# Comando para iniciar
CMD ["npm", "start"] 