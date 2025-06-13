// ARQUIVO NOVO: services/geminiQueryService.js

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { db } = require('../config/firebase');
const { log } = require('../utils/logger');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GRUPO_ID = process.env.FIREBASE_GRUPO_ID || 'grupo1';

// 1. Definição da nossa "caixa de ferramentas" que o Gemini pode usar
const tools = [
  {
    functionDeclarations: [
      {
        name: 'getPurchaseData',
        description: 'Busca dados de compras no banco de dados com base em filtros como material, nome do comprador e período.',
        parameters: {
          type: 'OBJECT',
          properties: {
            material: {
              type: 'STRING',
              description: 'O nome do material ou produto a ser buscado. Ex: "cimento", "areia", "tijolos".',
            },
            userName: {
              type: 'STRING',
              description: 'O nome do usuário que fez a compra. Ex: "Ronaldo", "Maria".',
            },
            period: {
                type: 'STRING',
                description: 'O período de tempo da busca. Pode ser "hoje", "ontem", "esta semana", "este mês", "este ano" ou um mês específico como "junho".',
            }
          },
        },
      },
    ],
  },
];

// 2. A função que realmente executa a busca no Firestore
async function getPurchaseData({ material, userName, period }) {
    log('GEMINI_TOOL_EXEC', `Executando busca com: material=${material}, userName=${userName}, period=${period}`);
  
    let query = db.collectionGroup('comprasConfirmadas').where('grupoId', '==', GRUPO_ID);

    if (material) {
        // O Firestore não suporta busca por "contains" diretamente em queries complexas.
        // A busca por material será feita após a consulta inicial.
    }
    if (userName) {
        query = query.where('userName', '==', userName);
    }

    // Lógica de período (simplificada)
    if (period) {
        const now = new Date();
        let startDate;
        if (period.toLowerCase() === 'hoje') {
            startDate = new Date(now.setHours(0, 0, 0, 0));
        } else if (period.toLowerCase() === 'este mês') {
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        } else if (period.toLowerCase() === 'este ano') {
            startDate = new Date(now.getFullYear(), 0, 1);
        }
        // Adicionar mais lógicas de período se necessário (semana, mês específico, etc.)

        if(startDate) {
            query = query.where('timestamp', '>=', startDate.toISOString());
        }
    }
  
    const snapshot = await snapshot.get();

    if (snapshot.empty) {
        return { totalAmount: 0, count: 0, purchases: [] };
    }

    let docs = snapshot.docs;
    // Filtro final por material, se especificado
    if(material) {
        docs = docs.filter(doc => doc.data().material?.toLowerCase().includes(material.toLowerCase()));
    }

    const purchases = docs.map(doc => doc.data());
    const totalAmount = purchases.reduce((sum, p) => sum + (p.valor_total || 0), 0);

    return {
        totalAmount: totalAmount,
        count: purchases.length,
        purchases: purchases.map(p => p.material) // Retorna só os nomes para não sobrecarregar
    };
}


// 3. O orquestrador principal que conversa com o Gemini
async function processNaturalLanguageQuery(prompt) {
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-pro', tools });
        const chat = model.startChat();

        const result = await chat.sendMessage(prompt);
        const response = result.response;
        const call = response.functionCalls?.[0];

        if (call) {
            log('GEMINI_FUNCTION_CALL', `Gemini solicitou chamada para: ${call.name}`);
            
            // Chama a nossa função segura com os argumentos que o Gemini extraiu
            const data = await getPurchaseData(call.args);
            
            // Envia o resultado de volta para o Gemini para ele gerar a resposta final
            const result2 = await chat.sendMessage([
                {
                    functionResponse: {
                        name: 'getPurchaseData',
                        response: data,
                    },
                },
            ]);
            const finalResponse = result2.response.text();
            log('GEMINI_FINAL_RESPONSE', `Resposta final gerada: ${finalResponse}`);
            return finalResponse;
        } else if (response.text()) {
             // Se não for uma chamada de função, pode ser uma conversa normal
             // mas aqui retornamos nulo para deixar o handler principal decidir o que fazer.
             return null;
        }
        return null;

    } catch (error) {
        log('GEMINI_QUERY_ERROR', `Erro ao processar pergunta: ${error.message}`);
        console.error('Erro no geminiQueryService:', error);
        return 'Desculpe, tive um problema ao tentar entender sua pergunta.';
    }
}

module.exports = { processNaturalLanguageQuery };