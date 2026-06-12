const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

module.exports = function(app, requireLogin, io, sharedState) {
    const Cliente = mongoose.model('Cliente');
    const PanelConfig = mongoose.model('PanelConfig');

    function escapeRegex(str) {
        return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function buscarPorUsuarioCasino(usuario) {
        return Cliente.findOne({
            usuarioCasino: { $regex: `^${escapeRegex(usuario)}$`, $options: 'i' }
        });
    }

    async function validarPasswordCliente(cliente, password) {
        const claveReal = cliente.password ? cliente.password : '1234';
        if (claveReal.startsWith('$2')) {
            return bcrypt.compare(password, claveReal);
        }
        return password === claveReal;
    }

    // Función auxiliar para generar códigos únicos
    function generarCodigoReferido(usuario) {
        const cleanUser = usuario ? usuario.toString() : "USR";
        const random = Math.random().toString(36).substring(2, 6).toUpperCase();
        return `${cleanUser.substring(0, 3).toUpperCase()}${random}`;
    }

    // ==============================================================
    // 👤 NUEVA RUTA: REGISTRO DE CLIENTES (SIGN UP)
    // ==============================================================
    app.post('/api/registrar-cliente', async (req, res) => {
        try {
            const { usuario, password, codigoReferido } = req.body;
            
            // 1. Verificamos si el usuario ya existe (case-insensitive)
            const existe = await buscarPorUsuarioCasino(usuario);
            if (existe) {
                return res.json({ exito: false, mensaje: 'Ese usuario ya existe. Por favor, elegí otro nombre.' });
            }

            // 2. BUSCAMOS AL PADRINO (Si hay un código)
            let referidoPor = null;
            if (codigoReferido) {
                const padrino = await Cliente.findOne({ referralCode: codigoReferido });
                if (padrino) {
                    referidoPor = padrino.usuarioCasino;
                }
            }

            // 3. GENERAMOS EL CÓDIGO PROPIO DEL NUEVO USUARIO
            const miCodigo = generarCodigoReferido(usuario);

            // 4. Creamos el nuevo cliente
            const nuevoCliente = new Cliente({
                usuarioCasino: usuario,
                password: password,
                saldo: 0,
                estado: 'Activo',
                referralCode: miCodigo, // <--- CÓDIGO ÚNICO DEL USUARIO
                referredBy: referidoPor,
                fechaRegistro: new Date(),
                historialChat: [{
                    emisor: 'bot',
                    mensaje: `¡Bienvenido a Casino Fénix, ${usuario}! Ya podés invitar amigos con tu código: ${miCodigo}`,
                    is_read: true,
                    leido: true
                }]
            });
            
            await nuevoCliente.save();

            // 5. Avisamos al panel de Admin
            if (sharedState && sharedState.adminSocketId && io) {
                const clientesDB = await Cliente.find().sort({ fechaRegistro: -1 });
                io.to(sharedState.adminSocketId).emit('cargar_datos_tablas', { clientes: clientesDB });
            }

            res.json({ exito: true, mensaje: 'Usuario creado exitosamente.' });
        } catch (error) {
            console.error("Error en registro:", error);
            res.status(500).json({ exito: false, mensaje: 'Error al registrar el usuario.' });
        }
    });
    // ==============================================================
    // 👤 RUTA: OBTENER PERFIL PARA REFERIDOS
    // ==============================================================
    app.get('/api/mi-perfil', async (req, res) => {
        try {
            // 2. Verificamos manualmente la sesión aquí adentro
        if (!req.session || !req.session.usuario) {
            return res.status(401).json({ exito: false, mensaje: "No has iniciado sesión" });
        }
            // Asegúrate de usar la variable donde guardas el usuario al loguearse
            const usuarioLogueado = req.session.usuario; 
            
            const cliente = await Cliente.findOne({ usuarioCasino: usuarioLogueado });
            
            if (cliente) {
                res.json({ 
                    exito: true, 
                    referralCode: cliente.referralCode,
                    usuario: cliente.usuarioCasino
                });
            } else {
                res.status(404).json({ exito: false, mensaje: "Usuario no encontrado" });
            }
        } catch (error) {
            console.error("Error al obtener perfil:", error);
            res.status(500).json({ exito: false, mensaje: "Error interno" });
        }
    });

    // ==============================================================
    // 🔐 RUTAS EXISTENTES
    // ==============================================================
    app.post('/api/validar-cliente', async (req, res) => {
        try {
            const { usuario, password } = req.body;
            const cliente = await buscarPorUsuarioCasino(usuario);
            
            if (cliente) {
                const esValida = await validarPasswordCliente(cliente, password);
                if (esValida) {
                    if (!cliente.password) {
                        await Cliente.updateOne({ _id: cliente._id }, { $set: { password: '1234' } });
                    }
                    
                    req.session.usuario = cliente.usuarioCasino;
                    
                    req.session.save(() => {
                        res.json({ exito: true, usuario: cliente.usuarioCasino });
                    });
                } else {
                    res.json({ exito: false }); 
                }
            } else {
                res.json({ exito: false }); 
            }
        } catch (error) {
            res.status(500).json({ exito: false, mensaje: 'Error en inicio de sesión.' });
        }
    });

app.post('/api/cargar-saldo', requireLogin, async (req, res) => {
    const { usuario, monto } = req.body;
    console.log(`--- [DEBUG] Intentando cargar ${monto} a ${usuario} ---`);
    
    try {
        const clienteActualizado = await Cliente.findOneAndUpdate(
            { usuarioCasino: usuario }, 
            { $inc: { creditos: monto } }, 
            { new: true }
        );

        if (!clienteActualizado) {
            console.log("❌ ERROR: Usuario no encontrado en DB");
            return res.status(404).json({ exito: false, mensaje: 'Usuario no encontrado.' });
        }

        console.log(`✅ Base de datos OK. Usuarios conectados actualmente: ${sharedState.usuariosConectados.length}`);
        
        // Buscamos el usuario
        const usuarioEnVivo = sharedState.usuariosConectados.find(u => 
            u.nombre.toLowerCase() === usuario.toLowerCase()
        );

        if (usuarioEnVivo) {
            console.log(`✅ Usuario encontrado en Sockets. ID: ${usuarioEnVivo.id}`);
            
            // Forzamos el emit
            io.to(usuarioEnVivo.id).emit('actualizar_creditos_en_vivo', { 
                creditos: clienteActualizado.creditos 
            });
            console.log(`🚀 EVENTO EMITIDO a ${usuarioEnVivo.id}`);
        } else {
            console.log(`⚠️ Usuario ${usuario} NO está en la lista de conectados.`);
            console.log("Lista actual:", JSON.stringify(sharedState.usuariosConectados));
        }

        res.json({ exito: true, mensaje: 'Saldo cargado' });
    } catch (error) {
        console.error("❌ ERROR CRÍTICO:", error);
        res.status(500).json({ exito: false, mensaje: 'Error interno.' });
    }
});

    app.post('/api/guardar-config', requireLogin, async (req, res) => {
        try {
            const { seccion, datos } = req.body;
            await PanelConfig.updateOne(
                { identificador: 'global' },
                { $set: { [seccion]: datos } },
                { upsert: true }
            );
            res.json({ exito: true });
        } catch (error) {
            res.status(500).json({ exito: false });
        }
    });

    app.post('/importar-datos', requireLogin, async (req, res) => {
        try {
            const { datosCrudos } = req.body;
            const lineas = datosCrudos.split('\n').map(l => l.trim()).filter(l => l !== '');
            let actualizados = 0;

            for (let i = 0; i < lineas.length; i++) {
                if (lineas[i].toLowerCase() === 'player') {
                    const usuario = lineas[i - 1];
                    const saldoString = lineas[i + 1];
                    if (usuario && saldoString) {
                        const saldoNumerico = parseFloat(saldoString.replace(/\./g, '').replace(',', '.'));
                        if (!isNaN(saldoNumerico)) {
                            // Al importar, también generamos código si no existe
                            await Cliente.updateOne(
                                { usuarioCasino: usuario }, 
                                { 
                                    $set: { saldo: saldoNumerico, estado: 'Activo' },
                                    $setOnInsert: { password: '1234', referralCode: generarCodigoReferido(usuario) }
                                }, 
                                { upsert: true }
                            );
                            actualizados++;
                        }
                    }
                }
            }
            res.json({ mensaje: `¡Se actualizaron ${actualizados} usuarios!` });
        } catch (error) {
            res.status(500).json({ mensaje: 'Hubo un error en el servidor.' });
        }
    });

    app.post('/api/editar-cliente', requireLogin, async (req, res) => {
        try {
            const { id, nuevoUser, nuevaPass } = req.body;
            
            const existeUser = await Cliente.findOne({
                usuarioCasino: { $regex: `^${escapeRegex(nuevoUser)}$`, $options: 'i' },
                _id: { $ne: id }
            });
            if (existeUser) {
                return res.status(400).json({ success: false, message: 'El nombre de usuario ya está en uso por otro cliente.' });
            }

            const updateData = { usuarioCasino: nuevoUser };
            if (nuevaPass && nuevaPass.trim() !== '') {
                updateData.password = nuevaPass.trim(); 
            }

            await Cliente.findByIdAndUpdate(id, updateData);
            
            if (sharedState && sharedState.adminSocketId && io) {
                const clientesDB = await Cliente.find().sort({ fechaRegistro: -1 });
                io.to(sharedState.adminSocketId).emit('cargar_datos_tablas', { clientes: clientesDB });
            }

            res.json({ success: true, message: 'Cliente actualizado correctamente.' });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Error interno al actualizar el cliente.', error: error.message });
        }
    });
};
