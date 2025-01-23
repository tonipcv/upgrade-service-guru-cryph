# Usar Debian 11 (Bullseye) que tem libssl1.1
FROM debian:11-slim

# Evitar prompts interativos durante a instalação
ENV DEBIAN_FRONTEND=noninteractive

# Instalar Node.js, tini e dependências
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    libssl1.1 \
    ca-certificates \
    tini \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Criar diretório de logs
RUN mkdir -p /app/logs && chmod 777 /app/logs

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

# Usar tini como entrypoint
ENTRYPOINT ["/usr/bin/tini", "--"]

# Comando para iniciar
CMD ["node", "server.js"] 