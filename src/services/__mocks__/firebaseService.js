// ARQUIVO NOVO: src/services/__mocks__/firebaseService.js
// Este arquivo simula as funções do firebaseService.

module.exports = {
  db: { // Mock básico do DB para evitar erros
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        collection: jest.fn(() => ({
          add: jest.fn(),
          doc: jest.fn(() => ({
            get: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
          })),
        })),
      })),
    })),
    collectionGroup: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        startAfter: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
    })),
  },
  admin: {},
  salvarCompraFirebase: jest.fn(),
  adicionarAnexoCompraExistente: jest.fn(),
  editarCompraFirebase: jest.fn(),
  removerAnexoCompra: jest.fn(),
};