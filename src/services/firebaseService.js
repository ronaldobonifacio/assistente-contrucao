// ARQUIVO COMPLETO E CORRIGIDO: firebaseService.js

const { db } = require('../config/firebase');
const { uploadMediaToCloudinary } = require('./cloudinaryService'); // Assumindo que essa função lida com o objeto de mídia
const { log } = require('../utils/logger');
const { MessageMedia } = require('whatsapp-web.js'); // Necessário para fromFilePath
const { FieldValue } = require('firebase-admin/firestore');
const fs = require('fs');

const GRUPO_ID = process.env.FIREBASE_GRUPO_ID || 'grupo1';

async function salvarCompraFirebase(phone, compraData, userName, grupoId) {
    const userId = phone.replace('@c.us', '');
    const timestamp = new Date();

    try {
        log('FIREBASE_SAVE', `Iniciando salvamento para o usuário ${userId}`, phone);
        const anexosUrls = [];
        if (compraData.anexos && compraData.anexos.length > 0) {
            for (const localPath of compraData.anexos) {
                // A conversão para MessageMedia deve ocorrer aqui, pois o serviço recebe o caminho
                const media = MessageMedia.fromFilePath(localPath);
                const url = await uploadMediaToCloudinary(media, phone);
                if (url) anexosUrls.push(url);
            }
        }

        const dadosFinais = {
            ...compraData,
            anexos: anexosUrls,
            userId: userId,
            userName: userName,
            grupoId: grupoId,
            timestamp: timestamp.toISOString()
        };
        delete dadosFinais.descricao;

        await db.collection('grupos').doc(grupoId)
                .collection('compras').doc(userId)
                .collection('comprasConfirmadas').add(dadosFinais);

        log('FIREBASE_SAVE_SUCCESS', `Compra salva com sucesso para ${userId}`, phone);
        return true;

    } catch (error) {
        log('FIREBASE_SAVE_ERROR', `Erro ao salvar compra para ${userId}: ${error.message}`, phone);
        console.error("Erro ao salvar compra no Firebase: ", error);
        return false;
    }
}

// CORREÇÃO: Padronizado para usar FieldValue importado e receber userId
async function adicionarAnexoCompraExistente(userId, compraId, anexoUrl) {
    try {
        const compraRef = db.collection('grupos').doc(GRUPO_ID).collection('compras').doc(userId).collection('comprasConfirmadas').doc(compraId);
        await compraRef.update({ anexos: FieldValue.arrayUnion(anexoUrl) });
        log('FIREBASE-UPDATE', `Anexo adicionado à compra ${compraId}`, userId);
        return true;
    } catch (error) {
        log('FIREBASE-UPDATE-FAIL', `Erro ao adicionar anexo: ${error.message}`, userId);
        return false;
    }
}

// CORREÇÃO: Alterado para receber userId em vez de phone, para alinhar com a chamada
async function editarCompraFirebase(userId, compraId, novosDados) {
    try {
        log('FIREBASE_EDIT', `Iniciando edição da compra ${compraId} para o usuário ${userId}`, userId);
        const dadosParaAtualizar = {
            ...novosDados,
            lastUpdated: new Date().toISOString()
        };
        const compraRef = db.collection('grupos').doc(GRUPO_ID)
                              .collection('compras').doc(userId)
                              .collection('comprasConfirmadas').doc(compraId);
        await compraRef.update(dadosParaAtualizar);
        log('FIREBASE_EDIT_SUCCESS', `Compra ${compraId} atualizada com sucesso.`, userId);
        return true;
    } catch (error) {
        log('FIREBASE_EDIT_ERROR', `Erro ao editar compra ${compraId}: ${error.message}`, userId);
        console.error("Erro ao editar compra no Firebase: ", error);
        return false;
    }
}

// CORREÇÃO: Alterado para receber userId em vez de phone, para alinhar com a chamada
async function removerAnexoCompra(userId, compraId, anexoUrl) {
    const compraRef = db.collection('grupos').doc(GRUPO_ID)
                          .collection('compras').doc(userId)
                          .collection('comprasConfirmadas').doc(compraId);
    try {
        log('FIREBASE_DELETE_ATTACHMENT', `Removendo anexo ${anexoUrl} da compra ${compraId}`, userId);
        await compraRef.update({
            anexos: FieldValue.arrayRemove(anexoUrl)
        });
        log('FIREBASE_DELETE_ATTACHMENT_SUCCESS', `Anexo removido da compra ${compraId}`, userId);
        return true;
    } catch (error) {
        log('FIREBASE_DELETE_ATTACHMENT_ERROR', `Erro ao remover anexo da compra ${compraId}: ${error.message}`, userId);
        console.error("Erro ao remover anexo no Firebase: ", error);
        return false;
    }
}

module.exports = { salvarCompraFirebase, adicionarAnexoCompraExistente, editarCompraFirebase, removerAnexoCompra };