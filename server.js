require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const bodyParser = require('body-parser');

const app = express();
const prisma = new PrismaClient();

app.use(bodyParser.json());

app.post('/webhook/asaas', async (req, res) => {
  console.log('Requisição recebida no webhook');
  console.log('Body completo:', JSON.stringify(req.body, null, 2));
  try {
    const { event, payment, subscription, customer } = req.body;
    console.log('Webhook recebido:', { event, payment, subscription, customer });

    // Validar dados recebidos
    if (!event || !customer || !customer.email) {
      console.log('Dados inválidos recebidos:', req.body);
      return res.status(400).send('Dados inválidos');
    }

    // Log do email antes e depois do toLowerCase
    console.log('Email original:', customer.email);
    console.log('Email em lowercase:', customer.email.toLowerCase());

    // Primeiro, vamos verificar todos os usuários no banco
    const allUsers = await prisma.user.findMany({
      select: { id: true, email: true }
    });
    console.log('Todos os usuários:', JSON.stringify(allUsers, null, 2));

    // Verificar se existe usuário com este email
    const existingUser = await prisma.user.findUnique({
      where: { email: customer.email.toLowerCase() },
      select: { id: true, email: true }
    });
    
    console.log('Tentando encontrar usuário com email:', customer.email);
    console.log('Usuário encontrado:', existingUser);

    if (!existingUser) {
      console.log(`Nenhum usuário encontrado com email: ${customer.email}`);
      return res.status(404).send('Usuário não encontrado');
    }

    // Determinar novo status de assinatura
    let subscriptionStatus = 'free';
    let subscriptionEndDate = null;

    if (event === 'SUBSCRIPTION_ACTIVATED' || event === 'PAYMENT_CONFIRMED') {
      subscriptionStatus = 'premium';
      subscriptionEndDate = new Date(subscription?.nextDueDate || payment?.dueDate);
    } else if (event === 'SUBSCRIPTION_CANCELED' || event === 'PAYMENT_OVERDUE') {
      subscriptionStatus = 'free';
    }

    // Atualizar usuário no banco de dados
    const updatedUser = await prisma.user.update({
      where: { email: customer.email.toLowerCase() },
      data: {
        subscriptionStatus,
        subscriptionEndDate,
        subscriptionId: subscription?.id || payment?.id
      },
    });

    console.log(`Usuário ${customer.email} atualizado para status: ${subscriptionStatus}`);
    res.status(200).send('Webhook processado com sucesso');
  } catch (error) {
    console.error('Erro ao processar webhook:', error);
    res.status(500).send('Erro no servidor');
  }
});

app.get('/test-user', async (req, res) => {
  try {
    const email = req.query.email;
    console.log('Procurando usuário com email:', email);
    
    const allUsers = await prisma.user.findMany({
      select: { id: true, email: true }
    });
    console.log('Todos os usuários:', allUsers);
    
    const user = await prisma.user.findUnique({
      where: { email: email }
    });
    
    if (user) {
      res.json({ found: true, user });
    } else {
      res.json({ found: false, message: 'Usuário não encontrado', allUsers });
    }
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/test-db', async (req, res) => {
  try {
    const count = await prisma.user.count();
    res.json({ message: 'Conexão com banco OK', userCount: count });
  } catch (error) {
    console.error('Erro de conexão com banco:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/ping', (req, res) => {
  res.json({ message: 'pong' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
}); 