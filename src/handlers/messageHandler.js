// INÍCIO DO ARQUIVO COMPLETO handleMessage.js

const { db } = require('../config/firebase');
const { salvarCompraFirebase, adicionarAnexoCompraExistente, editarCompraFirebase, removerAnexoCompra } = require('../services/firebaseService');
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
const PAGE_SIZE = 5; // Número de compras por página

// Função auxiliar para enviar o menu principal e evitar repetição de código
async function sendMainMenu(msg, name) {
    const menuText = `👷‍♂️ Olá *${name.split(" ")[0]}*! Sou seu assistente de compras para a obra.\n\n` +
        '*Como posso te ajudar hoje?*\n\n' +
        '1️⃣ - Listar minhas compras\n' +
        '2️⃣ - Adicionar nova compra\n' +
        '3️⃣ - Exportar para planilha\n\n' +
        'Digite o *número* da opção desejada ou me faça uma pergunta como "quanto gastei com cimento?".';
    await msg.reply(menuText);
}

// Função auxiliar para formatar os detalhes de uma compra para exibição
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

// NOVA FUNÇÃO: Formata a comparação entre a compra antiga e a nova, destacando as mudanças
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

// NOVO HANDLER: Lida com perguntas financeiras específicas
async function handleFinancialQuery(phone, msgBody) {
    const match = msgBody.match(/quanto gastei com|total de/i);
    if (!match) return null;

    const material = msgBody.substring(match.index + match[0].length).trim().replace('?', '');
    if (!material) return null;

    let totalGasto = 0;
    const snapshot = await db.collection('grupos').doc(GRUPO_ID).collection('compras').doc(phone.replace('@c.us', '')).collection('comprasConfirmadas').get();
    
    if (snapshot.empty) {
        return `Não encontrei nenhum gasto registrado para *${material}*.`;
    }

    snapshot.docs.forEach(doc => {
        const compra = doc.data();
        if (compra.material && compra.material.toLowerCase().includes(material.toLowerCase())) {
            totalGasto += compra.valor_total || 0;
        }
    });

    if (totalGasto > 0) {
        return `Até agora, você gastou um total de *R$ ${totalGasto.toFixed(2)}* com *${material}*.`;
    } else {
        return `Não encontrei nenhum gasto registrado para *${material}*.`;
    }
}


async function handleMessage(msg) {
    const phone = msg.from;
    const chat = await msg.getChat();
    const contact = await msg.getContact();
    const name = contact.pushname || 'Sem nome';
    let msgBody = msg.body.trim();

    const listPurchases = async (phone, msg, nextPage = false) => {
        await chat.sendStateTyping();
        const userId = phone.replace('@c.us', '');
        let query = db.collection('grupos').doc(GRUPO_ID).collection('compras').doc(userId).collection('comprasConfirmadas');

        const searchTerm = userSessionData[phone]?.searchTerm;
        
        query = query.orderBy('timestamp', 'desc');

        const snapshot = await query.get();

        let allDocs = snapshot.docs;
        if(searchTerm) {
            allDocs = snapshot.docs.filter(doc => doc.data().material?.toLowerCase().includes(searchTerm.toLowerCase()));
        }
        
        const page = userSessionData[phone]?.page || 1;
        const startIndex = (page - 1) * PAGE_SIZE;
        const paginatedDocs = allDocs.slice(startIndex, startIndex + PAGE_SIZE);

        if (paginatedDocs.length === 0 && page === 1) {
            let reply = 'Você ainda não possui compras registradas.';
            if (searchTerm) reply = `Nenhuma compra encontrada para o termo "*${searchTerm}*".`;
            await msg.reply(reply);
            cleanup(phone);
            return;
        }
        if (paginatedDocs.length === 0 && page > 1) {
            await msg.reply('Não há mais compras para mostrar.');
            await delay(500);
            await msg.reply(
                'O que você deseja fazer?\n\n' +
                '*A* - Ver anexos de uma compra\n' +
                '*B* - Anexar novo documento\n' +
                '*C* - Editar uma compra\n' +
                '*D* - Remover anexo de uma compra\n\n' +
                '_(Responda com a letra ou digite "cancelar")_'
            );
            userStates[phone] = 'awaiting_list_action';
            return;
        }
        
        const compras = paginatedDocs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (page === 1) {
            userSessionData[phone].compras = compras;
        } else {
            userSessionData[phone].compras.push(...compras);
        }
        userSessionData[phone].page = page;

        let resposta = page === 1 ? `🧾 *Suas compras registradas${searchTerm ? ` para "${searchTerm}"` : ''}:*\n\n` : '';

        compras.forEach((compra) => {
            const index = userSessionData[phone].compras.findIndex(c => c.id === compra.id);
            resposta += `*${index + 1}.* -----\n` +
                `  *Material:* ${compra.material || 'N/A'}\n` +
                (compra.data ? `  *Data:* ${compra.data}\n` : '') +
                (compra.valor_total ? `  *V. Total:* R$ ${compra.valor_total.toFixed(2)}\n` : '') +
                `  *Anexos:* ${compra.anexos ? compra.anexos.length : 0}\n\n`;
        });

        await msg.reply(resposta);

        if (startIndex + paginatedDocs.length >= allDocs.length) {
            await delay(500);
            await msg.reply(
                'O que você deseja fazer?\n\n' +
                '*A* - Ver anexos de uma compra\n' +
                '*B* - Anexar novo documento\n' +
                '*C* - Editar uma compra\n' +
                '*D* - Remover anexo de uma compra\n\n' +
                '_(Responda com a letra ou digite "cancelar")_'
            );
            userStates[phone] = 'awaiting_list_action';
        } else {
            userSessionData[phone].page++;
            await msg.reply(`Mostrando página ${page}. Digite *"mais"* para ver as próximas.`);
            userStates[phone] = 'awaiting_more_purchases';
        }
    }


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

    if (userStates[phone] === 'awaiting_more_purchases') {
        if (msgBody.toLowerCase() === 'mais') {
             await listPurchases(phone, msg, true);
        } else {
            await msg.reply('Comando inválido. Digite "mais" para ver o restante ou "cancelar" para voltar ao menu.');
        }
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
        const compra = userSessionData[phone].compraParaInteragir;
        const index = parseInt(msgBody, 10) - 1;

        if (isNaN(index) || index < 0 || index >= compra.anexos.length) {
            await msg.reply('❌ Número inválido. Por favor, digite um número da lista de anexos.');
            return;
        }

        const anexoParaRemover = compra.anexos[index];
        await msg.reply(`Removendo o anexo...`);

        const sucesso = await removerAnexoCompra(phone, compra.id, anexoParaRemover);
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
        } else if (action === 'edit_purchase') {
            userSessionData[phone].compraParaEditar = compraSelecionada;
            userStates[phone] = 'awaiting_purchase_edit_description';
            const originalDetails = formatPurchaseDetails(compraSelecionada, '📝 *ESTES SÃO OS DADOS ATUAIS DA COMPRA:*');
            await msg.reply(originalDetails);
            await delay(1000);
            await msg.reply('Por favor, envie uma mensagem de texto ou um áudio descrevendo *como a compra deve ficar* (ex: "o material é 10 sacos de cimento, valor total 250 reais, comprado na Leroy").');
        } else if (action === 'delete_attachment') {
            userSessionData[phone].compraParaInteragir = compraSelecionada;
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
            await msg.reply('❌ Não consegui entender a descrição. Por favor, envie um texto ou áudio com os novos dados da compra.');
            return;
        }
        
        await msg.reply('Analisando as alterações...');
        const novosDadosParciais = await extractPurchaseDetails(textoEdicao, phone);
        const compraOriginal = userSessionData[phone].compraParaEditar;

        const dadosParaAtualizar = Object.keys(novosDadosParciais).reduce((acc, key) => {
            if (novosDadosParciais[key]) { 
                acc[key] = novosDadosParciais[key];
            }
            return acc;
        }, {});
        
        if (Object.keys(dadosParaAtualizar).length === 0) {
            await msg.reply('❌ Desculpe, não consegui identificar nenhuma informação para alterar na sua mensagem. Por favor, tente novamente (ex: "alterar o valor total para 50 reais").');
            return;
        }

        const dadosFinais = {
            ...compraOriginal,
            ...dadosParaAtualizar,
        };

        userSessionData[phone].dadosEditados = dadosFinais;

        const previewText = formatPurchaseComparison(compraOriginal, dadosFinais, '*PREVIEW DA EDIÇÃO*') +
            '\nAs alterações estão *corretas*? Responda com *sim* para confirmar e salvar.';
            
        await msg.reply(previewText);
        userStates[phone] = 'awaiting_edit_confirmation';
        return;
    }
    
    if (userStates[phone] === 'awaiting_edit_confirmation') {
        if (msgBody.toLowerCase() === 'sim' || msgBody.toLowerCase() === 's') {
            await msg.reply('✅ Confirmado! Salvando as alterações...');
            const compraId = userSessionData[phone].compraParaEditar.id;
            const novosDados = userSessionData[phone].dadosEditados;
            
            delete novosDados.id;

            const sucesso = await editarCompraFirebase(phone, compraId, novosDados);

            if (sucesso) {
                await msg.reply('✨ *Compra atualizada com sucesso no sistema!*');
            } else {
                await msg.reply('❌ Falha ao atualizar a compra. Por favor, tente novamente mais tarde.');
            }
        } else {
            await msg.reply('Ok, edição descartada.');
        }
        cleanup(phone);
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
        } else if (action === 'c') {
            userSessionData[phone].action = 'edit_purchase';
            userStates[phone] = 'awaiting_purchase_number';
            await msg.reply('Qual o *número* da compra que você deseja *editar*?');
        } else if (action === 'd') {
            userSessionData[phone].action = 'delete_attachment';
            userStates[phone] = 'awaiting_purchase_number';
            await msg.reply('De qual *número* de compra você quer remover um anexo?');
        } else {
            await msg.reply('Opção inválida. Responda com *A*, *B*, *C* ou *D*.');
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
            await msg.reply('✅ Confirmado! Salvando sua compra e fazendo upload dos anexos. Isso pode levar um momento...');
            const compraData = userPurchaseData[phone];
            const salvou = await salvarCompraFirebase(phone, compraData);
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
    const listRegex = /^1$|^listar(.*)/i;
    
    if (listRegex.test(lowerCaseMsgBody)) {
        const match = lowerCaseMsgBody.match(listRegex);
        const searchTerm = match[1] ? match[1].trim() : null;
        userSessionData[phone] = { searchTerm: searchTerm, page: 1 };
        await listPurchases(phone, msg);
        return;
    }

    switch (lowerCaseMsgBody) {
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
                const financialResponse = await handleFinancialQuery(phone, msgBody);
                if (financialResponse) {
                    await msg.reply(financialResponse);
                    return;
                }

                log('FALLBACK', `Nenhum comando reconhecido. Iniciando modo de conversa livre para: ${phone}`);
                userStates[phone] = 'free_chat';
                
                // =========================================================================================
                // CORREÇÃO: Adicionando a inicialização do histórico de chat que estava faltando.
                // =========================================================================================
                userSessionData[phone] = { chatHistory: [] };

                await chat.sendStateTyping();
                const initialResponse = await getConversationalResponse([], msgBody);
                
                // Agora é seguro usar o userSessionData[phone]
                userSessionData[phone].chatHistory.push({ role: 'user', parts: [{ text: msgBody }] });
                userSessionData[phone].chatHistory.push({ role: 'model', parts: [{ text: initialResponse }] });
                await msg.reply(initialResponse);
             }
            break;
    }
}

module.exports = { handleMessage };

// FIM DO ARQUIVO COMPLETO handleMessage.js