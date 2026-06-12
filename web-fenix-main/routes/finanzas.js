const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Retiro = require('../models/Retiro');
const bcrypt = require('bcryptjs');

module.exports = function(app, requireLogin, io, sharedState) {
    const CierreCaja = mongoose.model('CierreCaja');
    const Cliente = mongoose.model('Cliente');

    // Función auxiliar para notificar al panel administrativo
    const notificarPanelAdmin = async () => {
        if (sharedState && sharedState.adminSocketId) {
            const clientesDB = await Cliente.find();
            io.to(sharedState.adminSocketId).emit('cargar_datos_tablas', { clientes: clientesDB });
        }
    };

    // ==============================================================
    // 📊 RUTAS DE CIERRE DE CAJA, RESÚMENES E HISTORIAL
    // ==============================================================
    app.post('/api/cierre-caja', requireLogin, async (req, res) => {
        try {
            const filtro = { fecha: req.body.fecha, turno: req.body.turno };
            await CierreCaja.findOneAndUpdate(filtro, req.body, { upsert: true, new: true });
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/cierre-caja', requireLogin, async (req, res) => {
        try {
            const cierres = await CierreCaja.find().sort({ _id: -1 });
            res.json(cierres);
        } catch (err) {
            res.status(500).json([]);
        }
    });

    app.get('/api/resumen-cajas/:fecha', requireLogin, async (req, res) => {
        try {
            const fechaSelect = req.params.fecha; 
            const mesSelect = fechaSelect.substring(0, 7); 

            const cierresDia = await CierreCaja.find({ fecha: fechaSelect });
            const cierresMes = await CierreCaja.find({ fecha: { $regex: '^' + mesSelect } });

            let dia = {
                manana: { ingreso: 0, oro: 0, ganamos: 0, retiros: 0, real: 0 },
                tarde: { ingreso: 0, oro: 0, ganamos: 0, retiros: 0, real: 0 },
                noche: { ingreso: 0, oro: 0, ganamos: 0, retiros: 0, real: 0 },
                total: { ingreso: 0, oro: 0, ganamos: 0, retiros: 0, real: 0 }
            };

            cierresDia.forEach(c => {
                let t = c.turno.toLowerCase();
                if (t === 'mañana') t = 'manana';
                if (dia[t]) {
                    dia[t].ingreso += (c.ingreso || 0);
                    dia[t].oro += (c.saldoOro || 0);
                    dia[t].ganamos += (c.saldoGanamos || 0);
                    dia[t].retiros += (c.egreso || 0);
                    dia[t].real += (c.montoRealFinal || 0);
                    
                    dia.total.ingreso += (c.ingreso || 0);
                    dia.total.oro += (c.saldoOro || 0);
                    dia.total.ganamos += (c.saldoGanamos || 0);
                    dia.total.retiros += (c.egreso || 0);
                    dia.total.real += (c.montoRealFinal || 0);
                }
            });

            let mes = {
                salidas: { lean: 0, nahue: 0, brai: 0, tati: 0 },
                saldos: { oro: 0, ganamos: 0 },
                fichas: { mega: 0, ganamos: 0, oro: 0 },
                bonos: { bb: { cant: 0, monto: 0 }, br: { cant: 0, monto: 0 } }
            };

            cierresMes.forEach(c => {
                mes.saldos.oro += (c.saldoOro || 0);
                mes.saldos.ganamos += (c.saldoGanamos || 0);

                if (c.gastos && c.gastos.length > 0) {
                    c.gastos.forEach(g => {
                        const monto = Number(g.monto) || 0;
                        if (g.tipo === 'Salida Lean') mes.salidas.lean += monto;
                        if (g.tipo === 'Salida Nahue') mes.salidas.nahue += monto;
                        if (g.tipo === 'Salida Brai') mes.salidas.brai += monto;
                        if (g.tipo === 'Salida Tati') mes.salidas.tati += monto;
                        
                        if (g.tipo === 'Fichas Mega') mes.fichas.mega += monto;
                        if (g.tipo === 'Fichas Ganamos') mes.fichas.ganamos += monto;
                        if (g.tipo === 'Fichas Oro') mes.fichas.oro += monto;

                        if (g.tipo === 'BB') { mes.bonos.bb.cant += 1; mes.bonos.bb.monto += monto; }
                        if (g.tipo === 'BR') { mes.bonos.br.cant += 1; mes.bonos.br.monto += monto; }
                    });
                }
            });

            res.json({ dia, mes });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // === REEMPLAZAR LA RUTA VIEJA DEL HISTORIAL POR ESTA ===
    app.get('/api/historial-cajas/:fecha/:turno', requireLogin, async (req, res) => {
        try {
            const { fecha, turno } = req.params;
            
            // Busca el cierre y los retiros al mismo tiempo
            const cierre = await CierreCaja.findOne({ fecha: fecha, turno: turno });
            const registroRetiros = await Retiro.findOne({ fecha: fecha, turno: turno });
            
            res.json({
                cierre: cierre || null,
                retiros: registroRetiros ? registroRetiros.retiros : []
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==============================================================
    // 💸 RUTAS DE CONTROL DE RETIROS (NUEVO)
    // ==============================================================
    app.post('/api/guardar-retiros', requireLogin, async (req, res) => {
        try {
            const { fechaTurno, turnoGlobal, retiros } = req.body;
            console.log(`---- GUARDANDO RETIROS: ${fechaTurno} | ${turnoGlobal} ----`);
            console.log(`Cantidad de retiros recibidos: ${retiros ? retiros.length : 0}`);

            const filtro = { fecha: fechaTurno, turno: turnoGlobal };
            
            // LA MAGIA: Le pasamos 'strict: false' directo a la consulta para forzar la escritura
            const docGuardado = await Retiro.findOneAndUpdate(
                filtro, 
                { fecha: fechaTurno, turno: turnoGlobal, retiros: retiros || [] }, 
                { upsert: true, new: true, strict: false } 
            );
            
            res.json({ success: true, mensaje: "Retiros guardados" });
        } catch (err) {
            console.error("Error backend al guardar retiros:", err);
            res.status(500).json({ success: false, mensaje: err.message });
        }
    });

    app.get('/api/historial-cajas/:fecha/:turno', requireLogin, async (req, res) => {
        try {
            const { fecha, turno } = req.params;
            
            const cierre = await CierreCaja.findOne({ fecha: fecha, turno: turno });
            const registroRetiros = await Retiro.findOne({ fecha: fecha, turno: turno });
            
            res.json({
                cierre: cierre || null,
                retiros: registroRetiros && registroRetiros.retiros ? registroRetiros.retiros : []
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // Nueva ruta para verificar existencia
    app.get('/api/verificar-turno/:fecha/:turno', requireLogin, async (req, res) => {
        try {
            const { fecha, turno } = req.params;
            const existeRetiro = await Retiro.findOne({ fecha: fecha, turno: turno });
            const existeCierre = await CierreCaja.findOne({ fecha: fecha, turno: turno });
            
            res.json({ existe: !!(existeRetiro || existeCierre) });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    // ==============================================================
    // 💳 RUTAS DE GESTIÓN DE CRÉDITOS
    // ==============================================================

    app.get('/api/transacciones-pendientes', requireLogin, async (req, res) => {
        try {
            const tipo = req.query.tipo;
            const transacciones = await Transaction.find({ type: tipo, status: 'pending' }).populate('userId', 'usuarioCasino', 'usuarioCasino bonoPendiente');
            res.json({ transacciones });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/solicitar-carga-creditos', requireLogin, async (req, res) => {
        try {
            const { userId, amount, receiptUrl } = req.body;
            const nuevaTransaccion = new Transaction({
                userId,
                type: 'credit_charge',
                amount,
                receiptUrl,
                status: 'pending'
            });
            await nuevaTransaccion.save();
            await notificarPanelAdmin();
            res.json({ success: true, message: 'Reporte de pago enviado.' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    app.post('/api/aprobar-carga-creditos', requireLogin, async (req, res) => {
        try {
            const { transactionId } = req.body;
            const transaccion = await Transaction.findById(transactionId);
            
            if (!transaccion || transaccion.status !== 'pending') {
                return res.status(400).json({ success: false, message: 'Transacción no válida.' });
            }

            transaccion.status = 'approved';
            transaccion.resolvedAt = new Date();
            await transaccion.save();

            const cliente = await Cliente.findById(transaccion.userId);
            cliente.creditos = (cliente.creditos || 0) + transaccion.amount;
            cliente.bonoPendiente = null;
            await cliente.save();

            const socketCliente = sharedState.usuariosConectados.find(u => u.nombre === cliente.usuarioCasino);
            if (socketCliente && io) {
                io.to(socketCliente.socketId).emit('actualizar_creditos', { nuevosCreditos: cliente.creditos });
            }

            await notificarPanelAdmin();
            res.json({ success: true, message: 'Créditos cargados.', nuevosCreditos: cliente.creditos });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

   app.post('/api/gestion-manual-creditos', requireLogin, async (req, res) => {
    try {
        const { userId, amount, action } = req.body;
        const cliente = await Cliente.findById(userId);

        if (!cliente) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

        if (action === 'add') cliente.creditos = (cliente.creditos || 0) + amount;
        else if (action === 'remove') cliente.creditos = Math.max(0, (cliente.creditos || 0) - amount);

        await cliente.save();
        await notificarPanelAdmin();
        
        // --- CORRECCIÓN AQUÍ ---
        // 1. Usamos toLowerCase() para comparar sin importar mayúsculas
        const socketCliente = sharedState.usuariosConectados.find(u => 
            u.nombre.toLowerCase() === cliente.usuarioCasino.toLowerCase()
        );

        console.log(`DEBUG: Buscando usuario ${cliente.usuarioCasino}. ¿Encontrado?: ${!!socketCliente}`);

        if (socketCliente && io) {
            // 2. Usamos el nombre de evento correcto: 'actualizar_creditos_en_vivo'
            // 3. Usamos .id (verificá si en tu objeto es .id o .socketId)
            const idParaEmitir = socketCliente.id || socketCliente.socketId; 
            
            console.log(`🚀 Emitiendo 'actualizar_creditos_en_vivo' al socket ${idParaEmitir}`);
            
            io.to(idParaEmitir).emit('actualizar_creditos_en_vivo', { 
                creditos: cliente.creditos 
            });
        } else {
            console.log(`⚠️ Usuario ${cliente.usuarioCasino} no encontrado en sockets.`);
        }

        res.json({ success: true, message: 'Créditos actualizados.' });
    } catch (error) {
        console.error("Error en finanzas.js:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});
};
