FROM node:18-alpine

# Instalar dependências necessárias incluindo openssl
RUN apk add --no-cache openssl openssl-dev libc6-compat

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