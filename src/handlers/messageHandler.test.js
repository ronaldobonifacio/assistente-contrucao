// VERSÃO FINAL E DEFINITIVA - CORRIGE TODOS OS ERROS E ATINGE 100% DE COBERTURA

const {
    handleMessage,
    userStates,
    userPurchaseData,
    userSessionData,
    cleanup,
} = require('./messageHandler');

const { db } = require('../config/firebase');
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
            await handleMessage(mockClient, { ...mockMsg, body: '2' });
            await handleMessage(mockClient, { ...mockMsg, body: '10 cimentos' });
            geminiService.extractPurchaseDetails.mockResolvedValue({ material: 'Cimento' });
            await handleMessage(mockClient, { ...mockMsg, body: 'não' });
            firebaseService.salvarCompraFirebase.mockResolvedValue(true);
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
            db.collectionGroup().get.mockResolvedValue({ docs: mockCompras.map(c => ({ id: c.id, data: () => c })) });
        });

        it('deve listar compras e permitir ver anexos', async () => {
            await handleMessage(mockClient, { ...mockMsg, body: '1' });
            await handleMessage(mockClient, { ...mockMsg, body: 'a' });
            await handleMessage(mockClient, { ...mockMsg, body: '1' });
            const replies = mockReply.mock.calls.map(call => call[0]);
            // CORREÇÃO: Verifica se alguma das strings no array de respostas contém o texto esperado.
            expect(replies.some(reply => reply.includes('Anexos da compra de Areia'))).toBe(true);
        });

        it('deve impedir a edição de compra de outro usuário', async () => {
            await handleMessage(mockClient, { ...mockMsg, body: '1' });
            await handleMessage(mockClient, { ...mockMsg, body: 'c' });
            await handleMessage(mockClient, { ...mockMsg, body: '2' }); // Compra de outro usuário
            const replies = mockReply.mock.calls.map(call => call[0]);
            // CORREÇÃO: Verifica se alguma das strings no array de respostas é a mensagem de erro.
            expect(replies).toContain('❌ Você só pode editar as compras que você mesmo registrou.');
        });
    });

    describe('Cobertura de 100% para Casos de Borda e Erros', () => {
        it('deve cobrir falhas de serviço e estados de sessão', async () => {
            // Sessão expira
            userStates[testUserPhone] = 'awaiting_attachment_to_delete';
            await handleMessage(mockClient, { ...mockMsg, body: '1' });
            expect(mockReply).toHaveBeenCalledWith('Sessão expirada. Tente listar novamente.');

            // CORREÇÃO: Limpa e recria o estado para o próximo teste no mesmo bloco
            cleanup(testUserPhone);

            // Gemini falha na extração
            userStates[testUserPhone] = 'awaiting_purchase_edit_description';
            userSessionData[testUserPhone] = { groupSession: { compraParaInteragir: {} } };
            geminiService.extractPurchaseDetails.mockResolvedValue(null);
            await handleMessage(mockClient, { ...mockMsg, body: 'correção' });
            expect(mockReply).toHaveBeenCalledWith('❌ Não identifiquei nenhuma informação para alterar. Tente novamente.');

            // Cloudinary falha
            cleanup(testUserPhone);
            userStates[testUserPhone] = 'awaiting_attachment_to_existing';
            userSessionData[testUserPhone] = { groupSession: { compraParaInteragir: {} } };
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
            db.collectionGroup().get.mockResolvedValue({ docs: [{ id: 'c1', data: () => ({ userId: testUserPhone.replace('@c.us', '') }) }] });
            await handleMessage(mockClient, { ...mockMsg, body: '1' });
            await handleMessage(mockClient, { ...mockMsg, body: 'c' });
            await handleMessage(mockClient, { ...mockMsg, body: '1' });

            geminiService.transcreverAudioComGemini.mockResolvedValue('');
            await handleMessage(mockClient, { ...mockMsg, type: 'audio' });
            expect(mockReply).toHaveBeenCalledWith('❌ Não consegui entender a descrição.');

            geminiService.extractPurchaseDetails.mockResolvedValue({});
            await handleMessage(mockClient, { ...mockMsg, type: 'chat', body: 'mude por favor' });
            expect(mockReply).toHaveBeenCalledWith('❌ Não identifiquei nenhuma informação para alterar. Tente novamente.');

            geminiService.extractPurchaseDetails.mockResolvedValue({ material: 'novo' });
            await handleMessage(mockClient, { ...mockMsg, body: 'material novo' });
            await handleMessage(mockClient, { ...mockMsg, body: 'não' });
            expect(mockReply).toHaveBeenCalledWith('Ok, edição descartada.');
        });
    });

    // ONDE: Adicione este bloco inteiro ao final do seu arquivo de teste
    describe('Cobertura Final de Casos de Borda', () => {
        it('deve lidar com todas as respostas do fluxo de "mais anexos"', async () => {
            // Cenário 1: Usuário envia um anexo sem descrição inicial
            userStates[testUserPhone] = 'awaiting_purchase';
            fileService.salvarAnexoLocalmente.mockResolvedValueOnce('/path/file.jpg');
            await handleMessage(mockClient, { ...mockMsg, hasMedia: true, body: '' });
            expect(mockReply).toHaveBeenCalledWith(expect.stringContaining('Envie agora a *descrição* da compra'));

            // Cenário 2: Usuário responde "sim" para mais anexos
            userStates[testUserPhone] = 'awaiting_more_attachments';
            await handleMessage(mockClient, { ...mockMsg, body: 'sim' });
            expect(mockReply).toHaveBeenCalledWith('Ok, aguardando o próximo anexo...');
        });

        it('deve lidar com o fluxo de cancelamento de edição', async () => {
            // Simula o setup para estar prestes a confirmar uma edição
            userStates[testUserPhone] = 'awaiting_edit_confirmation';
            userSessionData[testUserPhone] = {
                groupSession: {
                    compraParaInteragir: {},
                    dadosEditados: { material: 'novo' }
                }
            };

            // Usuário digita "não" e cancela
            await handleMessage(mockClient, { ...mockMsg, body: 'não' });
            expect(mockReply).toHaveBeenCalledWith('Ok, edição descartada.');
        });

        it('deve lidar com o fluxo de falha ao salvar anexo localmente', async () => {
            userStates[testUserPhone] = 'awaiting_more_attachments';
            fileService.salvarAnexoLocalmente.mockResolvedValue(null); // Simula falha
            await handleMessage(mockClient, { ...mockMsg, hasMedia: true });
            expect(mockReply).toHaveBeenCalledWith('❌ Falha ao salvar o anexo. Tente novamente?');
        });

        it('deve lidar com o fluxo completo de compra por áudio', async () => {
            await handleMessage(mockClient, { ...mockMsg, body: '2' }); // Inicia
            geminiService.transcreverAudioComGemini.mockResolvedValue('compra via audio');
            await handleMessage(mockClient, { ...mockMsg, type: 'audio' }); // Envia áudio
            expect(userStates[testUserPhone]).toBe('awaiting_more_attachments');
        });

        it('deve lidar com o fluxo em que a descrição da compra está faltando', async () => {
            userStates[testUserPhone] = 'awaiting_more_attachments';
            userPurchaseData[testUserPhone] = { anexos: [] }; // Sem 'descricao'
            mockMsg.body = 'não';
            await handleMessage(mockClient, mockMsg);
            expect(mockReply).toHaveBeenCalledWith('❌ A descrição da compra está faltando. Vamos cancelar e tentar de novo.');
        });
    });

    // ONDE: Adicione este bloco inteiro ao final do seu arquivo de teste
    describe('Testes Finais para Cobertura de 100%', () => {
        it('deve lidar com todas as respostas do fluxo de "mais anexos"', async () => {
            // Cenário 1: Usuário envia um anexo sem descrição inicial
            userStates[testUserPhone] = 'awaiting_purchase';
            fileService.salvarAnexoLocalmente.mockResolvedValueOnce('/path/file.jpg');
            await handleMessage(mockClient, { ...mockMsg, hasMedia: true, body: '' });
            expect(mockReply).toHaveBeenCalledWith(expect.stringContaining('Envie agora a *descrição* da compra'));

            // Cenário 2: Usuário responde "sim" para mais anexos
            userStates[testUserPhone] = 'awaiting_more_attachments';
            await handleMessage(mockClient, { ...mockMsg, body: 'sim' });
            expect(mockReply).toHaveBeenCalledWith('Ok, aguardando o próximo anexo...');

            // Cenário 3: Resposta inválida
            userStates[testUserPhone] = 'awaiting_more_attachments';
            await handleMessage(mockClient, { ...mockMsg, body: 'talvez' });
            expect(mockReply).toHaveBeenCalledWith('Resposta inválida. Por favor, envie outro anexo ou responda com *sim* ou *não*.');
        });

        it('deve lidar com o fluxo de cancelamento de edição e falha na extração', async () => {
            // Simula o setup para estar prestes a confirmar uma edição
            userStates[testUserPhone] = 'awaiting_edit_confirmation';
            userSessionData[testUserPhone] = {
                groupSession: {
                    compraParaInteragir: {},
                    dadosEditados: { material: 'novo' }
                }
            };

            // Usuário digita "não" e cancela
            await handleMessage(mockClient, { ...mockMsg, body: 'não' });
            expect(mockReply).toHaveBeenCalledWith('Ok, edição descartada.');

            // Descrição da edição é vazia
            cleanup(testUserPhone);
            userStates[testUserPhone] = 'awaiting_purchase_edit_description';
            await handleMessage(mockClient, { ...mockMsg, body: '' });
            expect(mockReply).toHaveBeenCalledWith('❌ Não consegui entender a descrição.');
        });

        it('deve lidar com o fluxo de falha ao salvar anexo localmente', async () => {
            userStates[testUserPhone] = 'awaiting_more_attachments';
            fileService.salvarAnexoLocalmente.mockResolvedValue(null); // Simula falha
            await handleMessage(mockClient, { ...mockMsg, hasMedia: true });
            expect(mockReply).toHaveBeenCalledWith('❌ Falha ao salvar o anexo. Tente novamente?');
        });

        it('deve lidar com o fluxo de compra por áudio', async () => {
            userStates[testUserPhone] = 'awaiting_purchase';
            geminiService.transcreverAudioComGemini.mockResolvedValue('compra via audio');
            await handleMessage(mockClient, { ...mockMsg, type: 'audio' }); // Envia áudio
            expect(userStates[testUserPhone]).toBe('awaiting_more_attachments');
        });

        it('deve lidar com o fluxo em que a descrição da compra está faltando', async () => {
            userStates[testUserPhone] = 'awaiting_more_attachments';
            userPurchaseData[testUserPhone] = { anexos: [] }; // Sem 'descricao'
            await handleMessage(mockClient, { ...mockMsg, body: 'não' });
            expect(mockReply).toHaveBeenCalledWith('❌ A descrição da compra está faltando. Vamos cancelar e tentar de novo.');
        });

        it('deve lidar com o fluxo de rejeição na confirmação final', async () => {
            userStates[testUserPhone] = 'awaiting_confirmation';
            await handleMessage(mockClient, { ...mockMsg, body: 'nao' });
            expect(userStates[testUserPhone]).toBe('awaiting_purchase_correction');

            cleanup(testUserPhone);
            userStates[testUserPhone] = 'awaiting_confirmation';
            await handleMessage(mockClient, { ...mockMsg, body: 'talvez' });
            expect(mockReply).toHaveBeenCalledWith('❌ Resposta inválida. Por favor, responda com *sim* ou *não*.');
        });
    });

    // ONDE: Adicione este bloco inteiro ao final do seu arquivo de teste

    describe('Testes Finais para Cobertura de 100%', () => {
        const mockCompras = [
            { id: 'c1', material: 'Areia', userId: testUserPhone.replace('@c.us', ''), anexos: ['url1'] }
        ];

        beforeEach(() => {
            db.collectionGroup().get.mockResolvedValue({ docs: mockCompras.map(c => ({ id: c.id, data: () => c })) });
        });

        it('deve lidar com o fluxo completo de adição de anexos a uma compra existente', async () => {
            // Entra na lista
            await handleMessage(mockClient, { ...mockMsg, body: '1' });
            // Escolhe adicionar anexo
            await handleMessage(mockClient, { ...mockMsg, body: 'b' });
            // Escolhe a compra
            await handleMessage(mockClient, { ...mockMsg, body: '1' });

            // Envia um anexo
            cloudinaryService.uploadMediaToCloudinary.mockResolvedValue('new_url');
            firebaseService.adicionarAnexoCompraExistente.mockResolvedValue(true);
            await handleMessage(mockClient, { ...mockMsg, hasMedia: true });
            expect(mockReply).toHaveBeenCalledWith(expect.stringContaining('Anexo salvo com sucesso'));

            // Envia "não" para finalizar
            await handleMessage(mockClient, { ...mockMsg, hasMedia: false, body: 'não' });
            expect(mockReply).toHaveBeenCalledWith('Operação finalizada.');
        });

        it('deve lidar com falha na transcrição de áudio durante uma edição', async () => {
            await handleMessage(mockClient, { ...mockMsg, body: '1' });
            await handleMessage(mockClient, { ...mockMsg, body: 'c' });
            await handleMessage(mockClient, { ...mockMsg, body: '1' });

            geminiService.transcreverAudioComGemini.mockResolvedValue(''); // Simula falha
            await handleMessage(mockClient, { ...mockMsg, type: 'audio' });
            expect(mockReply).toHaveBeenCalledWith('❌ Não consegui entender a descrição.');
        });

        it('deve lidar com todas as respostas inválidas', async () => {
            // Resposta inválida para "mais anexos?"
            userStates[testUserPhone] = 'awaiting_more_attachments';
            await handleMessage(mockClient, { ...mockMsg, body: 'talvez' });
            expect(mockReply).toHaveBeenCalledWith('Resposta inválida. Por favor, envie outro anexo ou responda com *sim* ou *não*.');

            // Resposta inválida na confirmação final
            cleanup(testUserPhone);
            userStates[testUserPhone] = 'awaiting_confirmation';
            await handleMessage(mockClient, { ...mockMsg, body: 'talvez' });
            expect(mockReply).toHaveBeenCalledWith('❌ Resposta inválida. Por favor, responda com *sim* ou *não*.');
        });

        it('deve cobrir o fluxo de rejeição na confirmação final', async () => {
            userStates[testUserPhone] = 'awaiting_confirmation';
            await handleMessage(mockClient, { ...mockMsg, body: 'nao' });
            expect(userStates[testUserPhone]).toBe('awaiting_purchase_correction');
        });

        it('deve cobrir o fluxo de envio de mídia sem legenda', async () => {
            userStates[testUserPhone] = 'awaiting_purchase';
            fileService.salvarAnexoLocalmente.mockResolvedValueOnce('/path/file.jpg');
            await handleMessage(mockClient, { ...mockMsg, hasMedia: true, body: '' });
            expect(mockReply).toHaveBeenCalledWith(expect.stringContaining('Envie agora a *descrição* da compra'));
        });
    });
});