const mongoose = require('mongoose');

const minigameSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    creditCost: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

minigameSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

// Esta línea es la corrección clave: verifica si el modelo ya fue compilado
module.exports = mongoose.models.Minigame || mongoose.model('Minigame', minigameSchema);
