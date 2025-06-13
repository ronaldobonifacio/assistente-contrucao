const { db, admin } = require('../config/firebase');
const { uploadLocalFileToCloudinary } = require('./cloudinaryService');
const { log } = require('../utils/logger');
const fs = require('fs');
const { FieldValue } = require('firebase-admin/firestore');

const GRUPO_ID = process.env.FIREBASE_GRUPO_ID || 'grupo1';

/**
 * Salva uma nova compra confirmada no Firestore.
 * AGORA INCLUI o nome do usuário e o ID do grupo.
 * @param {string} phone O número do telefone do usuário.
 * @param {object} compraData Objeto com os detalhes da compra.
 * @param {string} userName O nome do usuário para registro.
 * @param {string} grupoId O ID do grupo ao qual a compra pertence.
 * @returns {Promise<boolean>} Retorna true se a compra foi salva com sucesso.
 */
async function salvarCompraFirebase(phone, compraData, userName, grupoId) {
    const userId = phone.replace('@c.us', '');
    const timestamp = new Date();

    try {
        log('FIREBASE_SAVE', `Iniciando salvamento para o usuário ${userId}`, phone);
        const anexosUrls = [];
        if (compraData.anexos && compraData.anexos.length > 0) {
            for (const localPath of compraData.anexos) {
                const media = MessageMedia.fromFilePath(localPath);
                const url = await uploadMediaToCloudinary(media, phone);
                if (url) anexosUrls.push(url);
            }
        }

        const dadosFinais = {
            ...compraData,
            anexos: anexosUrls,
            userId: userId,
            userName: userName, // <-- NOVO CAMPO
            grupoId: grupoId,   // <-- NOVO CAMPO
            timestamp: timestamp.toISOString()
        };
        delete dadosFinais.descricao; // Remove o campo de descrição bruta

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


async function adicionarAnexoCompraExistente(phone, compraId, anexoUrl) {
    try {
        const telefoneNormalizado = phone.replace('@c.us', '');
        const compraRef = db.collection('grupos').doc(GRUPO_ID).collection('compras').doc(telefoneNormalizado).collection('comprasConfirmadas').doc(compraId);
        await compraRef.update({ anexos: admin.firestore.FieldValue.arrayUnion(anexoUrl) });
        log('FIREBASE-UPDATE', `Anexo adicionado à compra ${compraId}`, phone);
        return true;
    } catch (error) {
        log('FIREBASE-UPDATE-FAIL', `Erro ao adicionar anexo: ${error.message}`, phone);
        return false;
    }
}

/**
 * Edita uma compra existente no Firestore.
 * @param {string} phone O número do telefone do usuário.
 * @param {string} compraId O ID do documento da compra a ser editado.
 * @param {object} novosDados Objeto com os campos e valores a serem atualizados.
 * @returns {Promise<boolean>} Retorna true se a edição foi bem-sucedida, false caso contrário.
 */
async function editarCompraFirebase(phone, compraId, novosDados) {
    const userId = phone.replace('@c.us', '');
    try {
        log('FIREBASE_EDIT', `Iniciando edição da compra ${compraId} para o usuário ${userId}`, phone);

        // Adiciona um timestamp de atualização para rastreamento
        const dadosParaAtualizar = {
            ...novosDados,
            lastUpdated: new Date().toISOString()
        };

        const compraRef = db.collection('grupos').doc(GRUPO_ID)
                              .collection('compras').doc(userId)
                              .collection('comprasConfirmadas').doc(compraId);

        await compraRef.update(dadosParaAtualizar);

        log('FIREBASE_EDIT_SUCCESS', `Compra ${compraId} atualizada com sucesso.`, phone);
        return true;
    } catch (error) {
        log('FIREBASE_EDIT_ERROR', `Erro ao editar compra ${compraId}: ${error.message}`, phone);
        console.error("Erro ao editar compra no Firebase: ", error);
        return false;
    }
}

/**
 * Remove um URL de anexo específico de uma compra no Firestore.
 * @param {string} phone O número do telefone do usuário.
 * @param {string} compraId O ID do documento da compra.
 * @param {string} anexoUrl O URL do anexo a ser removido.
 * @returns {Promise<boolean>} Retorna true se a remoção foi bem-sucedida.
 */
async function removerAnexoCompra(phone, compraId, anexoUrl) {
    const userId = phone.replace('@c.us', '');
    const compraRef = db.collection('grupos').doc(GRUPO_ID)
                          .collection('compras').doc(userId)
                          .collection('comprasConfirmadas').doc(compraId);

    try {
        log('FIREBASE_DELETE_ATTACHMENT', `Removendo anexo ${anexoUrl} da compra ${compraId}`, phone);
        await compraRef.update({
            anexos: FieldValue.arrayRemove(anexoUrl)
        });
        log('FIREBASE_DELETE_ATTACHMENT_SUCCESS', `Anexo removido da compra ${compraId}`, phone);
        // Adicionar lógica para deletar o arquivo do Cloudinary se necessário (mais avançado)
        return true;
    } catch (error) {
        log('FIREBASE_DELETE_ATTACHMENT_ERROR', `Erro ao remover anexo da compra ${compraId}: ${error.message}`, phone);
        console.error("Erro ao remover anexo no Firebase: ", error);
        return false;
    }
}

module.exports = { salvarCompraFirebase, adicionarAnexoCompraExistente,editarCompraFirebase,removerAnexoCompra  };