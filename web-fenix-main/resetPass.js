// resetPass.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('./models/User'); // Asegúrate que la ruta sea correcta

// CONFIGURACIÓN DE TU BASE DE DATOS (Cópialo de tu server.js)
const MONGO_URI = 'TU_URI_DE_MONGODB_AQUI'; 

async function actualizarContraseñas() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log("🟢 Conectado a MongoDB");

        const nuevaPasswordBase = "fenix123"; // <--- TU CONTRASEÑA BASE
        const saltRounds = 10;
        
        // Hashear la contraseña
        const hashedPassword = await bcrypt.hash(nuevaPasswordBase, saltRounds);

        // Actualizar todos los usuarios
        const resultado = await User.updateMany({}, { password: hashedPassword });

        console.log(`✅ Éxito. Se actualizaron ${resultado.modifiedCount} usuarios.`);
        process.exit();
    } catch (error) {
        console.error("❌ Error:", error);
        process.exit(1);
    }
}

actualizarContraseñas();
