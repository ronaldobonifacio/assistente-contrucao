// /app.js

require('dotenv').config();
const qrcode = require('qrcode-terminal');
const { client } = require('./src/config/whatsapp');
const { handleMessage } = require('./src/handlers/messageHandler');
const { iniciarVerificacoes } = require('./src/utils/systemCheck');
const { log } = require('./src/utils/logger');

// Eventos principais do cliente WhatsApp
client.on('qr', qr => qrcode.generate(qr, { small: true }));

client.on('ready', async () => {
    log('WHATSAPP', 'Cliente conectado com sucesso!');
    await iniciarVerificacoes(); // Roda o diagnóstico dos serviços
    log('SYSTEM', 'Bot pronto para receber mensagens.');
});

client.on('auth_failure', () => log('WHATSAPP', 'Falha na autenticação.'));
client.on('disconnected', (reason) => log('WHATSAPP', `Cliente desconectado: ${reason}`));

// Delega o processamento de todas as mensagens para o handler
client.on('message', handleMessage);

// Inicializa o bot
client.initialize();