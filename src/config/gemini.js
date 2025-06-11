const { GoogleGenerativeAI } = require("@google/generative-ai");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiTextModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

module.exports = { genAI,geminiTextModel };