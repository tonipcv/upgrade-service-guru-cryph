require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const prisma = new PrismaClient();

// Configuração do Asaas
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_API_URL = 'https://sandbox.asaas.com/api/v3'; // ou https://api.asaas.com/v3 para produção

app.use(bodyParser.json());

async function getAsaasCustomer(customerId) {
  try {
    const response = await axios.get(`${ASAAS_API_URL}/customers/${customerId}`, {
      headers: {
        'access_token': ASAAS_API_KEY
      }
    });
    return response.data;
  } catch (error) {
    console.error('Erro ao buscar cliente no Asaas:', error);
    throw error;
  }
}

app.post('/webhook/asaas', async (req, res) => {
  console.log('Requisição recebida no webhook');
  console.log('Body completo:', JSON.stringify(req.body, null, 2));
  try {
    const { event, payment } = req.body;

    // Validar dados recebidos
    if (!event || !payment || !payment.customer) {
      console.log('Dados inválidos recebidos:', req.body);
      return res.status(400).send('Dados inválidos');
    }

    // Buscar dados completos do cliente no Asaas
    const customer = await getAsaasCustomer(payment.customer);
    console.log('Cliente encontrado no Asaas:', customer);

    // Verificar se existe usuário com este email
    const existingUser = await prisma.user.findUnique({
      where: { email: customer.email.toLowerCase() },
      select: { id: true, email: true }
    });
    
    if (!existingUser) {
      console.log(`Nenhum usuário encontrado com email: ${customer.email}`);
      return res.status(404).send('Usuário não encontrado');
    }

    // Determinar novo status de assinatura
    let subscriptionStatus = 'free';
    let subscriptionEndDate = null;

    if (event === 'PAYMENT_CONFIRMED') {
      subscriptionStatus = 'premium';
      subscriptionEndDate = new Date(payment.dueDate);
      subscriptionEndDate.setFullYear(subscriptionEndDate.getFullYear() + 1);
    } else if (event === 'PAYMENT_OVERDUE' || event === 'PAYMENT_CANCELED') {
      subscriptionStatus = 'free';
    }

    if (event === 'PAYMENT_CREATED') {
      console.log('Pagamento criado, aguardando confirmação');
      return res.status(200).send('Webhook processado com sucesso');
    }

    // Atualizar usuário no banco de dados
    const updatedUser = await prisma.user.update({
      where: { email: customer.email.toLowerCase() },
      data: {
        subscriptionStatus,
        subscriptionEndDate,
        subscriptionId: payment.id
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