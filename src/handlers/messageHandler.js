// INÍCIO DO ARQUIVO COMPLETO handleMessage.js

const { db } = require('../config/firebase');
const { salvarCompraFirebase, adicionarAnexoCompraExistente, editarCompraFirebase, removerAnexoCompra } = require('../services/firebaseService');
const { transcreverAudioComGemini, extractPurchaseDetails, getConversationalResponse } = require('../services/geminiService');
const { processNaturalLanguageQuery } = require('../services/geminiQueryService'); // <-- NOVO SERVIÇO
const { uploadMediaToCloudinary } = require('../services/cloudinaryService');
const { exportarComprasParaPlanilha, salvarAnexoLocalmente } = require('../services/fileService');
const { log } = require('../utils/logger');
const { delay } = require('../utils/helpers');
const { MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');

const userStates = {};
const userPurchaseData = {};
const userSessionData = {};

const GRUPO_ID = process.env.FIREBASE_GRUPO_ID || 'grupo1';
const PAGE_SIZE = 5;

async function sendMainMenu(msg, name) {
    const menuText = `👷‍♂️ Olá *${name.split(" ")[0]}*! Sou seu assistente de compras para a obra.\n\n` +
        '*Como posso te ajudar hoje?*\n\n' +
        '1️⃣ - Listar compras do grupo\n' +
        '2️⃣ - Adicionar nova compra\n' +
        '3️⃣ - Exportar para planilha\n\n' +
        'Para ver apenas as suas compras, digite *"listar minhas"*.';
    await msg.reply(menuText);
}

function formatPurchaseDetails(compra, title) {
    let detailsText = `${title}\n\n` +
        `🏗️ *Material:* ${compra.material || 'N/A'}\n` +
        (compra.quantidade ? `🧮 *Quantidade:* ${compra.quantidade}\n` : '') +
        (compra.valor_unitario ? `💲 *Valor unitário:* R$ ${compra.valor_unitario?.toFixed(2)}\n` : '') +
        (compra.valor_total ? `💰 *Valor total:* R$ ${compra.valor_total?.toFixed(2)}\n` : '') +
        (compra.data ? `📅 *Data:* ${compra.data}\n` : '') +
        (compra.local ? `🏪 *Local:* ${compra.local}\n` : '');
    return detailsText;
}

function formatPurchaseComparison(original, final, title) {
    let comparisonText = `${title}\n\n`;
    const fields = ['material', 'quantidade', 'valor_unitario', 'valor_total', 'data', 'local'];
    const fieldLabels = {
        material: '🏗️ *Material:*',
        quantidade: '🧮 *Quantidade:*',
        valor_unitario: '💲 *Valor unitário:*',
        valor_total: '💰 *Valor total:*',
        data: '📅 *Data:*',
        local: '🏪 *Local:*'
    };
    fields.forEach(field => {
        const originalValue = original[field];
        const finalValue = final[field];
        if (originalValue !== finalValue && finalValue) {
            let originalDisplay = originalValue || 'N/A';
            let finalValueDisplay = finalValue;
            if (field === 'valor_unitario' || field === 'valor_total') {
                originalDisplay = `R$ ${originalValue?.toFixed(2) || '0.00'}`;
                finalValueDisplay = `R$ ${finalValue?.toFixed(2)}`;
            }
            comparisonText += `${fieldLabels[field]} ~${originalDisplay}~  ➡️  *${finalValueDisplay}*\n`;
        } else if (finalValue) {
            let displayValue = finalValue;
            if (field === 'valor_unitario' || field === 'valor_total') {
                displayValue = `R$ ${finalValue.toFixed(2)}`;
            }
            comparisonText += `${fieldLabels[field]} ${displayValue}\n`;
        }
    });
    if (final.anexos && final.anexos.length > 0) {
        comparisonText += `\n📎 *Anexos:* ${final.anexos.length} arquivo(s).\n`;
    }
    return comparisonText;
}


async function handleMessage(client, msg) {
    const phone = msg.from;
    const chat = await msg.getChat();
    const contact = await msg.getContact();
    const name = contact.pushname || 'Sem nome';
    let msgBody = msg.body.trim();

    const listPurchases = async (scope = 'group', nextPage = false) => {
        await chat.sendStateTyping();
        let query;
        const sessionKey = `${scope}Session`;

        if (!userSessionData[phone]) userSessionData[phone] = {};
        if (!userSessionData[phone][sessionKey] || !nextPage) {
            userSessionData[phone][sessionKey] = { page: 1, compras: [], lastVisible: null };
        }
        userSessionData[phone].activeListScope = scope;
        const session = userSessionData[phone][sessionKey];

        if (scope === 'user') {
            const userId = phone.replace('@c.us', '');
            query = db.collection('grupos').doc(GRUPO_ID).collection('compras').doc(userId).collection('comprasConfirmadas').orderBy('timestamp', 'desc');
        } else {
            query = db.collectionGroup('comprasConfirmadas').where('grupoId', '==', GRUPO_ID).orderBy('timestamp', 'desc');
        }

        if (nextPage && session.lastVisible) {
            query = query.startAfter(session.lastVisible);
        }

        const snapshot = await query.limit(PAGE_SIZE).get();

        if (snapshot.empty && session.page === 1) {
            let reply = scope === 'user' ? 'Você ainda não possui compras registradas.' : 'Nenhuma compra registrada no grupo ainda.';
            await msg.reply(reply);
            cleanup(phone);
            return;
        }

        const novasCompras = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (snapshot.empty && session.page > 1) {
            await msg.reply('Não há mais compras para mostrar.');
        } else {
            if (session.page === 1) {
                session.compras = novasCompras;
            } else {
                session.compras.push(...novasCompras);
            }
            session.lastVisible = snapshot.docs[snapshot.docs.length - 1];

            let title = scope === 'user' ? '🧾 *Suas compras registradas:*' : '🧾 *Compras de todo o grupo:*';
            let resposta = session.page === 1 ? `${title}\n\n` : '';

            novasCompras.forEach((compra) => {
                const index = session.compras.findIndex(c => c.id === compra.id);
                resposta += `*${index + 1}.* -----\n` +
                    `  *Material:* ${compra.material || 'N/A'}\n` +
                    (compra.data ? `  *Data:* ${compra.data}\n` : '') +
                    (compra.valor_total ? `  *V. Total:* R$ ${compra.valor_total.toFixed(2)}\n` : '') +
                    `  *Anexos:* ${compra.anexos ? compra.anexos.length : 0}\n`;
                if (scope === 'group') {
                    resposta += `  *Comprador:* ${compra.userName || 'Anônimo'}\n`;
                }
                resposta += `\n`;
            });
            await msg.reply(resposta);
        }

        let finalMessage = '';
        const hasMore = novasCompras.length === PAGE_SIZE;

        if (hasMore) {
            session.page++;
            finalMessage += `Mostrando página ${session.page - 1}. Digite *"mais"* para ver as próximas.\n\n`;
        }

        finalMessage += 'O que você deseja fazer?\n\n' +
            '*A* - Ver anexos de uma compra\n' +
            '*B* - Anexar novo documento\n' +
            '*C* - Editar uma compra\n' +
            '*D* - Remover anexo de uma compra\n\n' +
            // MUDANÇA: Adicionando um lembrete para a consulta em linguagem natural
            'Você também pode fazer uma pergunta como *"quanto gastei com cimento?"*';

        await msg.reply(finalMessage);
        userStates[phone] = 'awaiting_list_action';
        userSessionData[phone][sessionKey] = session;
    };

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

    // Se o usuário já estiver em uma conversa, continue a conversa
    if (userStates[phone] === 'free_chat') {
        await chat.sendStateTyping();
        // MUDANÇA: Usa o novo serviço de consulta inteligente no meio da conversa
        const smartResponse = await processNaturalLanguageQuery(msgBody);
        if (smartResponse) {
            await msg.reply(smartResponse);
            // Mantém o estado de free_chat para continuar a conversa
            return;
        }

        // Se não for uma consulta, continua com a conversa normal
        const history = userSessionData[phone]?.chatHistory || [];
        const geminiResponse = await getConversationalResponse(history, msgBody);
        await msg.reply(geminiResponse);
        history.push({ role: 'user', parts: [{ text: msgBody }] });
        history.push({ role: 'model', parts: [{ text: geminiResponse }] });
        userSessionData[phone].chatHistory = history.slice(-8);
        return;
    }

    if (userStates[phone] === 'awaiting_purchase_correction') {
        const textoCorrecao = msg.body.trim();
        if (!textoCorrecao) {
            await msg.reply('Por favor, descreva a correção.');
            return;
        }
        const correcoes = await extractPurchaseDetails(textoCorrecao, phone);
        const compraOriginal = userPurchaseData[phone];
        const dadosParaAtualizar = Object.keys(correcoes).reduce((acc, key) => {
            if (correcoes[key]) acc[key] = correcoes[key];
            return acc;
        }, {});
        const dadosFinais = { ...compraOriginal, ...dadosParaAtualizar };
        userPurchaseData[phone] = dadosFinais;
        userStates[phone] = 'awaiting_confirmation';
        const confirmationText = formatPurchaseComparison(compraOriginal, dadosFinais, '🔍 *CONFIRA OS DADOS CORRIGIDOS:*') +
            `\nAgora os dados estão *corretos*? (*sim* / *não*)`;
        await msg.reply(confirmationText);
        return;
    }

    if (userStates[phone] === 'awaiting_attachment_to_delete') {
        const scope = userSessionData[phone]?.activeListScope || 'group';
        const sessionKey = `${scope}Session`;
        const compra = userSessionData[phone]?.[sessionKey]?.compraParaInteragir;
        if (!compra) { await msg.reply('Sessão expirada. Tente listar novamente.'); cleanup(phone); return; }

        const index = parseInt(msgBody, 10) - 1;

        if (isNaN(index) || index < 0 || index >= compra.anexos.length) {
            await msg.reply('❌ Número inválido. Por favor, digite um número da lista de anexos.');
            return;
        }
        const anexoParaRemover = compra.anexos[index];
        await msg.reply(`Removendo o anexo...`);
        const sucesso = await removerAnexoCompra(compra.userId, compra.id, anexoParaRemover);
        if (sucesso) {
            await msg.reply('✅ Anexo removido com sucesso!');
        } else {
            await msg.reply('❌ Falha ao remover o anexo. Tente novamente.');
        }
        cleanup(phone);
        return;
    }

    if (userStates[phone] === 'awaiting_attachment_to_existing') {
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            const anexoUrl = await uploadMediaToCloudinary(media, phone);
            if (anexoUrl) {
                const scope = userSessionData[phone]?.activeListScope || 'group';
                const sessionKey = `${scope}Session`;
                const compra = userSessionData[phone]?.[sessionKey]?.compraParaInteragir;
                if (!compra) { await msg.reply('Sessão expirada. Tente listar novamente.'); cleanup(phone); return; }

                await adicionarAnexoCompraExistente(compra.userId, compra.id, anexoUrl);
                await msg.reply('✅ Anexo salvo com sucesso! Deseja adicionar mais algum arquivo? (responda *sim* ou *não*)');
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
        const scope = userSessionData[phone]?.activeListScope || 'group';
        const sessionKey = `${scope}Session`;
        const compras = userSessionData[phone]?.[sessionKey]?.compras || [];
        const index = parseInt(msgBody, 10) - 1;

        if (isNaN(index) || index < 0 || index >= compras.length) {
            await msg.reply('❌ Número inválido. Por favor, digite um número da lista.');
            return;
        }
        const compraSelecionada = compras[index];
        userSessionData[phone][sessionKey].compraParaInteragir = compraSelecionada;
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
            if (compraSelecionada.userId !== phone.replace('@c.us', '')) {
                await msg.reply('❌ Você só pode adicionar anexos às compras que você mesmo registrou.');
                cleanup(phone);
                return;
            }
            userStates[phone] = 'awaiting_attachment_to_existing';
            await msg.reply(`Ok. Por favor, envie o primeiro anexo para a compra de *${compraSelecionada.material}*.`);
        } else if (action === 'edit_purchase') {
            if (compraSelecionada.userId !== phone.replace('@c.us', '')) {
                await msg.reply('❌ Você só pode editar as compras que você mesmo registrou.');
                cleanup(phone);
                return;
            }
            userStates[phone] = 'awaiting_purchase_edit_description';
            const originalDetails = formatPurchaseDetails(compraSelecionada, '📝 *ESTES SÃO OS DADOS ATUAIS DA COMPRA:*');
            await msg.reply(originalDetails);
            await delay(1000);
            await msg.reply('Por favor, envie uma mensagem de texto ou um áudio descrevendo *como a compra deve ficar*.');
        } else if (action === 'delete_attachment') {
            if (compraSelecionada.userId !== phone.replace('@c.us', '')) {
                await msg.reply('❌ Você só pode remover anexos das compras que você mesmo registrou.');
                cleanup(phone);
                return;
            }
            const anexos = compraSelecionada.anexos || [];
            if (anexos.length === 0) {
                await msg.reply('Esta compra não possui anexos para remover.');
                cleanup(phone);
                return;
            }
            let resposta = '*Qual anexo você deseja remover?*\n\n';
            anexos.forEach((url, i) => {
                resposta += `*${i + 1}.* ${url.substring(url.lastIndexOf('/') + 1)}\n`;
            });
            await msg.reply(resposta);
            userStates[phone] = 'awaiting_attachment_to_delete';
        }
        return;
    }

    if (userStates[phone] === 'awaiting_purchase_edit_description') {
        let textoEdicao = '';
        if (msg.type === 'audio' || msg.type === 'ptt') {
            await msg.reply('Processando áudio...');
            const media = await msg.downloadMedia();
            textoEdicao = await transcreverAudioComGemini(media);
        } else {
            textoEdicao = msg.body.trim();
        }
        if (!textoEdicao) {
            await msg.reply('❌ Não consegui entender a descrição.');
            return;
        }
        await msg.reply('Analisando as alterações...');
        const novosDadosParciais = await extractPurchaseDetails(textoEdicao, phone);
        const scope = userSessionData[phone]?.activeListScope || 'group';
        const sessionKey = `${scope}Session`;
        const compraOriginal = userSessionData[phone]?.[sessionKey]?.compraParaInteragir;
        if (!compraOriginal) { await msg.reply('Sessão expirada. Tente listar novamente.'); cleanup(phone); return; }

        const dadosParaAtualizar = Object.keys(novosDadosParciais).reduce((acc, key) => {
            if (novosDadosParciais[key]) acc[key] = novosDadosParciais[key];
            return acc;
        }, {});
        if (Object.keys(dadosParaAtualizar).length === 0) {
            await msg.reply('❌ Não identifiquei nenhuma informação para alterar. Tente novamente.');
            return;
        }
        const dadosFinais = { ...compraOriginal, ...dadosParaAtualizar };
        userSessionData[phone][sessionKey].dadosEditados = dadosFinais;
        const previewText = formatPurchaseComparison(compraOriginal, dadosFinais, '*PREVIEW DA EDIÇÃO*') +
            '\nAs alterações estão *corretas*? Responda com *sim* para confirmar.';
        await msg.reply(previewText);
        userStates[phone] = 'awaiting_edit_confirmation';
        return;
    }

    if (userStates[phone] === 'awaiting_edit_confirmation') {
        if (msgBody.toLowerCase() === 'sim' || msgBody.toLowerCase() === 's') {
            await msg.reply('✅ Confirmado! Salvando as alterações...');
            const scope = userSessionData[phone]?.activeListScope || 'group';
            const sessionKey = `${scope}Session`;
            const compraParaInteragir = userSessionData[phone]?.[sessionKey]?.compraParaInteragir;
            if (!compraParaInteragir) { await msg.reply('Sessão expirada. Tente listar novamente.'); cleanup(phone); return; }

            const compraId = compraParaInteragir.id;
            const userId = compraParaInteragir.userId;
            const novosDados = userSessionData[phone][sessionKey].dadosEditados;
            delete novosDados.id;

            const sucesso = await editarCompraFirebase(userId, compraId, novosDados);
            if (sucesso) await msg.reply('✨ *Compra atualizada com sucesso no sistema!*');
            else await msg.reply('❌ Falha ao atualizar a compra.');
        } else {
            await msg.reply('Ok, edição descartada.');
        }
        cleanup(phone);
        return;
    }

    if (userStates[phone] === 'awaiting_list_action') {
        const action = msgBody.toLowerCase();

        // MUDANÇA: Ações de lista agora também podem ser uma pergunta em linguagem natural
        const smartResponse = await processNaturalLanguageQuery(msgBody);
        if (smartResponse) {
            await msg.reply(smartResponse);
            // Mantém o usuário no mesmo estado para que ele possa continuar interagindo com a lista
            await msg.reply('Você pode fazer outra pergunta ou escolher uma das opções (A, B, C, D, mais).');
            return;
        }

        if (action === 'mais') {
            const scope = userSessionData[phone]?.activeListScope || 'group';
            await listPurchases(scope, true);
            return;
        }
        if (['a', 'b', 'c', 'd'].includes(action)) {
            const actionsMap = { a: 'view_attachments', b: 'add_attachments', c: 'edit_purchase', d: 'delete_attachment' };
            const messagesMap = {
                a: 'Qual o *número* da compra cujos anexos você quer ver?',
                b: 'Qual o *número* da compra para adicionar novos anexos?',
                c: 'Qual o *número* da compra que você deseja *editar*?',
                d: 'De qual *número* de compra você quer remover um anexo?'
            };
            userSessionData[phone].action = actionsMap[action];
            userStates[phone] = 'awaiting_purchase_number';
            await msg.reply(messagesMap[action]);
        } else {
            await msg.reply('Opção inválida. Responda com a letra da opção, "mais" ou faça uma pergunta.');
        }
        return;
    }

    if (userStates[phone] === 'awaiting_more_attachments') {
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            const localPath = await salvarAnexoLocalmente(media, phone);
            if (localPath) {
                if (!userPurchaseData[phone]) userPurchaseData[phone] = {};
                if (!userPurchaseData[phone].anexos) userPurchaseData[phone].anexos = [];
                userPurchaseData[phone].anexos.push(localPath);
                await msg.reply('✅ Anexo salvo temporariamente! Deseja adicionar mais algum? (*sim* / *não*)');
            } else {
                await msg.reply('❌ Falha ao salvar o anexo. Tente novamente?');
            }
        } else if (msgBody.toLowerCase() === 'sim') {
            await msg.reply('Ok, aguardando o próximo anexo...');
        } else if (msgBody.toLowerCase() === 'não' || msgBody.toLowerCase() === 'nao') {
            const purchaseInfo = userPurchaseData[phone];
            if (!purchaseInfo || !purchaseInfo.descricao) {
                await msg.reply('❌ A descrição da compra está faltando. Vamos cancelar e tentar de novo.');
                cleanup(phone);
                return;
            }
            const purchaseDetails = await extractPurchaseDetails(purchaseInfo.descricao, phone);
            if (!purchaseDetails || !purchaseDetails.material) {
                await msg.reply('❌ Não consegui entender a descrição da compra. Vamos cancelar e tentar de novo.');
                cleanup(phone);
                return;
            }
            userPurchaseData[phone] = { ...purchaseDetails, anexos: purchaseInfo.anexos || [] };
            userStates[phone] = 'awaiting_confirmation';
            const finalData = userPurchaseData[phone];
            const confirmationText = formatPurchaseDetails(finalData, '🔍 *CONFIRA OS DADOS FINAIS:*') +
                `📎 *Anexos:* ${finalData.anexos.length} arquivo(s) pronto(s) para upload.\n\n` +
                'Os dados estão *corretos*? Responda com *sim* para salvar tudo, ou *não* para corrigir algo.';
            await msg.reply(confirmationText);
        } else {
            await msg.reply('Resposta inválida. Por favor, envie outro anexo ou responda com *sim* ou *não*.');
        }
        return;
    }

    if (userStates[phone] === 'awaiting_confirmation') {
        if (msgBody.toLowerCase() === 'sim' || msgBody.toLowerCase() === 's') {
            await msg.reply('✅ Confirmado! Salvando sua compra e fazendo upload dos anexos...');
            const compraData = userPurchaseData[phone];
            const salvou = await salvarCompraFirebase(client, phone, compraData, name, GRUPO_ID); // <-- LINHA CORRIGIDA
            await msg.reply(salvou ? '✨ *Compra registrada com sucesso no sistema!*' : '❌ Falha ao salvar a compra. Tente novamente.');
            cleanup(phone);
        } else if (msgBody.toLowerCase() === 'não' || msgBody.toLowerCase() === 'nao') {
            userStates[phone] = 'awaiting_purchase_correction';
            await msg.reply('Ok. Por favor, me diga o que precisa ser corrigido (ex: "o valor total é 150 reais").');
        } else {
            await msg.reply('❌ Resposta inválida. Por favor, responda com *sim* ou *não*.');
        }
        return;
    }

    if (userStates[phone] === 'awaiting_purchase_description') {
        userPurchaseData[phone] = { ...userPurchaseData[phone], descricao: msg.body.trim() };
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
                await msg.reply('Anexo recebido. Envie agora a *descrição* da compra (material, valor, etc).');
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
        await msg.reply(`Descrição entendida. ${localPath ? 'Anexo salvo temporariamente. ' : ''}Deseja adicionar mais algum anexo? (*sim* / *não*)`);
        return;
    }

    const lowerCaseMsgBody = msgBody.toLowerCase();

    if (lowerCaseMsgBody === 'listar minhas') {
        cleanup(phone);
        await listPurchases('user');
        return;
    }

    const listRegex = /^1$|^listar$/i;
    if (listRegex.test(lowerCaseMsgBody)) {
        cleanup(phone);
        await listPurchases('group');
        return;
    }

    switch (lowerCaseMsgBody) {
        case '2':
            userStates[phone] = 'awaiting_purchase';
            await msg.reply(
                '🛒 *REGISTRO DE NOVA COMPRA*\n\n' +
                'Para registrar, descreva sua compra por *texto* ou *áudio*.\n\n' +
                'Para adicionar anexos, envie um arquivo e *descreva a compra na legenda*.'
            );
            break;
        case '3':
            await chat.sendStateTyping();
            await exportarComprasParaPlanilha(msg);
            break;
        default:
            if (!userStates[phone]) {
                await chat.sendStateTyping();
                const smartResponse = await processNaturalLanguageQuery(msgBody);
                if (smartResponse) {
                    await msg.reply(smartResponse);
                    return;
                }
                // CORREÇÃO 1: O nome da variável aqui deve ser 'userSessionData'.
                userSessionData[phone] = { chatHistory: [] };

                const initialResponse = await getConversationalResponse([], msgBody);

                log('FALLBACK', `Nenhum comando reconhecido. Iniciando modo de conversa livre para: ${phone}`);
                userStates[phone] = 'free_chat';

                // CORREÇÃO 2: Removido o "user" extra que causava o erro de sintaxe.
                userSessionData[phone].chatHistory.push({ role: 'user', parts: [{ text: msgBody }] });
                userSessionData[phone].chatHistory.push({ role: 'model', parts: [{ text: initialResponse }] });
                await msg.reply(initialResponse);
            }
            break;
    }
}

module.exports = { handleMessage };

// FIM DO ARQUIVO COMPLETO handleMessage.js