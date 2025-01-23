require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const prisma = new PrismaClient();
const port = process.env.PORT || 80;

// Configurar logs
const logDir = '/app/logs';
if (!fs.existsSync(logDir)){
    fs.mkdirSync(logDir);
}

const logStream = fs.createWriteStream(path.join(logDir, 'app.log'), { flags: 'a' });

// Função helper para log
function writeLog(level, ...args) {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
    ).join(' ');
    
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    
    // Log direto para console e arquivo
    process.stdout.write(logMessage);
    logStream.write(logMessage);
}

// Sistema de logging simplificado
const logger = {
    info: (...args) => writeLog('INFO', ...args),
    error: (...args) => writeLog('ERROR', ...args),
    warn: (...args) => writeLog('WARN', ...args),
    debug: (...args) => writeLog('DEBUG', ...args)
};

// Log inicial
logger.info('Iniciando servidor...');
logger.info('Ambiente:', {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL?.substring(0, 20) + '...',
    DIGITAL_GURU_ACCOUNT_TOKEN: process.env.DIGITAL_GURU_ACCOUNT_TOKEN ? 'Set' : 'Not Set',
    DIGITAL_GURU_USER_TOKEN: process.env.DIGITAL_GURU_USER_TOKEN ? 'Set' : 'Not Set',
    PORT: process.env.PORT
});

// Configuração do Digital Guru
const DIGITAL_GURU_ACCOUNT_TOKEN = process.env.DIGITAL_GURU_ACCOUNT_TOKEN;
const DIGITAL_GURU_USER_TOKEN = process.env.DIGITAL_GURU_USER_TOKEN;
const DIGITAL_GURU_API_URL = 'https://api.digitalmanager.guru/v2';

app.use(express.json());

// Configurar cliente axios para Digital Guru
const digitalGuruApi = axios.create({
  baseURL: DIGITAL_GURU_API_URL,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${DIGITAL_GURU_USER_TOKEN}`
  }
});

// Função melhorada para debug
async function getAsaasCustomer(customerId) {
  try {
    logger.info('Fazendo requisição para Asaas:', {
      url: `${ASAAS_API_URL}/customers/${customerId}`,
      headers: {
        'access_token': ASAAS_API_KEY
      }
    });

    const response = await asaasApi.get(`/customers/${customerId}`);
    return response.data;
  } catch (error) {
    logger.error('Erro ao buscar cliente no Asaas:', {
      status: error.response?.status,
      data: error.response?.data,
      customerId,
      url: `${ASAAS_API_URL}/customers/${customerId}`,
      headers: asaasApi.defaults.headers
    });
    
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

app.post('/webhook/asaas', async (req, res) => {
  logger.info('Requisição recebida no webhook');
  try {
    const { event, payment, subscription } = req.body;
    logger.info('Webhook recebido:', { event, payment, subscription });

    // Validar dados recebidos
    if (!event || (!payment && !subscription)) {
      logger.info('Dados inválidos recebidos:', req.body);
      return res.status(400).send('Dados inválidos');
    }

    // Buscar dados do cliente
    const customerId = payment?.customer || subscription?.customer;
    const customer = await getAsaasCustomer(customerId);
    
    if (!customer) {
      logger.info(`Cliente não encontrado no Asaas: ${customerId}`);
      return res.status(404).send('Cliente não encontrado');
    }

    // Usar o email do cliente do Asaas diretamente
    const userEmail = customer.email;
    logger.info('Email do usuário para busca:', userEmail);

    // Verificar se existe usuário com este email
    const existingUser = await prisma.user.findUnique({
      where: { email: userEmail.toLowerCase() },
      select: { id: true, email: true, subscriptionStatus: true }
    });
    
    if (!existingUser) {
      logger.info(`Nenhum usuário encontrado com email: ${userEmail}`);
      return res.status(404).send('Usuário não encontrado');
    }

    logger.info('Usuário encontrado:', existingUser);

    // Determinar novo status de assinatura baseado no evento
    let subscriptionStatus = 'free';
    let subscriptionEndDate = null;
    let subscriptionId = null;

    // Priorizar eventos por importância
    switch (event) {
      // Eventos de pagamento confirmado
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
      case 'SUBSCRIPTION_CREATED':
        subscriptionStatus = 'premium';
        const dueDate = new Date(payment?.dueDate || subscription?.nextDueDate);
        subscriptionEndDate = new Date(dueDate.setFullYear(dueDate.getFullYear() + 1));
        subscriptionId = payment?.id || subscription?.id;
        
        // Atualizar usuário para premium
        const updatedUser = await prisma.user.update({
          where: { email: userEmail.toLowerCase() },
          data: {
            subscriptionStatus,
            subscriptionEndDate,
            subscriptionId
          },
        });
        logger.info(`Usuário ${userEmail} atualizado para premium:`, updatedUser);
        break;

      // Eventos de cancelamento ou problema
      case 'PAYMENT_OVERDUE':
      case 'PAYMENT_CANCELED':
      case 'PAYMENT_DELETED':
      case 'SUBSCRIPTION_DELETED':
      case 'SUBSCRIPTION_INACTIVATED':
      case 'SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK':
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
        logger.info(`Usuário ${userEmail} retornado para free`);
        break;

      // Eventos informativos que não alteram status
      case 'SUBSCRIPTION_UPDATED':
      case 'SUBSCRIPTION_SPLIT_DISABLED':
      case 'SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK_FINISHED':
        logger.info(`Evento informativo recebido: ${event}`);
        logger.info('Dados do evento:', { subscription });
        break;

      default:
        logger.info(`Evento não tratado: ${event}`);
    }

    logger.info('Dados finais:', {
      customer: {
        name: customer.name,
        email: customer.email,
        phone: customer.phone
      },
      event,
      status: subscriptionStatus,
      endDate: subscriptionEndDate
    });

    res.status(200).send('Webhook processado com sucesso');
  } catch (error) {
    logger.error('Erro ao processar webhook:', error);
    res.status(500).send('Erro no servidor');
  }
});

app.post('/webhook/digitalguru', async (req, res) => {
  logger.info('Requisição recebida no webhook Digital Guru');
  try {
    // Validar Account Token
    const receivedToken = req.headers['x-account-token'];
    if (receivedToken !== DIGITAL_GURU_ACCOUNT_TOKEN) {
      logger.info('Token de conta inválido');
      return res.status(401).send('Token inválido');
    }

    const { event, data } = req.body;
    logger.info('Webhook recebido:', { event, data });

    // Validar dados recebidos
    if (!event || !data) {
      logger.info('Dados inválidos recebidos:', req.body);
      return res.status(400).send('Dados inválidos');
    }

    const userEmail = data.customer?.email;
    if (!userEmail) {
      logger.info('Email do cliente não encontrado nos dados');
      return res.status(400).send('Email do cliente não encontrado');
    }

    logger.info('Email do usuário para busca:', userEmail);

    // Verificar se existe usuário com este email
    const existingUser = await prisma.user.findUnique({
      where: { email: userEmail.toLowerCase() },
      select: { id: true, email: true, subscriptionStatus: true }
    });
    
    if (!existingUser) {
      logger.info(`Nenhum usuário encontrado com email: ${userEmail}`);
      return res.status(404).send('Usuário não encontrado');
    }

    logger.info('Usuário encontrado:', existingUser);

    // Determinar novo status de assinatura baseado no evento
    let subscriptionStatus = 'free';
    let subscriptionEndDate = null;
    let subscriptionId = null;

    // Priorizar eventos por importância
    switch (event) {
      // Eventos de pagamento confirmado
      case 'SUBSCRIPTION_CREATED':
      case 'SUBSCRIPTION_RENEWED':
      case 'PAYMENT_CONFIRMED':
        subscriptionStatus = 'premium';
        // Calcular data de término baseado no plano
        const planDuration = data.subscription?.plan?.duration || 12; // duração em meses
        const startDate = new Date(data.subscription?.startDate || new Date());
        subscriptionEndDate = new Date(startDate);
        subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + planDuration);
        subscriptionId = data.subscription?.id;
        
        // Atualizar usuário para premium
        const updatedUser = await prisma.user.update({
          where: { email: userEmail.toLowerCase() },
          data: {
            subscriptionStatus,
            subscriptionEndDate,
            subscriptionId
          },
        });
        logger.info(`Usuário ${userEmail} atualizado para premium:`, updatedUser);
        break;

      // Eventos de cancelamento ou problema
      case 'SUBSCRIPTION_CANCELLED':
      case 'SUBSCRIPTION_EXPIRED':
      case 'PAYMENT_OVERDUE':
      case 'PAYMENT_FAILED':
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
        logger.info(`Usuário ${userEmail} retornado para free`);
        break;

      default:
        logger.info(`Evento não tratado: ${event}`);
    }

    logger.info('Dados finais:', {
      customer: {
        email: userEmail
      },
      event,
      status: subscriptionStatus,
      endDate: subscriptionEndDate
    });

    res.status(200).send('Webhook processado com sucesso');
  } catch (error) {
    logger.error('Erro ao processar webhook:', error);
    res.status(500).send('Erro no servidor');
  }
});

app.get('/test-user', async (req, res) => {
  try {
    const email = req.query.email;
    logger.info('Procurando usuário com email:', email);
    
    const allUsers = await prisma.user.findMany({
      select: { id: true, email: true }
    });
    logger.info('Todos os usuários:', allUsers);
    
    const user = await prisma.user.findUnique({
      where: { email: email }
    });
    
    if (user) {
      res.json({ found: true, user });
    } else {
      res.json({ found: false, message: 'Usuário não encontrado', allUsers });
    }
  } catch (error) {
    logger.error('Erro:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/test-db', async (req, res) => {
  try {
    const count = await prisma.user.count();
    res.json({ message: 'Conexão com banco OK', userCount: count });
  } catch (error) {
    logger.error('Erro de conexão com banco:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/ping', (req, res) => {
  res.json({ message: 'pong' });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'cryph-webhook',
    database: 'connected'
  });
});

// Rota para simular eventos do webhook Digital Guru
app.post('/test-webhook', async (req, res) => {
  try {
    const testEvent = {
      event: req.body.event || 'SUBSCRIPTION_CREATED',
      data: {
        customer: {
          email: req.body.email || 'test@example.com'
        },
        subscription: {
          id: 'test_sub_' + Date.now(),
          plan: {
            duration: req.body.duration || 12
          },
          startDate: new Date().toISOString()
        }
      }
    };

    // Simular chamada ao webhook
    const response = await axios.post('http://localhost:3000/webhook/digitalguru', testEvent, {
      headers: {
        'x-account-token': DIGITAL_GURU_ACCOUNT_TOKEN
      }
    });

    res.json({
      success: true,
      sentEvent: testEvent,
      response: response.data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Rota para verificar status da assinatura
app.get('/check-subscription/:email', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: req.params.email.toLowerCase() },
      select: {
        email: true,
        subscriptionStatus: true,
        subscriptionEndDate: true,
        subscriptionId: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json({
      user,
      isActive: user.subscriptionStatus === 'premium',
      daysRemaining: user.subscriptionEndDate ? 
        Math.ceil((new Date(user.subscriptionEndDate) - new Date()) / (1000 * 60 * 60 * 24)) : 
        0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.send('Server is running');
});

const server = app.listen(port, () => {
  logger.info(`Servidor rodando na porta ${port}`);
  logger.info(`Ambiente: ${process.env.NODE_ENV}`);
});

let isShuttingDown = false;

// Gerenciamento gracioso de encerramento
async function shutdown(signal) {
    logger.info(`Recebido sinal: ${signal}`);
    
    if (isShuttingDown) {
        logger.info('Shutdown já em andamento...');
        return;
    }
    
    isShuttingDown = true;
    logger.info('Iniciando processo de shutdown...');
    
    try {
        // Log do estado atual
        logger.info('Estado atual do servidor:');
        logger.info(`- Conexões ativas: ${server.connections}`);
        logger.info(`- Memória:`, process.memoryUsage());
        
        // Fechar servidor HTTP
        server.close(() => {
            logger.info('Servidor HTTP fechado com sucesso');
        });
        
        // Aguardar conexões finalizarem
        logger.info('Aguardando conexões existentes...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Desconectar Prisma
        logger.info('Desconectando Prisma...');
        await prisma.$disconnect();
        logger.info('Prisma desconectado com sucesso');
        
        // Fechar arquivo de log
        logger.info('Finalizando logs...');
        logStream.end();
        
        // Aguardar logs serem escritos
        await new Promise(resolve => logStream.on('finish', resolve));
        
        process.exit(0);
    } catch (err) {
        logger.error(`Erro durante shutdown:`, err);
        process.exit(1);
    }
}

// Handlers para sinais de término
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handler para erros não tratados
process.on('uncaughtException', (err) => {
  logger.error('Erro não tratado:', err);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (err) => {
  logger.error('Promise rejection não tratada:', err);
  shutdown('unhandledRejection');
});

// Manter o processo vivo
process.stdin.resume(); 