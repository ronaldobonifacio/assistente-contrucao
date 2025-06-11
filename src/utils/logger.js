function log(action, message, phone = '') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${action}] ${phone ? `[${phone}] ` : ''}${message}`);
}

module.exports = { log };