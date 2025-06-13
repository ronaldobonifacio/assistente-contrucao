# 👷‍♂️ Drem-Assist: Assistente de Compras para WhatsApp

Um bot inteligente para WhatsApp projetado para simplificar a gestão de compras e despesas de obras de construção civil. Utilizando a API do **Google Gemini**, o assistente extrai informações de mensagens de texto, áudio e legendas de anexos, automatizando o registo de compras de forma conversacional e intuitiva.

---

## ✨ Funcionalidades

### ✅ Registo de Compras Multimodal:
Adicione novas compras através de:
- Mensagens de texto simples  
- Mensagens de áudio *(transcrição automática com Gemini)*  
- Anexos *(PDF, Imagens)* com a descrição na legenda  

### 🧠 Extração de Dados com IA:
O **Google Gemini** analisa as descrições para extrair e estruturar automaticamente os detalhes da compra *(material, quantidade, valor, etc.)*.

### 📎 Gestão de Anexos Múltiplos:
- Adicione vários anexos (faturas, recibos) a uma única compra  
- Guarde anexos em compras já existentes  
- Visualize os links dos anexos de qualquer compra registada  

### ⚙️ Fluxo de Conversa Robusto:
- O bot guia o utilizador passo a passo com um sistema de confirmação para garantir a precisão dos dados  
- **Modo de Conversa Livre**: o bot utiliza Gemini para manter um bate-papo natural  
- **Comandos de Saída Universais**: `menu`, `cancelar` ou `sair` para interromper a operação e voltar ao menu  

### 📊 Exportação para Excel:
- Exporte todo o histórico de compras para uma folha `.xlsx` com um único comando  

### 🚀 Diagnóstico de Sistema:
- Ao iniciar, o bot verifica o estado das ligações (Firebase, Gemini, Cloudinary) e exibe um relatório claro na consola  

---

## 🛠️ Tecnologias Utilizadas

- **Core**: Node.js  
- **WhatsApp**: whatsapp-web.js  
- **Inteligência Artificial**: Google Gemini API (`@google/generative-ai`)  
- **Base de Dados**: Google Firebase Firestore  
- **Armazenamento de Ficheiros**: Cloudinary  
- **Utilitários**: `dotenv`, `qrcode-terminal`, `xlsx`, `firebase-admin`  

---

## 📂 Estrutura do Projeto

```
dremassist/
├── src/
│   ├── config/
│   │   ├── cloudinary.js
│   │   ├── firebase.js
│   │   ├── gemini.js
│   │   └── whatsapp.js
│   ├── handlers/
│   │   └── messageHandler.js
│   ├── services/
│   │   ├── cloudinaryService.js
│   │   ├── firebaseService.js
│   │   ├── geminiService.js
│   │   └── fileService.js
│   └── utils/
│       ├── helpers.js
│       ├── logger.js
│       └── systemCheck.js
├── .env
├── .gitignore
├── package.json
├── serviceAccountKey.json
├── temp_uploads/
└── app.js
```

---

## 🚀 Instalação e Configuração

Siga os passos abaixo para executar o projeto localmente:

1. **Clone o Repositório**

```bash
git clone <URL_DO_SEU_REPOSITORIO>
cd dremassist
```

2. **Instale as Dependências**

```bash
npm install
```

3. **Configure o Firebase**
- Descarregue o ficheiro `serviceAccountKey.json` do seu projeto Firebase  
- Coloque-o na pasta raiz do projeto  

4. **Configure as Variáveis de Ambiente**
- Crie um ficheiro chamado `.env` na raiz  
- Copie e preencha com suas chaves conforme abaixo  

5. **Crie a Pasta Temporária**

```bash
mkdir temp_uploads
```

---

## 🔑 Variáveis de Ambiente

Crie um `.env` com o seguinte conteúdo:

```env
# Chave da API do Google Gemini
GEMINI_API_KEY=A_SUA_CHAVE_AQUI

# ID do grupo de permissão no Firebase
FIREBASE_GRUPO_ID=grupo1

# Credenciais do Cloudinary
CLOUDINARY_CLOUD_NAME=O_SEU_CLOUD_NAME_AQUI
CLOUDINARY_API_KEY=A_SUA_API_KEY_AQUI
CLOUDINARY_API_SECRET=O_SEU_API_SECRET_AQUI
```

---

## ▶️ Como Executar

1. **Iniciar o Bot**

```bash
node app.js
# ou para desenvolvimento:
nodemon app.js
```

2. **Autenticação com WhatsApp**
- Na primeira execução, um QR Code será exibido no terminal  
- Escaneie com o WhatsApp (Menu > Aparelhos Ligados)  
- A sessão será salva e usada nas próximas execuções  

---

## 🔮 Próximos Passos e Melhorias

- [ ] Implementar sistema de múltiplos utilizadores com autenticação  
- [ ] Criar um painel web (dashboard) para visualização de dados  
- [ ] Desenvolver relatórios e gráficos analíticos  
- [ ] Migrar gestão de estado em memória para um banco de dados robusto (ex: Redis)  
