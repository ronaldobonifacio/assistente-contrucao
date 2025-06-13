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
/**
 * Exporta TODAS as compras do GRUPO para uma planilha XLSX e a envia ao usuário.
 * @param {object} msg O objeto da mensagem original do whatsapp-web.js para responder.
 */
async function exportarComprasParaPlanilha(msg) {
    log('EXPORT', 'Iniciando exportação de planilha para o grupo.', msg.from);
    await msg.reply('Gerando sua planilha com as compras de todo o grupo... 📊');

    try {
        // 1. Buscar todas as compras do grupo no Firestore
        const snapshot = await db.collectionGroup('comprasConfirmadas')
                                 .where('grupoId', '==', GRUPO_ID)
                                 .orderBy('timestamp', 'desc')
                                 .get();

        if (snapshot.empty) {
            await msg.reply('Não há compras registradas no grupo para exportar.');
            return;
        }

        // 2. Mapear os dados para um formato simples
        const dadosParaPlanilha = snapshot.docs.map(doc => {
            const compra = doc.data();
            return {
                'Data': compra.data || 'N/A',
                'Material': compra.material || 'N/A',
                'Quantidade': compra.quantidade || 'N/A',
                'Valor Unitário': compra.valor_unitario || 0,
                'Valor Total': compra.valor_total || 0,
                'Local': compra.local || 'N/A',
                'Comprador': compra.userName || 'N/A',
                'Nº de Anexos': compra.anexos ? compra.anexos.length : 0,
            };
        });

        // 3. Criar a planilha em memória
        const worksheet = xlsx.utils.json_to_sheet(dadosParaPlanilha);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Compras da Obra');

        // Formatar colunas de valor como moeda
        worksheet['!cols'] = [
            { wch: 12 }, { wch: 40 }, { wch: 12 }, 
            { z: 'R$ #,##0.00', wch: 15 }, 
            { z: 'R$ #,##0.00', wch: 15 }, 
            { wch: 25 }, { wch: 20 }, { wch: 12 }
        ];

        // 4. Salvar o arquivo temporariamente
        const filePath = `./relatorio_obra_${Date.now()}.xlsx`;
        xlsx.writeFile(workbook, filePath);

        // 5. Enviar o arquivo e depois deletá-lo
        const media = MessageMedia.fromFilePath(filePath);
        await msg.reply(media);

        fs.unlinkSync(filePath); // Deleta o arquivo local após o envio
        log('EXPORT', 'Planilha enviada e arquivo temporário removido.', msg.from);

    } catch (error) {
        log('EXPORT_ERROR', `Falha ao gerar planilha: ${error.message}`, msg.from);
        console.error('Erro ao exportar para planilha:', error);
        await msg.reply('❌ Ocorreu um erro ao gerar a planilha. Tente novamente mais tarde.');
    }
}

module.exports = { salvarAnexoLocalmente, exportarComprasParaPlanilha };