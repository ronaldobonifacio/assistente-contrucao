const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { MessageMedia } = require('whatsapp-web.js');
const { db } = require('../config/firebase');
const { log } = require('../utils/logger');

const tempDir = './temp_uploads';
const GRUPO_ID = process.env.FIREBASE_GRUPO_ID || 'grupo1';

async function salvarAnexoLocalmente(media, phone) {
    try {
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
        const fileBuffer = Buffer.from(media.data, 'base64');
        const fileExtension = media.mimetype.split('/')[1] || 'tmp';
        const filename = `${phone.replace('@c.us', '')}_${Date.now()}.${fileExtension}`;
        const filePath = path.join(tempDir, filename);
        fs.writeFileSync(filePath, fileBuffer);
        log('LOCAL-SAVE', `Arquivo salvo localmente em: ${filePath}`, phone);
        return filePath;
    } catch (error) {
        log('LOCAL-SAVE-FAIL', `Erro ao salvar localmente: ${error.message}`, phone);
        return null;
    }
}

async function exportarComprasParaPlanilha(phone, msg) {
    const telefoneNormalizado = phone.replace('@c.us', '');
    const snapshot = await db.collection('grupos').doc(GRUPO_ID).collection('compras').doc(telefoneNormalizado).collection('comprasConfirmadas').orderBy('timestamp', 'desc').get();
    if (snapshot.empty) {
        await msg.reply('Você não possui compras para exportar.');
        return;
    }
    const compras = snapshot.docs.map(doc => doc.data());
    const wsData = [
        ['Material', 'Quantidade', 'Valor Unitário', 'Valor Total', 'Data', 'Categoria', 'Local', 'Anexos'],
        ...compras.map(c => [c.material || '', c.quantidade || '', c.valor_unitario || '', c.valor_total || '', c.data || '', c.categoria || '', c.local || '', (c.anexos || []).join(', ')])
    ];
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet(wsData);
    xlsx.utils.book_append_sheet(wb, ws, 'Compras');
    const filename = `compras_${phone.replace('@c.us', '')}.xlsx`;
    xlsx.writeFile(wb, filename);
    const media = MessageMedia.fromFilePath(filename);
    await msg.reply(media);
    fs.unlinkSync(filename);
    log('PLANILHA', 'Planilha enviada com sucesso', phone);
}

module.exports = { salvarAnexoLocalmente, exportarComprasParaPlanilha };