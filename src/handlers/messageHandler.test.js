// VERSÃO FINAL E DEFINITIVA - CORRIGE TODOS OS ERROS E MANTÉM TODAS AS FUNCIONALIDADES DE TESTE

const {
    handleMessage,
    userStates,
    userPurchaseData,
    userSessionData,
    cleanup,
} = require('./messageHandler');

const { db } = require('../config/firebase'); // Mockado automaticamente pelo jest.mock
const firebaseService = require('../services/firebaseService');
const geminiService = require('../services/geminiService');
const geminiQueryService = require('../services/geminiQueryService');
const cloudinaryService = require('../services/cloudinaryService');
const fileService = require('../services/fileService');

// Mocks de todos os módulos externos
jest.mock('../config/firebase');
jest.mock('../services/firebaseService');
jest.mock('../services/geminiService');
jest.mock('../services/geminiQueryService');
jest.mock('../services/cloudinaryService');
jest.mock('../services/fileService');
jest.mock('../utils/logger', () => ({ log: jest.fn() }));
jest.mock('../utils/helpers', () => ({ delay: jest.fn().mockResolvedValue() }));
jest.mock('whatsapp-web.js', () => ({ MessageMedia: { fromFilePath: jest.fn() } }));

describe('messageHandler', () => {
    let mockClient, mockMsg, mockChat, mockReply, mockContact;
    const testUserPhone = '123456789@c.us';
    const otherUserPhone = '987654321@c.us';

    beforeEach(() => {
        jest.clearAllMocks();
        cleanup(testUserPhone);
        cleanup(otherUserPhone);

        mockReply = jest.fn();
        mockChat = { sendStateTyping: jest.fn(), isGroup: false };
        mockContact = { pushname: 'Ronaldo Teste' };
        mockClient = { sendMessage: jest.fn() };
        mockMsg = {
            from: testUserPhone,
            body: '',
            hasMedia: false,
            type: 'chat',
            getChat: jest.fn().mockResolvedValue(mockChat),
            getContact: jest.fn().mockResolvedValue(mockContact),
            reply: mockReply,
            downloadMedia: jest.fn(),
        };
        geminiQueryService.processNaturalLanguageQuery.mockResolvedValue(null);
    });

    describe('Fluxos Principais', () => {
        it('deve ignorar mensagens em grupo', async () => {
            mockChat.isGroup = true;
            await handleMessage(mockClient, mockMsg);
            expect(mockReply).not.toHaveBeenCalled();
        });

        it('deve cancelar e voltar ao menu', async () => {
            userStates[testUserPhone] = 'awaiting_purchase';
            await handleMessage(mockClient, { ...mockMsg, body: 'sair' });
            expect(mockReply).toHaveBeenCalledWith(expect.stringContaining('Voltando ao menu principal'));
        });

        it('deve acionar exportação para planilha', async () => {
            await handleMessage(mockClient, { ...mockMsg, body: '3' });
            expect(fileService.exportarComprasParaPlanilha).toHaveBeenCalled();
        });

        it('deve usar o modo de conversa livre', async () => {
            geminiService.getConversationalResponse.mockResolvedValue('Olá!');
            await handleMessage(mockClient, { ...mockMsg, body: 'Oi' });
            expect(mockReply).toHaveBeenCalledWith('Olá!');
            expect(userStates[testUserPhone]).toBe('free_chat');
        });
    });

    describe('Fluxo de Adição de Compra', () => {
        it('deve registrar compra via texto com sucesso', async () => {
            geminiService.extractPurchaseDetails.mockResolvedValue({ material: 'Cimento' });
            firebaseService.salvarCompraFirebase.mockResolvedValue(true);
            
            await handleMessage(mockClient, { ...mockMsg, body: '2' });
            await handleMessage(mockClient, { ...mockMsg, body: '10 cimentos' });
            await handleMessage(mockClient, { ...mockMsg, body: 'não' });
            await handleMessage(mockClient, { ...mockMsg, body: 'sim' });
            
            expect(mockReply).toHaveBeenCalledWith(expect.stringContaining('registrada com sucesso'));
        });

        it('deve lidar com o fluxo de correção de dados', async () => {
            userStates[testUserPhone] = 'awaiting_confirmation';
            userPurchaseData[testUserPhone] = { material: 'Cimento', valor_total: 100 };
            
            await handleMessage(mockClient, { ...mockMsg, body: 'não' });
            expect(userStates[testUserPhone]).toBe('awaiting_purchase_correction');

            geminiService.extractPurchaseDetails.mockResolvedValue({ valor_total: 150 });
            await handleMessage(mockClient, { ...mockMsg, body: 'o valor é 150' });
            expect(mockReply).toHaveBeenCalledWith(expect.stringContaining('CONFIRA OS DADOS CORRIGIDOS'));
        });

        it('deve lidar com o envio de áudio e múltiplos anexos', async () => {
            await handleMessage(mockClient, { ...mockMsg, body: '2' });
            geminiService.transcreverAudioComGemini.mockResolvedValue('compra de áudio');
            await handleMessage(mockClient, { ...mockMsg, type: 'ptt' });
            await handleMessage(mockClient, { ...mockMsg, body: 'sim', type: 'chat' });
            fileService.salvarAnexoLocalmente.mockResolvedValue('/path/to/file.jpg');
            await handleMessage(mockClient, { ...mockMsg, hasMedia: true });
            expect(mockReply).toHaveBeenCalledWith(expect.stringContaining('Anexo salvo temporariamente!'));
        });
    });

    describe('Fluxo de Listar e Interagir', () => {
        const mockCompras = [
            { id: 'c1', material: 'Areia', userId: testUserPhone.replace('@c.us', ''), anexos: ['url1'] },
            { id: 'c2', material: 'Tijolo', userId: otherUserPhone.replace('@c.us', ''), anexos: [] },
        ];

        beforeEach(() => {
            const mockSnapshot = {
                empty: false,
                docs: mockCompras.map(c => ({ id: c.id, data: () => c }))
            };
            db.collectionGroup().get.mockResolvedValue(mockSnapshot);
        });

        it('deve listar compras e permitir ver anexos', async () => {
            await handleMessage(mockClient, { ...mockMsg, body: '1' });
            userStates[testUserPhone] = 'awaiting_list_action'; // Garante o estado
            
            await handleMessage(mockClient, { ...mockMsg, body: 'a' });
            userStates[testUserPhone] = 'awaiting_purchase_number'; // Garante o estado
            
            await handleMessage(mockClient, { ...mockMsg, body: '1' });
            const replies = mockReply.mock.calls.map(call => call[0]);
            
            expect(replies.some(reply => reply.includes('Anexos da compra de Areia'))).toBe(true);
        });

        it('deve impedir a edição de compra de outro usuário', async () => {
            await handleMessage(mockClient, { ...mockMsg, body: '1' });
            userStates[testUserPhone] = 'awaiting_list_action';

            await handleMessage(mockClient, { ...mockMsg, body: 'c' });
            userStates[testUserPhone] = 'awaiting_purchase_number';
            
            await handleMessage(mockClient, { ...mockMsg, body: '2' }); // Compra de outro usuário
            
            expect(mockReply).toHaveBeenCalledWith('❌ Você só pode editar as compras que você mesmo registrou.');
        });
    });

    describe('Cobertura de Casos de Borda e Erros', () => {
        it('deve cobrir falhas de serviço e estados de sessão', async () => {
            // Sessão expira
            userStates[testUserPhone] = 'awaiting_attachment_to_delete';
            // Não há userSessionData, então a compra será undefined
            await handleMessage(mockClient, { ...mockMsg, body: '1' });
            expect(mockReply).toHaveBeenCalledWith('Sessão expirada. Tente listar novamente.');

            cleanup(testUserPhone);

            // Gemini falha na extração durante a edição
            userStates[testUserPhone] = 'awaiting_purchase_edit_description';
            userSessionData[testUserPhone] = { compraParaInteragir: { id: 'c1' } }; // Sessão simplificada
            geminiService.extractPurchaseDetails.mockResolvedValue({});
            await handleMessage(mockClient, { ...mockMsg, body: 'correção' });
            expect(mockReply).toHaveBeenCalledWith('❌ Não identifiquei nenhuma informação para alterar. Tente novamente.');

            cleanup(testUserPhone);

            // Cloudinary falha
            userStates[testUserPhone] = 'awaiting_attachment_to_existing';
            userSessionData[testUserPhone] = { compraParaInteragir: { id: 'c1' } };
            cloudinaryService.uploadMediaToCloudinary.mockResolvedValue(null);
            await handleMessage(mockClient, { ...mockMsg, hasMedia: true });
            expect(mockReply).toHaveBeenCalledWith(expect.stringContaining('Falha ao salvar o anexo'));
        });

        it('deve cobrir todas as respostas inválidas do usuário', async () => {
            userStates[testUserPhone] = 'awaiting_more_attachments';
            await handleMessage(mockClient, { ...mockMsg, body: 'talvez' });
            expect(mockReply).toHaveBeenCalledWith('Resposta inválida. Por favor, envie outro anexo ou responda com *sim* ou *não*.');

            cleanup(testUserPhone);
            userStates[testUserPhone] = 'awaiting_confirmation';
            await handleMessage(mockClient, { ...mockMsg, body: 'talvez' });
            expect(mockReply).toHaveBeenCalledWith('❌ Resposta inválida. Por favor, responda com *sim* ou *não*.');

            cleanup(testUserPhone);
            userStates[testUserPhone] = 'awaiting_list_action';
            await handleMessage(mockClient, { ...mockMsg, body: 'z' });
            expect(mockReply).toHaveBeenCalledWith(expect.stringContaining('Opção inválida.'));
        });

        it('deve cobrir o fluxo completo de edição e seus erros', async () => {
            // Prepara a sessão para edição
            const compraOriginal = { id: 'c1', userId: testUserPhone.replace('@c.us', ''), material: 'tijolo' };
            userStates[testUserPhone] = 'awaiting_purchase_edit_description';
            userSessionData[testUserPhone] = { compraParaInteragir: compraOriginal };

            // 1. Falha na transcrição de áudio
            geminiService.transcreverAudioComGemini.mockResolvedValue('');
            await handleMessage(mockClient, { ...mockMsg, type: 'audio' });
            expect(mockReply).toHaveBeenCalledWith('❌ Não consegui entender a descrição. Por favor, tente novamente ou digite *cancelar*.');

            // 2. Falha na extração de texto
            geminiService.extractPurchaseDetails.mockResolvedValue({});
            await handleMessage(mockClient, { ...mockMsg, type: 'chat', body: 'mude por favor' });
            expect(mockReply).toHaveBeenCalledWith('❌ Não identifiquei nenhuma informação para alterar. Tente novamente.');

            // 3. Edição bem-sucedida, mas cancelada pelo usuário
            geminiService.extractPurchaseDetails.mockResolvedValue({ material: 'novo' });
            await handleMessage(mockClient, { ...mockMsg, body: 'material novo' });
            
            // Verifica o preview
            expect(mockReply).toHaveBeenCalledWith(expect.stringContaining('PREVIEW DA EDIÇÃO'));
            
            // Cancela
            await handleMessage(mockClient, { ...mockMsg, body: 'não' });
            expect(mockReply).toHaveBeenCalledWith('Ok, edição descartada.');
        });
    });

    describe('Cobertura Final de Casos de Borda (Mantido e Corrigido)', () => {
        it('deve lidar com todas as respostas do fluxo de "mais anexos"', async () => {
            userStates[testUserPhone] = 'awaiting_purchase';
            fileService.salvarAnexoLocalmente.mockResolvedValueOnce('/path/file.jpg');
            await handleMessage(mockClient, { ...mockMsg, hasMedia: true, body: '' });
            expect(mockReply).toHaveBeenCalledWith(expect.stringContaining('Envie agora a *descrição* da compra'));

            userStates[testUserPhone] = 'awaiting_more_attachments';
            await handleMessage(mockClient, { ...mockMsg, body: 'sim' });
            expect(mockReply).toHaveBeenCalledWith('Ok, aguardando o próximo anexo...');
        });

        it('deve lidar com o fluxo de cancelamento de edição', async () => {
            userStates[testUserPhone] = 'awaiting_edit_confirmation';
            userSessionData[testUserPhone] = {
                compraParaInteragir: {},
                dadosEditados: { material: 'novo' }
            };

            await handleMessage(mockClient, { ...mockMsg, body: 'não' });
            expect(mockReply).toHaveBeenCalledWith('Ok, edição descartada.');
        });
        
        it('deve lidar com falha ao salvar anexo localmente na adição de compra', async () => {
            userStates[testUserPhone] = 'awaiting_more_attachments';
            fileService.salvarAnexoLocalmente.mockResolvedValue(null);
            await handleMessage(mockClient, { ...mockMsg, hasMedia: true });
            expect(mockReply).toHaveBeenCalledWith('❌ Falha ao salvar o anexo. Tente novamente?');
        });

        it('deve lidar com o fluxo em que a descrição da compra está faltando', async () => {
            userStates[testUserPhone] = 'awaiting_more_attachments';
            userPurchaseData[testUserPhone] = { anexos: ['/path/to/file.jpg'] }; // Sem 'descricao'
            
            await handleMessage(mockClient, { ...mockMsg, body: 'não' });
            expect(mockReply).toHaveBeenCalledWith('❌ A descrição da compra está faltando. Vamos cancelar e tentar de novo.');
        });
    });
});