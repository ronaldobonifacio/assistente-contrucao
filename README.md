👷‍♂️ Drem-Assist: Assistente de Compras para WhatsAppUm bot inteligente para WhatsApp projetado para simplificar a gestão de compras e despesas de obras de construção civil. Utilizando a API do Google Gemini, o assistente extrai informações de mensagens de texto, áudio e legendas de anexos, automatizando o registo de compras de forma conversacional e intuitiva.✨ Funcionalidades✅ Registo de Compras Multimodal: Adicione novas compras através de:Mensagens de texto simples.Mensagens de áudio (transcrição automática com Gemini).Anexos (PDF, Imagens) com a descrição na legenda.🧠 Extração de Dados com IA: O Google Gemini analisa as descrições para extrair e estruturar automaticamente os detalhes da compra (material, quantidade, valor, etc.).📎 Gestão de Anexos Múltiplos:Adicione vários anexos (faturas, recibos) a uma única compra.Guarde anexos em compras já existentes.Visualize os links dos anexos de qualquer compra registada.⚙️ Fluxo de Conversa Robusto:O bot guia o utilizador passo a passo com um sistema de confirmação para garantir a precisão dos dados.Modo de Conversa Livre: Se o utilizador enviar uma mensagem fora do script, o bot utiliza o Gemini para manter um bate-papo natural, respondendo a perguntas gerais.Comandos de Saída Universais: O utilizador pode digitar menu, cancelar ou sair a qualquer momento para interromper uma operação e voltar ao menu principal.📊 Exportação para Excel: Exporte todo o histórico de compras para uma folha de cálculo .xlsx com um único comando.🚀 Diagnóstico de Sistema: Ao iniciar, o bot verifica o estado de todas as suas ligações (Firebase, Gemini, Cloudinary) e exibe um relatório claro na consola.🛠️ Tecnologias UtilizadasCore: Node.jsWhatsApp: whatsapp-web.jsInteligência Artificial: Google Gemini API (@google/generative-ai)Base de Dados: Google Firebase FirestoreArmazenamento de Ficheiros: CloudinaryUtilitários: dotenv, qrcode-terminal, xlsx, firebase-admin📂 Estrutura do ProjetoO projeto segue uma arquitetura limpa e modular para facilitar a manutenção e escalabilidade.dremassist/
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
🚀 Instalação e ConfiguraçãoSiga os passos abaixo para executar o projeto localmente.1. Clone o Repositóriogit clone <URL_DO_SEU_REPOSITORIO>
cd dremassist
2. Instale as Dependênciasnpm install
3. Configure o FirebaseDescarregue o ficheiro de chave de serviço (serviceAccountKey.json) do seu projeto no Firebase.Coloque este ficheiro na pasta raiz do projeto.4. Configure as Variáveis de AmbienteCrie um ficheiro chamado .env na raiz do projeto.Copie o conteúdo do exemplo abaixo e preencha com as suas próprias chaves.5. Crie a Pasta TemporáriaNa raiz do projeto, crie uma pasta chamada temp_uploads.mkdir temp_uploads
🔑 Variáveis de AmbienteCrie um ficheiro .env e adicione as seguintes chaves:# Chave da API do Google Gemini
GEMINI_API_KEY=A_SUA_CHAVE_AQUI

# ID do grupo de permissão no Firebase
FIREBASE_GRUPO_ID=grupo1

# Credenciais do Cloudinary
CLOUDINARY_CLOUD_NAME=O_SEU_CLOUD_NAME_AQUI
CLOUDINARY_API_KEY=A_SUA_API_KEY_AQUI
CLOUDINARY_API_SECRET=O_SEU_API_SECRET_AQUI
▶️ Como Executar1. Iniciar o BotExecute o ponto de entrada da aplicação:node app.js
Ou, para desenvolvimento com reinicialização automática:nodemon app.js
2. Autenticação com WhatsAppNa primeira vez que executar, um QR Code aparecerá no terminal.Abra o WhatsApp no seu telemóvel, vá para Aparelhos ligados e leia o código.Após a primeira ligação bem-sucedida, uma sessão será guardada e não precisará de ler o QR Code novamente, a menos que a sessão expire ou seja revogada.🔮 Próximos Passos e Melhorias[ ] Implementar um sistema de múltiplos utilizadores com autenticação individual.[ ] Criar um painel de controlo (dashboard) web para visualização dos dados.[ ] Desenvolver relatórios e gráficos analíticos sobre os gastos.[ ] Migrar a gestão de estado em memória para uma base de dados mais robusta (como Redis) para escalar o bot.
