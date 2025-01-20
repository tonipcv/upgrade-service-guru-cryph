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
  try {
    const { event, payment, subscription } = req.body;
    console.log('Webhook recebido:', { event, payment, subscription });

    // Validar dados recebidos
    if (!event || (!payment && !subscription)) {
      console.log('Dados inválidos recebidos:', req.body);
      return res.status(400).send('Dados inválidos');
    }

    // Buscar dados completos do cliente no Asaas
    const customerId = payment?.customer || subscription?.customer;
    const customer = await getAsaasCustomer(customerId);
    console.log('Cliente encontrado no Asaas:', customer);

    // Função para validar email
    const isValidEmail = (email) => {
      return email && email.includes('@') && email.includes('.');
    };

    // Tentar encontrar o email correto do usuário
    let userEmail = payment?.externalReference || subscription?.externalReference;
    if (!isValidEmail(userEmail)) {
      userEmail = customer.email;
    }
    console.log('Email do usuário para busca:', userEmail);

    // Verificar se existe usuário com este email
    const existingUser = await prisma.user.findUnique({
      where: { email: userEmail.toLowerCase() },
      select: { id: true, email: true }
    });
    
    if (!existingUser) {
      console.log(`Nenhum usuário encontrado com email: ${userEmail}`);
      return res.status(404).send('Usuário não encontrado');
    }

    // Determinar novo status de assinatura baseado no evento
    let subscriptionStatus = 'free';
    let subscriptionEndDate = null;
    let subscriptionId = null;

    // Priorizar eventos por importância
    switch (event) {
      // Eventos de pagamento confirmado
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
      case 'SUBSCRIPTION_ACTIVATED':
        subscriptionStatus = 'premium';
        const dueDate = new Date(payment?.dueDate || subscription?.nextDueDate);
        subscriptionEndDate = new Date(dueDate.setFullYear(dueDate.getFullYear() + 1));
        subscriptionId = payment?.id || subscription?.id;
        
        // Atualizar usuário para premium
        await prisma.user.update({
          where: { email: userEmail.toLowerCase() },
          data: {
            subscriptionStatus,
            subscriptionEndDate,
            subscriptionId
          },
        });
        console.log(`Usuário ${userEmail} atualizado para premium`);
        break;

      // Eventos de cancelamento ou problema
      case 'PAYMENT_OVERDUE':
      case 'PAYMENT_CANCELED':
      case 'PAYMENT_DELETED':
      case 'SUBSCRIPTION_CANCELED':
      case 'SUBSCRIPTION_DELETED':
      case 'SUBSCRIPTION_EXPIRED':
        subscriptionStatus = 'free';
        
        // Atualizar usuário para free
        await prisma.user.update({
          where: { email: userEmail.toLowerCase() },
          data: {
            subscriptionStatus,
            subscriptionEndDate: null,
            subscriptionId: null
          },
        });
        console.log(`Usuário ${userEmail} retornado para free`);
        break;

      // Eventos informativos
      case 'PAYMENT_CREATED':
      case 'SUBSCRIPTION_CREATED':
        console.log('Pagamento/Assinatura criada, aguardando confirmação');
        break;

      default:
        console.log(`Evento não tratado: ${event}`);
    }

    console.log('Dados do cliente Asaas:', {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      mobilePhone: customer.mobilePhone,
      event,
      status: subscriptionStatus
    });

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