// ARQUIVO NOVO: src/config/__mocks__/firebase.js

// Mock encadeado para simular as chamadas do Firestore
const mockDb = {
  collection: jest.fn().mockReturnThis(),
  doc: jest.fn().mockReturnThis(),
  collectionGroup: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  startAfter: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  get: jest.fn().mockResolvedValue({ empty: true, docs: [] }), // Retorno padrão
  add: jest.fn().mockResolvedValue({ id: 'new-doc-id' }),
  update: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(true),
};

module.exports = {
  db: mockDb,
  admin: {
    firestore: {
      FieldValue: {
        arrayUnion: jest.fn(),
      },
    },
  },
};