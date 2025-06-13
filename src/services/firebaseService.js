// ARQUIVO ATUALIZADO: src/services/firebaseService.js

const { db } = require('../config/firebase');
const { uploadMediaToCloudinary } = require('./cloudinaryService');
const { log } = require('../utils/logger');
const { MessageMedia } = require('whatsapp-web.js');
const { FieldValue } = require('firebase-admin/firestore');
const fs = require('fs');

const GRUPO_ID = process.env.FIREBASE_GRUPO_ID || 'grupo1';

async function salvarCompraFirebase(client, phone, compraData, userName, grupoId) {
    const userId = phone.replace('@c.us', '');
    const timestamp = new Date();
    try {
        log('FIREBASE_SAVE', `Iniciando salvamento para ${userId}`, phone);
        const anexosUrls = [];
        if (compraData.anexos && compraData.anexos.length > 0) {
            for (const localPath of compraData.anexos) {
                const media = MessageMedia.fromFilePath(localPath);
                const url = await uploadMediaToCloudinary(media, phone);
                if (url) anexosUrls.push(url);
                fs.unlinkSync(localPath);
            }
        }
        const dadosFinais = {
            ...compraData,
            anexos: anexosUrls,
            userId,
            userName,
            grupoId,
            timestamp: timestamp.toISOString()
        };
        delete dadosFinais.descricao;
        await db.collection('grupos').doc(grupoId).collection('compras').doc(userId).collection('comprasConfirmadas').add(dadosFinais);
        log('FIREBASE_SAVE_SUCCESS', `Compra salva para ${userId}`, phone);
        await verificarEAlertarOrcamento(client, phone, dadosFinais.category);
        return true;
    } catch (error) {
        log('FIREBASE_SAVE_ERROR', `Erro ao salvar compra: ${error.message}`, phone);
        return false;
    }
}

async function adicionarAnexoCompraExistente(userId, compraId, anexoUrl) {
    try {
        const compraRef = db.collection('grupos').doc(GRUPO_ID).collection('compras').doc(userId).collection('comprasConfirmadas').doc(compraId);
        await compraRef.update({ anexos: FieldValue.arrayUnion(anexoUrl) });
        return true;
    } catch (error) { return false; }
}

async function editarCompraFirebase(userId, compraId, novosDados) {
    try {
        const dadosParaAtualizar = { ...novosDados, lastUpdated: new Date().toISOString() };
        const compraRef = db.collection('grupos').doc(GRUPO_ID).collection('compras').doc(userId).collection('comprasConfirmadas').doc(compraId);
        await compraRef.update(dadosParaAtualizar);
        return true;
    } catch (error) { return false; }
}

async function excluirCompraFirebase(userId, compraId) {
    try {
        const compraRef = db.collection('grupos').doc(GRUPO_ID).collection('compras').doc(userId).collection('comprasConfirmadas').doc(compraId);
        await compraRef.delete();
        return true;
    } catch (error) { return false; }
}

async function setBudget(type, value, category = null) {
    try {
        const budgetRef = db.collection('grupos').doc(GRUPO_ID).collection('orcamento').doc('config');
        let budgetData = {};
        if (type === 'total') {
            budgetData = { total: value, lastUpdated: new Date().toISOString() };
        } else if (type === 'category' && category) {
            budgetData = { [`categories.${category}`]: value, lastUpdated: new Date().toISOString() };
        } else { return false; }
        await budgetRef.set(budgetData, { merge: true });
        return true;
    } catch (error) { return false; }
}

async function getBudgetAndSpending() {
    try {
        const budgetRef = db.collection('grupos').doc(GRUPO_ID).collection('orcamento').doc('config');
        const budgetDoc = await budgetRef.get();
        const budgetData = budgetDoc.exists ? budgetDoc.data() : { total: 0, categories: {} };
        const snapshot = await db.collectionGroup('comprasConfirmadas').where('grupoId', '==', GRUPO_ID).get();
        let totalSpending = 0;
        const categorySpending = {};
        snapshot.forEach(doc => {
            const compra = doc.data();
            totalSpending += compra.valor_total || 0;
            if (compra.category) {
                categorySpending[compra.category] = (categorySpending[compra.category] || 0) + (compra.valor_total || 0);
            }
        });
        return { budget: budgetData, spending: { total: totalSpending, byCategory: categorySpending } };
    } catch (error) { return null; }
}

async function verificarEAlertarOrcamento(client, phone, category) {
    if (!category) return;
    const data = await getBudgetAndSpending();
    if (!data || !data.budget.categories || !data.budget.categories[category]) return;

    const budgetCategory = data.budget.categories[category];
    const spendingCategory = data.spending.byCategory[category] || 0;
    const percentage = (spendingCategory / budgetCategory) * 100;

    let alertMessage = null;
    if (percentage >= 100) {
        alertMessage = `🚨 *ALERTA DE ORÇAMENTO ESTOURADO* 🚨\n\nVocê ultrapassou o orçamento para a categoria *${category}*.\n\n*Orçamento:* R$ ${budgetCategory.toFixed(2)}\n*Gasto Atual:* R$ ${spendingCategory.toFixed(2)} (${percentage.toFixed(0)}%)`;
    } else if (percentage >= 80) {
        alertMessage = `⚠️ *AVISO DE ORÇAMENTO* ⚠️\n\nVocê já utilizou *${percentage.toFixed(0)}%* do seu orçamento para a categoria *${category}*.\n\n*Orçamento:* R$ ${budgetCategory.toFixed(2)}\n*Gasto Atual:* R$ ${spendingCategory.toFixed(2)}`;
    }

    if (alertMessage) {
        await client.sendMessage(phone, alertMessage);
        log('BUDGET_ALERT', `Alerta de ${percentage.toFixed(0)}% enviado para ${phone} na categoria ${category}`);
    }
}

module.exports = { salvarCompraFirebase, adicionarAnexoCompraExistente, editarCompraFirebase, excluirCompraFirebase, setBudget, getBudgetAndSpending };