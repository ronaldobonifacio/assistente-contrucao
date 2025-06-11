const { cloudinary } = require('../config/cloudinary');
const { log } = require('../utils/logger');

async function uploadLocalFileToCloudinary(filePath, phone) {
    try {
        log('CLOUDINARY-UPLOAD', `Iniciando upload de ${filePath}`, phone);
        const result = await cloudinary.uploader.upload(filePath, { resource_type: "auto", folder: `dremassist/${phone.replace('@c.us', '')}` });
        log('CLOUDINARY-UPLOAD', `Upload concluído. URL: ${result.secure_url}`, phone);
        return result.secure_url;
    } catch (error) {
        log('CLOUDINARY-UPLOAD-FAIL', `Erro no upload: ${error.message}`, phone);
        console.error(error);
        return null;
    }
}

async function uploadMediaToCloudinary(media, phone) {
    const b64 = `data:${media.mimetype};base64,${media.data}`;
    try {
        log('CLOUDINARY-UPLOAD', 'Iniciando upload direto...', phone);
        const result = await cloudinary.uploader.upload(b64, { resource_type: "auto", folder: `dremassist/${phone.replace('@c.us', '')}` });
        log('CLOUDINARY-UPLOAD', `Upload direto concluído. URL: ${result.secure_url}`, phone);
        return result.secure_url;
    } catch (error) {
        log('CLOUDINARY-UPLOAD-FAIL', `Erro no upload direto: ${error.message}`, phone);
        console.error(error);
        return null;
    }
}

module.exports = { uploadLocalFileToCloudinary, uploadMediaToCloudinary };