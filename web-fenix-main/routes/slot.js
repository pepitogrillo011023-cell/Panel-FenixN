const express = require('express');
const router = express.Router();

// Definimos la ruta
router.post('/jugar-slot', (req, res) => {
    console.log("¡LOG DESDE SLOT.JS!");
    res.json({ mensaje: "¡Esto sí funciona desde el archivo!" });
});

// ESTO ES LO MÁS IMPORTANTE:
module.exports = router;
