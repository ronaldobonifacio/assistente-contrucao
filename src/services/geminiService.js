const { geminiTextModel,genAI } = require('../config/gemini');
const { log } = require('../utils/logger');

async function transcreverAudioComGemini(media) {
    const audioPart = { inlineData: { data: media.data, mimeType: media.mimetype } };
    const prompt = "Transcreva este áudio em texto. Responda apenas com a transcrição completa.";
    const result = await geminiTextModel.generateContent([prompt, audioPart]);
    return result.response.text().trim();
}

async function extractPurchaseDetails(userMessage, phone) {
    try {
        const prompt = `Extraia dados de compra de materiais de construção da mensagem: "${userMessage}". O campo "material" é obrigatório. Calcule o valor_total se possível. Retorne APENAS um objeto JSON válido, sem markdown. Formato: {"material":"","quantidade":,"valor_total":,"valor_unitario":,"local":"","categoria":"","data":"${new Date().toLocaleDateString('pt-BR')}"}`;
        const result = await geminiTextModel.generateContent(prompt);
        const jsonText = result.response.text().replace(/```json|```/g, '').trim();
        log('GEMINI-EXTRACT', `Dados extraídos: ${jsonText}`, phone);
        return JSON.parse(jsonText);
    } catch (error) {
        log('GEMINI-EXTRACT-FAIL', `Erro na extração: ${error.message}`, phone);
        return null;
    }
}

async function getConversationalResponse(chatHistory, newMessage) {
    // CORREÇÃO: A instrução do sistema é passada diretamente na configuração do modelo.
    const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash-latest",
        systemInstruction: "Você é um assistente virtual de uma loja de materiais de construção. Seu nome é Drem. Responda de forma prestativa, amigável e concisa. Se o usuário quiser voltar ao menu, ajude-o.",
    });

    // O histórico agora é 'puro', contendo apenas a troca de mensagens user/model.
    const chat = model.startChat({
        history: chatHistory,
    });

    const result = await chat.sendMessage(newMessage);
    const response = await result.response;
    const text = response.text();
    return text;
}
// Não se esqueça de exportar a nova função
module.exports = { transcreverAudioComGemini, extractPurchaseDetails, getConversationalResponse };