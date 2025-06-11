const { db } = require('../config/firebase');
const { genAI } = require('../config/gemini');
const { cloudinary } = require('../config/cloudinary');
const { log } = require('./logger');

const GRUPO_ID = process.env.FIREBASE_GRUPO_ID || 'grupo1';

async function verificarFirebase() {
    try {
        const doc = await db.collection('grupos').doc(GRUPO_ID).get();
        return doc.exists
            ? `✅ Firebase: Conexão OK | Grupo encontrado: ${GRUPO_ID}`
            : `⚠️ Firebase: Conexão OK, mas grupo ${GRUPO_ID} não encontrado.`;
    } catch (error) {
        return `❌ Firebase: FALHA na conexão - ${error.message}`;
    }
}

async function verificarGemini() {
    try {
        await genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" }).generateContent("ok");
        return '✅ Gemini: Conexão com a API OK.';
    } catch (error) {
        return `❌ Gemini: FALHA na conexão - ${error.message}`;
    }
}

async function verificarCloudinary() {
    try {
        const result = await cloudinary.api.ping();
        return result.status === 'ok'
            ? '✅ Cloudinary: Conexão com a API OK.'
            : `⚠️ Cloudinary: Conexão com problemas - Status: ${result.status}`;
    } catch (error) {
        return `❌ Cloudinary: FALHA na conexão - Verifique suas credenciais.`;
    }
}

async function iniciarVerificacoes() {
    console.log('\n=============================================');
    log('SYSTEM-CHECK', 'Iniciando verificação de serviços...');
    
    const results = await Promise.allSettled([
        verificarFirebase(),
        verificarGemini(),
        verificarCloudinary()
    ]);

    results.forEach(result => {
        if (result.status === 'fulfilled') {
            console.log(result.value);
        } else {
            console.error(result.reason);
        }
    });

    console.log('=============================================\n');
}

module.exports = { iniciarVerificacoes };