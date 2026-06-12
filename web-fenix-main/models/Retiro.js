const mongoose = require('mongoose');

// 1. Destruimos cualquier versión "fantasma" del modelo viejo que haya quedado en memoria
delete mongoose.models.Retiro;

// 2. Definimos el esquema explícitamente
const RetiroSchema = new mongoose.Schema({
    fecha: String,
    turno: String,
    retiros: Array,
    fechaCreacion: { type: Date, default: Date.now }
}, { strict: false }); // Mantenemos el strict apagado por seguridad

// 3. Lo compilamos limpio desde cero
module.exports = mongoose.model('Retiro', RetiroSchema);
