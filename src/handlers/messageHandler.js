const { db } = require('../config/firebase');
const { salvarCompraFirebase, adicionarAnexoCompraExistente } = require('../services/firebaseService');
const { transcreverAudioComGemini, extractPurchaseDetails, getConversationalResponse } = require('../services/geminiService');
const { uploadMediaToCloudinary } = require('../services/cloudinaryService');
const { salvarAnexoLocalmente, exportarComprasParaPlanilha } = require('../services/fileService');
const { log } = require('../utils/logger');
const { delay } = require('../utils/helpers');
const fs = require('fs');

// Gerenciamento de estado e sessão em memória
const userStates = {};
const userPurchaseData = {};
const userSessionData = {};

const GRUPO_ID = process.env.FIREBASE_GRUPO_ID || 'grupo1';

// Função auxiliar para enviar o menu principal e evitar repetição de código
async function sendMainMenu(msg, name) {
    const menuText = `👷‍♂️ Olá *${name.split(" ")[0]}*! Sou seu assistente de compras para a obra.\n\n` +
        '*Como posso te ajudar hoje?*\n\n' +
        '1️⃣ - Listar minhas compras\n' +
        '2️⃣ - Adicionar nova compra\n' +
        '3️⃣ - Exportar para planilha\n\n' +
        'Digite o *número* da opção desejada.';
    await msg.reply(menuText);
}


async function handleMessage(msg) {
    const phone = msg.from;
    const chat = await msg.getChat();
    const contact = await msg.getContact();
    const name = contact.pushname || 'Sem nome';
    let msgBody = msg.body.trim();

    if (!phone.endsWith('@c.us') || chat.isGroup) return;

    const cleanup = (p) => {
        const purchase = userPurchaseData[p];
        if (purchase && purchase.anexos) {
            purchase.anexos.forEach(localPath => {
                if (fs.existsSync(localPath)) {
                    fs.unlinkSync(localPath);
                    log('CLEANUP', `Arquivo temporário deletado: ${localPath}`, p);
                }
            });
        }
        delete userStates[p];
        delete userPurchaseData[p];
        delete userSessionData[p];
    };

    const exitKeywords = /^(menu|sair|xau|adeus|voltar|cancelar|fim)$/i;
    if (exitKeywords.test(msgBody.toLowerCase())) {
        if (userStates[phone]) {
            await msg.reply('Ok, operação cancelada. Voltando ao menu principal.');
        }
        cleanup(phone);
        await sendMainMenu(msg, name);
        return;
    }

    if (userStates[phone] === 'free_chat') {
        log('FREE-CHAT', `Mensagem recebida: "${msgBody}"`, phone);
        await chat.sendStateTyping();
        const history = userSessionData[phone]?.chatHistory || [];
        const geminiResponse = await getConversationalResponse(history, msgBody);
        await msg.reply(geminiResponse);
        history.push({ role: 'user', parts: [{ text: msgBody }] });
        history.push({ role: 'model', parts: [{ text: geminiResponse }] });
        userSessionData[phone].chatHistory = history.slice(-8);
        return;
    }

    if (userStates[phone] === 'awaiting_attachment_to_existing') {
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            const anexoUrl = await uploadMediaToCloudinary(media, phone);
            if (anexoUrl) {
                await adicionarAnexoCompraExistente(phone, userSessionData[phone].compraId, anexoUrl);
                await msg.reply('✅ Anexo salvo com sucesso! Deseja adicionar mais algum arquivo a esta compra? (responda *sim* ou *não*)');
            } else {
                await msg.reply('❌ Falha ao salvar o anexo. Deseja tentar novamente?');
            }
        } else if (msgBody.toLowerCase() === 'sim') {
            await msg.reply('Ok, aguardando o próximo anexo...');
        } else if (msgBody.toLowerCase() === 'não' || msgBody.toLowerCase() === 'nao') {
            await msg.reply('Operação finalizada.');
            cleanup(phone);
        } else {
            await msg.reply('Por favor, envie um anexo ou responda com *sim* ou *não*.');
        }
        return;
    }

    if (userStates[phone] === 'awaiting_purchase_number') {
        const index = parseInt(msgBody, 10) - 1;
        const compras = userSessionData[phone].compras;
        if (isNaN(index) || index < 0 || index >= compras.length) {
            await msg.reply('❌ Número inválido. Por favor, digite um número da lista.');
            return;
        }
        const compraSelecionada = compras[index];
        const action = userSessionData[phone].action;

        if (action === 'view_attachments') {
            const anexosAtuais = compraSelecionada.anexos || [];
            if (anexosAtuais.length > 0) {
                let resposta = `*Anexos da compra de ${compraSelecionada.material}:*\n\n`;
                anexosAtuais.forEach((url, i) => {
                    resposta += `${i + 1}. ${url}\n`;
                });
                await msg.reply(resposta);
            } else {
                await msg.reply('Esta compra não possui anexos.');
            }
            cleanup(phone);
        } else if (action === 'add_attachments') {
            userSessionData[phone].compraId = compraSelecionada.id;
            userStates[phone] = 'awaiting_attachment_to_existing';
            await msg.reply(`Ok. Por favor, envie o primeiro anexo para a compra de *${compraSelecionada.material}*.\n\nQuando terminar de enviar os arquivos, digite "não".`);
        }
        return;
    }

    if (userStates[phone] === 'awaiting_list_action') {
        const action = msgBody.toLowerCase();
        if (action === 'a') {
            userSessionData[phone].action = 'view_attachments';
            userStates[phone] = 'awaiting_purchase_number';
            await msg.reply('Qual o *número* da compra cujos anexos você quer ver?');
        } else if (action === 'b') {
            userSessionData[phone].action = 'add_attachments';
            userStates[phone] = 'awaiting_purchase_number';
            await msg.reply('Qual o *número* da compra para adicionar novos anexos?');
        } else {
            await msg.reply('Opção inválida. Responda com *A* ou *B*.');
        }
        return;
    }

    if (userStates[phone] === 'awaiting_more_attachments') {
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            const localPath = await salvarAnexoLocalmente(media, phone);
            if (localPath) {
                userPurchaseData[phone].anexos.push(localPath);
                await msg.reply('✅ Anexo salvo temporariamente! Deseja adicionar mais algum? (*sim* / *não*)');
            } else {
                await msg.reply('❌ Falha ao salvar o anexo. Deseja tentar novamente?');
            }
        } else if (msgBody.toLowerCase() === 'sim') {
            await msg.reply('Ok, aguardando o próximo anexo...');
        } else if (msgBody.toLowerCase() === 'não' || msgBody.toLowerCase() === 'nao') {
            const purchaseInfo = userPurchaseData[phone];
            const purchaseDetails = await extractPurchaseDetails(purchaseInfo.descricao, phone);
            if (!purchaseDetails || !purchaseDetails.material) {
                await msg.reply('❌ Não consegui entender a descrição da compra. Vamos cancelar e tentar de novo.');
                cleanup(phone);
                return;
            }
            userPurchaseData[phone] = { ...purchaseDetails, anexos: purchaseInfo.anexos };
            userStates[phone] = 'awaiting_confirmation';
            const finalData = userPurchaseData[phone];
            let confirmationText = `🔍 *CONFIRA OS DADOS FINAIS:*\n\n` +
                `🏗️ *Material:* ${finalData.material}\n` +
                (finalData.quantidade ? `🧮 *Quantidade:* ${finalData.quantidade}\n` : '') +
                (finalData.valor_unitario ? `💲 *Valor unitário:* R$ ${finalData.valor_unitario.toFixed(2)}\n` : '') +
                (finalData.valor_total ? `💰 *Valor total:* R$ ${finalData.valor_total.toFixed(2)}\n` : '') +
                (finalData.local ? `🏪 *Local:* ${finalData.local}\n` : '') +
                `📎 *Anexos:* ${finalData.anexos.length} arquivo(s) pronto(s) para upload.\n\n` +
                'Os dados estão *corretos*? Responda com *sim* para salvar tudo.';
            await msg.reply(confirmationText);
        } else {
            await msg.reply('Resposta inválida. Por favor, envie outro anexo ou responda com *sim* ou *não*.');
        }
        return;
    }

    if (userStates[phone] === 'awaiting_confirmation') {
        if (msgBody.toLowerCase() === 'sim' || msgBody.toLowerCase() === 's') {
            await msg.reply('✅ Confirmado! Salvando sua compra e fazendo upload dos anexos. Isso pode levar um momento...');
            const compraData = userPurchaseData[phone];
            const salvou = await salvarCompraFirebase(phone, compraData);
            await msg.reply(salvou ? '✨ *Compra registrada com sucesso no sistema!*' : '❌ Falha ao salvar a compra. Tente novamente.');
            cleanup(phone);
        } else if (msgBody.toLowerCase() === 'não' || msgBody.toLowerCase() === 'nao') {
            await msg.reply('Ok, compra descartada.');
            cleanup(phone);
        } else {
            await msg.reply('❌ Resposta inválida. Por favor, responda com *sim* ou *não*.');
        }
        return;
    }

    if (userStates[phone] === 'awaiting_purchase_description') {
        userPurchaseData[phone].descricao = msg.body.trim();
        userStates[phone] = 'awaiting_more_attachments';
        await msg.reply(`Descrição recebida. Deseja adicionar mais algum anexo a esta compra? (responda *sim* ou *não*)`);
        return;
    }

    if (userStates[phone] === 'awaiting_purchase') {
        let textoCompra = '';
        let localPath = null;
        if (msg.type === 'audio' || msg.type === 'ptt') {
            const media = await msg.downloadMedia();
            textoCompra = await transcreverAudioComGemini(media);
        } else if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            localPath = await salvarAnexoLocalmente(media, phone);
            textoCompra = msg.body.trim();
        } else {
            textoCompra = msg.body.trim();
        }

        if (!textoCompra) {
            if (localPath) {
                await msg.reply('Anexo recebido. Por favor, envie agora uma *mensagem de texto* com a descrição da compra (material, valor, etc).');
                userPurchaseData[phone] = { anexos: [localPath], descricao: '' };
                userStates[phone] = 'awaiting_purchase_description';
            } else {
                await msg.reply('Por favor, descreva a compra por texto ou áudio.');
            }
            return;
        }
        userPurchaseData[phone] = {
            descricao: textoCompra,
            anexos: localPath ? [localPath] : []
        };
        userStates[phone] = 'awaiting_more_attachments';
        await msg.reply(`Descrição entendida. ${localPath ? 'Anexo salvo temporariamente. ' : ''}Deseja adicionar mais algum anexo a esta compra? (responda *sim* ou *não*)`);
        return;
    }

    const lowerCaseMsgBody = msgBody.toLowerCase();
    switch (lowerCaseMsgBody) {
        case '1': {
            await chat.sendStateTyping();
            const snapshot = await db.collection('grupos').doc(GRUPO_ID).collection('compras').doc(phone.replace('@c.us', '')).collection('comprasConfirmadas').orderBy('timestamp', 'desc').get();
            if (snapshot.empty) {
                await msg.reply('Você ainda não possui compras registradas.');
                return;
            }
            const compras = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            userSessionData[phone] = { compras };
            let resposta = '🧾 *Suas compras registradas:*\n\n';
            compras.forEach((compra, index) => {
                resposta += `*${index + 1}.* Compra de *${compra.material}*\n` +
                    `   - Valor: R$ ${compra.valor_total?.toFixed(2) || 'N/A'}\n` +
                    `   - Data: ${compra.data}\n` +
                    `   - Anexos: ${compra.anexos ? compra.anexos.length : 0}\n`;
            });
            await msg.reply(resposta);
            await delay(1000);
            await msg.reply(
                'O que você deseja fazer?\n\n' +
                '*A* - Ver anexos de uma compra\n' +
                '*B* - Anexar novo documento a uma compra\n\n' +
                '_(Responda com a letra ou digite "cancelar")_'
            );
            userStates[phone] = 'awaiting_list_action';
            break;
        }
        case '2':
            userStates[phone] = 'awaiting_purchase';
            await msg.reply(
                '🛒 *REGISTRO DE NOVA COMPRA*\n\n' +
                'Para registrar, descreva sua compra por *texto* ou *áudio*.\n\n' +
                'Para adicionar anexos, envie um arquivo (imagem, PDF, etc) e *descreva a compra na legenda*.'
            );
            break;
        case '3':
            await chat.sendStateTyping();
            await exportarComprasParaPlanilha(phone, msg);
            break;
        default:
            if (!userStates[phone]) {
                log('FALLBACK', `Nenhum comando reconhecido. Iniciando modo de conversa livre para: ${phone}`);
                userStates[phone] = 'free_chat';
                userSessionData[phone] = { chatHistory: [] };
                await chat.sendStateTyping();
                const initialResponse = await getConversationalResponse([], msgBody);
                userSessionData[phone].chatHistory.push({ role: 'user', parts: [{ text: msgBody }] });
                userSessionData[phone].chatHistory.push({ role: 'model', parts: [{ text: initialResponse }] });
                await msg.reply(initialResponse);
            }
            break;
    }
}

module.exports = { handleMessage };