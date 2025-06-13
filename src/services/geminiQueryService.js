// ARQUIVO ATUALIZADO E CORRIGIDO: services/geminiQueryService.js

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { db } = require('../config/firebase');
const { log } = require('../utils/logger');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GRUPO_ID = process.env.FIREBASE_GRUPO_ID || 'grupo1';

const tools = [
  {
    functionDeclarations: [
      {
        name: 'getPurchaseData',
        description: 'Busca dados de compras de uma obra no banco de dados com base em filtros como material, nome do comprador e período de tempo.',
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

async function getPurchaseData({ material, userName, period }) {
    log('GEMINI_TOOL_EXEC', `Executando busca com: material=${material}, userName=${userName}, period=${period}`);
  
    const query = db.collectionGroup('comprasConfirmadas')
                    .where('grupoId', '==', GRUPO_ID)
                    .orderBy('timestamp', 'desc');
  
    const snapshot = await query.get();

    if (snapshot.empty) {
        return { totalAmount: 0, count: 0, purchases: [] };
    }

    let allPurchases = snapshot.docs.map(doc => doc.data());

    if (material) {
        allPurchases = allPurchases.filter(p => p.material?.toLowerCase().includes(material.toLowerCase()));
    }
    if (userName) {
        const nameCapitalized = userName.charAt(0).toUpperCase() + userName.slice(1).toLowerCase();
        allPurchases = allPurchases.filter(p => p.userName === nameCapitalized);
    }
    if (period) {
        const now = new Date();
        let startDate;
        if (period.toLowerCase() === 'hoje') {
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (period.toLowerCase() === 'este mês') {
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        } else if (period.toLowerCase() === 'este ano') {
            startDate = new Date(now.getFullYear(), 0, 1);
        }
        if(startDate) {
            allPurchases = allPurchases.filter(p => new Date(p.timestamp) >= startDate);
        }
    }

    const totalAmount = allPurchases.reduce((sum, p) => sum + (p.valor_total || 0), 0);

    return {
        totalAmount: totalAmount,
        count: allPurchases.length,
        purchases: allPurchases.map(p => ({
            material: p.material,
            valor_total: p.valor_total,
            data: p.data,
            userName: p.userName,
            quantidade: p.quantidade
        }))
    };
}

async function processNaturalLanguageQuery(prompt) {
    try {
        log('GEMINI_QUERY_START', `Processando prompt: "${prompt}"`);
        
        // ============================================================================
        // MUDANÇA: Instrução de sistema mais explícita para forçar a chamada da função.
        // ============================================================================
        const model = genAI.getGenerativeModel({ 
            model: 'gemini-1.5-flash-latest', 
            tools,
            systemInstruction: "Você é um assistente de finanças para uma obra. Sua tarefa é usar a ferramenta 'getPurchaseData' para responder perguntas sobre gastos. É MUITO IMPORTANTE que você execute a função mesmo que o usuário forneça apenas uma parte das informações (como somente o material). NÃO peça por mais detalhes como o período; apenas execute a busca com a informação que tiver. Após receber o resultado da ferramenta, liste cada compra individualmente com todos os detalhes disponíveis.",
        });
        const chat = model.startChat();

        const result = await chat.sendMessage(prompt);
        const response = result.response;

        log('GEMINI_RAW_RESPONSE', `Resposta bruta do Gemini: ${JSON.stringify(response, null, 2)}`);

        const call = response.candidates?.[0]?.content?.parts?.[0]?.functionCall;

        if (call) {
            log('GEMINI_FUNCTION_CALL', `Gemini solicitou chamada para: ${call.name} com argumentos: ${JSON.stringify(call.args)}`);
            
            if (call.name === 'getPurchaseData') {
                const data = await getPurchaseData(call.args);
                
                log('GEMINI_TOOL_RESULT', `Resultado da função getPurchaseData: ${JSON.stringify(data)}`);

                const result2 = await chat.sendMessage([
                    { functionResponse: { name: 'getPurchaseData', response: data } },
                ]);

                if (result2.response.candidates?.[0]?.content?.parts?.[0]?.text) {
                    const finalResponse = result2.response.text();
                    log('GEMINI_FINAL_RESPONSE', `Resposta final gerada: ${finalResponse}`);
                    return finalResponse;
                } else {
                    log('GEMINI_NO_TEXT_RESPONSE', 'Gemini não retornou um texto final após a execução da função.');
                    return "Consegui os dados, mas não consegui formular a frase final.";
                }
            }
        }
        
        log('GEMINI_NO_CALL', 'Gemini não solicitou uma chamada de função. Retornando null.');
        return null;

    } catch (error) {
        log('GEMINI_QUERY_ERROR', `Erro ao processar pergunta: ${error.message}`);
        console.error('Erro no geminiQueryService:', error);
        return 'Desculpe, tive um problema ao tentar entender sua pergunta. Verifique se a chave de API do Gemini está configurada corretamente.';
    }
}

module.exports = { processNaturalLanguageQuery };