FROM node:18-alpine

# Instalar dependências necessárias
RUN apk add --no-cache openssl1.1-compat

WORKDIR /app

# Copiar apenas os arquivos necessários primeiro
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependências
RUN npm install

# Gerar cliente Prisma
RUN npx prisma generate

# Copiar resto do código
COPY . .

EXPOSE 3000

CMD ["npm", "start"] 