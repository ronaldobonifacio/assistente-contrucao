const { Client, LocalAuth } = require('whatsapp-web.js');

const client = new Client({ authStrategy: new LocalAuth({ clientId: "dremassist" }) });

module.exports = { client };