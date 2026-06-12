const mongoose = require('mongoose');

const RetiroSolicitudSchema = new mongoose.Schema({
    usuario: String,
    monto: Number,
    cbu_alias: String,
    titular: String,
    plataforma: {
        type: String,
        enum: ['Oropuro', 'Ganamos', 'Créditos'],
        default: 'Créditos'
    },
    estado: { type: String, default: 'pendiente' }, // 'pendiente', 'aprobado', 'rechazado'
    motivoRechazo: { type: String, default: null },
    fechaCreacion: { type: Date, default: Date.now }
});

module.exports = mongoose.model('RetiroSolicitud', RetiroSolicitudSchema);
