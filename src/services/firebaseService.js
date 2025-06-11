const { db, admin } = require('../config/firebase');
const { uploadLocalFileToCloudinary } = require('./cloudinaryService');
const { log } = require('../utils/logger');
const fs = require('fs');

const GRUPO_ID = process.env.FIREBASE_GRUPO_ID || 'grupo1';

async function salvarCompraFirebase(phone, compraData) {
    try {
        const localPaths = compraData.anexos || [];
        const cloudUrls = [];

        for (const localPath of localPaths) {
            const cloudUrl = await uploadLocalFileToCloudinary(localPath, phone);
            if (cloudUrl) cloudUrls.push(cloudUrl);
        }

        const telefoneNormalizado = phone.replace('@c.us', '');
        const comprasConfirmadasRef = db.collection('grupos').doc(GRUPO_ID).collection('compras').doc(telefoneNormalizado).collection('comprasConfirmadas');
        
        const compraComTimestamp = { ...compraData, anexos: cloudUrls, timestamp: new Date().toISOString() };
        await comprasConfirmadasRef.add(compraComTimestamp);
        log('FIREBASE-SAVE', 'Compra salva com sucesso', phone);

        localPaths.forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p) });
        return true;
    } catch (error) {
        log('FIREBASE-SAVE-FAIL', `Erro ao salvar: ${error.message}`, phone);
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

module.exports = { salvarCompraFirebase, adicionarAnexoCompraExistente };