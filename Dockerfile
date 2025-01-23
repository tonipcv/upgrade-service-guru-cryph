# Usar Alpine com OpenSSL 1.1
FROM node:18-alpine

# Instalar dependências necessárias
RUN apk add --no-cache \
    openssl \
    openssl-dev \
    libc6-compat \
    make \
    gcc \
    g++ \
    python3

WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependências com flags específicas para o Prisma
ENV PRISMA_CLI_BINARY_TARGETS=linux-musl
RUN npm install

# Copiar código fonte
COPY . .

# Gerar Prisma Client
RUN npx prisma generate

# Limpar dependências de desenvolvimento
RUN apk del openssl-dev make gcc g++ python3

# Expor porta
EXPOSE 3000

# Comando para iniciar
CMD ["npm", "start"] 