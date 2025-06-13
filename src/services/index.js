// ARQUIVO NOVO: src/services/index.js

const firebaseService = require('./firebaseService');
const geminiQueryService = require('./geminiQueryService');
const geminiService = require('./geminiService');
const fileService = require('./fileService');
const cloudinaryService = require('./cloudinaryService');

// Este arquivo agrupa e exporta todos os serviços para serem
// importados de forma organizada em outros lugares do projeto.
module.exports = {
  firebaseService,
  geminiQueryService,
  geminiService, // Mantém as funções originais como extrair detalhes
  fileService,
  cloudinaryService,
};