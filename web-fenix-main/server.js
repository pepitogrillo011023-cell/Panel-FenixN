/*// TRUCO TEMPORAL PARA GENERAR LLAVES PUSH
try {
    const webpush = require('web-push');
    const keys = webpush.generateVAPIDKeys();
    console.log("========================================");
    console.log("TU CLAVE PÚBLICA:", keys.publicKey);
    console.log("TU CLAVE PRIVADA:", keys.privateKey);
    console.log("========================================");
} catch (e) {
    console.log("Esperando que Render termine de instalar web-push...");
}
*/

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const session = require('express-session'); 
const path = require('path');
const bcrypt = require('bcryptjs');
const webpush = require('web-push');
const multer = require('multer'); // <--- 🛠️ AGREGÁ ESTA LÍNEA ACÁ
const fs = require('fs');

const NEW_USER_HOURS = parseInt(process.env.NEW_USER_HOURS || '24', 10);

function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mensajeEstaLeido(m) {
    return m.is_read === true || m.leido === true;
}

function marcarMensajeLeido(m) {
    m.is_read = true;
    m.leido = true;
}

function crearMensajeChat(emisor, mensaje, extra = {}) {
    return {
        emisor,
        mensaje,
        is_read: false,
        leido: false,
        hora: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
        ...extra
    };
}



// Importar modelos
const slotRoutes = require('./routes/slot'); 
console.log("CONTENIDO DE SLOTROUTES:", slotRoutes); // <--- AGREGA ESTO
const Minigame = require('./models/Minigame');
const User = require('./models/User');
const RetiroSolicitud = require('./models/RetiroSolicitud');

const app = express();
const server = http.createServer(app);
// 🔥 CONFIGURACIÓN INTERNA DE WEB PUSH
webpush.setVapidDetails(
    process.env.VAPID_EMAIL,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    },
    transports: ['websocket'],
    // 🔥 AGREGÁ ESTAS DOS LÍNEAS AQUÍ ABAJO:
    pingTimeout: 60000, 
    pingInterval: 25000 
});

// ==============================================================
// 1. MODELOS DE DATOS
// ==============================================================
const configRetencionSchema = new mongoose.Schema({
    id: { type: String, default: 'config_global' },
    reglas: {
        h24: { activo: { type: Boolean, default: true }, mensaje: { type: String, default: '' } },
        d3:  { activo: { type: Boolean, default: true }, mensaje: { type: String, default: '' } },
        d7:  { activo: { type: Boolean, default: true }, mensaje: { type: String, default: '' } },
        d15: { activo: { type: Boolean, default: true }, mensaje: { type: String, default: '' } },
        d30: { activo: { type: Boolean, default: true }, mensaje: { type: String, default: '' } }
    }
});
const ConfigRetencion = mongoose.model('ConfigRetencion', configRetencionSchema);
 

const clienteSchema = new mongoose.Schema({
    usuarioCasino: { type: String, required: true, unique: true },
    password: { type: String, default: '1234' },
    saldo: { type: Number, default: 0 },
    creditos: { type: Number, default: 0 },
    wager: { type: Number, default: 0 },
    estado: { type: String, default: 'Activo' },
    historialChat: { type: Array, default: [] },
    ultimaConexion: { type: Date, default: Date.now },
    ultimaRuleta: { type: Date, default: null },
    ultimaRaspa: { type: Date, default: null },
    ultimaTragamonedas: { type: Date, default: null },
    ultimaCarta: { type: Date, default: null },
    ultimaMoneda: { type: Date, default: null },
    lastWithdrawal: { type: Date, default: null },
    
     // --- CAMPOS NUEVOS ---
    referralCode: { type: String, unique: true, index: true }, 
    referredBy: { type: String, default: null },
    pushSubscription: { type: Object, default: null },
    bonoPendiente: { type: String, default: null },// <--- AGREGÁ ESTA LÍNEA ACÁ
    soportePendiente: { type: Boolean, default: false },
    fechaRegistro: { type: Date, default: Date.now }
    
  
});

// Middleware automático: Crea el código al guardar
clienteSchema.pre('save', function(next) {
    if (!this.referralCode) {
        const prefijo = this.usuarioCasino.substring(0, 3).toUpperCase();
        const aleatorio = Math.floor(1000 + Math.random() * 9000);
        this.referralCode = `${prefijo}${aleatorio}`;
    }
    next();
});

const Cliente = mongoose.model('Cliente', clienteSchema);

function buscarClientePorUsuario(usuario) {
    return Cliente.findOne({
        usuarioCasino: { $regex: `^${escapeRegex(usuario)}$`, $options: 'i' }
    });
}

async function enviarPushCliente(usuarioCasino, title, body) {
    try {
        const cliente = await buscarClientePorUsuario(usuarioCasino);
        if (!cliente || !cliente.pushSubscription) return;

        const payload = JSON.stringify({ title, body, icon: '/icon.png' });
        await webpush.sendNotification(cliente.pushSubscription, payload);
    } catch (err) {
        console.error('Error al enviar push:', err.message);
        if (err.statusCode === 410 || err.statusCode === 404) {
            await Cliente.updateOne(
                { usuarioCasino: { $regex: `^${escapeRegex(usuarioCasino)}$`, $options: 'i' } },
                { pushSubscription: null }
            );
        }
    }
}


const Ruleta = mongoose.model('Ruleta', new mongoose.Schema({ configuracion: Array }));
const Raspa = mongoose.model('Raspa', new mongoose.Schema({ configuracion: Array }));
const Tragamonedas = mongoose.model('Tragamonedas', new mongoose.Schema({ configuracion: Array }));
const Cartas = mongoose.model('Cartas', new mongoose.Schema({ configuracion: Array }));
const Moneda = mongoose.model('Moneda', new mongoose.Schema({ configuracion: Array }));

const PanelConfig = mongoose.model('PanelConfig', new mongoose.Schema({
    identificador: { type: String, default: 'global', unique: true },
    retencion: { type: Array, default: [] },
    apis: { type: Object, default: {} },
    push: { type: Object, default: {} },
    billetera: { type: Object, default: {} },
    tienda: { type: Array, default: [] } // <-- Agregado para que MongoDB lo guarde
}));

const CierreCaja = mongoose.model('CierreCaja', new mongoose.Schema({
    fecha: String, hora: String, inicio: String, fin: String, turno: String, cajero: String,
    fechaInicio: String, fechaFin: String, horaInicio: String, horaFin: String,
    ingreso: Number, saldoOro: Number, saldoGanamos: Number, egreso: Number,
    montoEsperado: Number, montoRealFinal: Number, sobranteFaltante: Number, reserva: Number,
    gastos: Array, propinas: Array
}));

const Retiro = mongoose.model('Retiro', new mongoose.Schema({
    fecha: { type: String, default: () => new Date().toLocaleString('es-AR') },
    cliente: String, monto: Number, cbuAlias: String, titular: String,
    estado: { type: String, default: 'Aprobado (Enviado)' },
    procesadoPor: { type: String, default: 'Lambda (Automático)' }
}));
const Carga = mongoose.model('Carga', new mongoose.Schema({
    usuario: { type: String, required: true },
    plataforma: { type: String, required: true },
    monto: { type: Number, required: true },
    comprobante: { type: String, required: true }, // Guardará el nombre del archivo (ej: comprobante-123.jpg)
    estado: { type: String, default: 'pendiente' }, // 'pendiente', 'aprobado', 'rechazado'
    fecha: { type: Date, default: Date.now }
}));

const UsuarioInterno = mongoose.model('UsuarioInterno', new mongoose.Schema({
    nombre: String, usuario: String, email: String, rol: String, estado: { type: String, default: 'Activo' }
}));

// ==============================================================
// 2. CONEXIÓN A MONGODB
// ==============================================================
if(process.env.MONGO_URI && process.env.MONGO_URI !== 'AQUI_VA_TU_ENLACE_DE_MONGODB') {
    mongoose.connect(process.env.MONGO_URI, { family: 4 })
        .then(async () => {
            console.log('🟢 CONECTADO A MONGODB');
            
            // 1. Tu migración existente de referidos (Queda igual)
            try {
                const sinCodigo = await Cliente.find({ referralCode: { $exists: false } });
                for (const user of sinCodigo) {
                    const prefijo = user.usuarioCasino.substring(0, 3).toUpperCase();
                    const aleatorio = Math.floor(1000 + Math.random() * 9000);
                    user.referralCode = `${prefijo}${aleatorio}`;
                    await user.save();
                }
                if(sinCodigo.length > 0) {
                    console.log(`✅ ${sinCodigo.length} usuarios actualizados con código de referido.`);
                }
            } catch (err) {
                console.error("❌ Error en la migración de referidos:", err);
            }

           // 🎁 2. NUEVA MIGRACIÓN: Inicializar bonos en tus CLIENTES reales
try {
    const totalClientes = await Cliente.countDocuments();
    const clientesConBono = await Cliente.countDocuments({ bonoPendiente: { $exists: true } });
    
    console.log(`📊 [REPORTE REAL] Total de jugadores en DB: ${totalClientes}`);
    console.log(`📊 [REPORTE REAL] Jugadores que YA tienen el campo: ${clientesConBono}`);
    
    if (totalClientes > clientesConBono) {
        // Agregamos { strict: false } al final para saltear bloqueos del esquema temporalmente
        const resultado = await Cliente.updateMany(
            { bonoPendiente: { $exists: false } },
            { $set: { bonoPendiente: null } },
            { strict: false } 
        );
        
        // Esto nos va a mostrar en la consola EXACTAMENTE qué respondió MongoDB
        console.log("🔍 Respuesta cruda de Mongo:", JSON.stringify(resultado));
        
        // Detecta la cantidad de modificados según tu versión de Mongoose
        const actualizados = resultado.modifiedCount !== undefined ? resultado.modifiedCount : (resultado.nModified !== undefined ? resultado.nModified : "OK");
        console.log(`✅ Migración de bonos ejecutada. Estado: ${actualizados}`);
    } else {
        console.log(`😎 Todo perfecto: Todos los jugadores ya tienen el campo 'bonoPendiente'.`);
    }
} catch (err) {
    console.error("❌ Error en la migración de bonos:", err);
}

            try {
                const retirosSinPlataforma = await RetiroSolicitud.updateMany(
                    { plataforma: { $exists: false } },
                    { $set: { plataforma: 'Créditos' } }
                );
                const actualizados = retirosSinPlataforma.modifiedCount ?? retirosSinPlataforma.nModified ?? 0;
                if (actualizados > 0) {
                    console.log(`✅ ${actualizados} solicitudes de retiro actualizadas con plataforma 'Créditos'.`);
                }
            } catch (err) {
                console.error("❌ Error en la migración de plataforma en retiros:", err);
            }

            // Migración: fechaRegistro en clientes existentes
            try {
                const sinFechaRegistro = await Cliente.find({ fechaRegistro: { $exists: false } });
                for (const user of sinFechaRegistro) {
                    user.fechaRegistro = user._id.getTimestamp();
                    await user.save();
                }
                if (sinFechaRegistro.length > 0) {
                    console.log(`✅ ${sinFechaRegistro.length} clientes actualizados con fechaRegistro.`);
                }
            } catch (err) {
                console.error("❌ Error en migración fechaRegistro:", err);
            }

            // Migración: is_read en mensajes de chat (sincroniza con leido)
            try {
                const clientesConChat = await Cliente.find({ 'historialChat.0': { $exists: true } });
                let chatsMigrados = 0;
                for (const c of clientesConChat) {
                    let changed = false;
                    c.historialChat.forEach(m => {
                        if (m.is_read === undefined) {
                            m.is_read = m.leido === true;
                            changed = true;
                        }
                        if (m.leido === undefined) {
                            m.leido = m.is_read === true;
                            changed = true;
                        }
                    });
                    if (changed) {
                        await c.save();
                        chatsMigrados++;
                    }
                }
                if (chatsMigrados > 0) {
                    console.log(`✅ ${chatsMigrados} historiales de chat migrados con is_read.`);
                }
            } catch (err) {
                console.error("❌ Error en migración is_read:", err);
            }

            await inicializarDatosDePrueba();
        })
        .catch(err => console.log('🔴 ERROR DE MONGODB:', err));
}

// ==============================================================
// 3. MIDDLEWARES, SESIÓN Y SEGURIDAD
// ==============================================================

// Configuración robusta para Render (Proxy) - DEBE IR ANTES DE LA SESIÓN
app.set('trust proxy', 1); 

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

app.use((req, res, next) => {
    console.log(`Petición recibida: ${req.method} ${req.path}`);
    next();
});
app._router.stack.forEach(function(r){
  if (r.route && r.route.path){
    console.log("Ruta definida: " + r.route.path);
  } else if (r.name === 'router') {
    r.handle.stack.forEach(function(handler){
      if (handler.route) {
        console.log("Ruta en router: " + handler.route.path);
      }
    });
  }
});
// UNA SOLA CONFIGURACIÓN DE SESIÓN (Producción / Render lista)
app.use(session({
    secret: 'CasinoFenix2026_Seguro', // Tu secreto definitivo
    name: 'sessionId',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: true,      // OBLIGATORIO: Para HTTPS en Render
        sameSite: 'lax',  // OBLIGATORIO: Permite comunicación cross-site en Render
        maxAge: 1000 * 60 * 60 * 24 // 24 horas de duración máxima
    }
}));

// Middleware de protección de rutas
const requireLogin = (req, res, next) => {
    if (req.session && req.session.loggedIn) {
        return next();
    }
    
    // Si es un fetch, devolvemos 401, si es navegación normal, redirigimos
    if (req.originalUrl.startsWith('/api/')) {
        return res.status(401).json({ message: "No autorizado" });
    }
    
    res.redirect('/login.html');
};

// ==============================================================
// RUTAS DE AUTENTICACIÓN Y MENÚ
// ==============================================================
// RUTA PARA GUARDAR LAS REGLAS DESDE EL PANEL DE CONTROL (ADMIN)
app.post('/api/guardar-reglas-retencion', requireLogin, async (req, res) => {
    try {
        if (req.session.userId !== 'admin') {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const { reglas } = req.body;

        await ConfigRetencion.findOneAndUpdate(
            { id: 'config_global' },
            { reglas: reglas },
            { upsert: true, new: true }
        );

        res.status(200).json({ success: true, mensaje: '¡Reglas de retención guardadas correctamente! 🚀' });
    } catch (error) {
        console.error('Error al guardar reglas de retención:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // 1. Caso especial: Admin (si no está en la BD)
        if (username === 'admin' && password === '1234') {
            req.session.loggedIn = true;
            req.session.userId = 'admin';
            return req.session.save(() => res.redirect('/admin.html'));
        }

        // 2. Caso clientes: Buscar en la BD por 'usuarioCasino'
        const user = await User.findOne({ usuarioCasino: username });

        if (user && await bcrypt.compare(password, user.password)) {
            req.session.loggedIn = true;
            req.session.userId = user._id;
            
            return req.session.save(() => {
                res.redirect('/index.html');
            });
        } else {
            res.send('Usuario o contraseña incorrectos. <a href="/login.html">Volver</a>');
        }
    } catch (error) {
        console.error("Error en login:", error);
        res.status(500).send("Error interno.");
    }
});
// Servir la página de aterrizaje
app.get('/landing', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});
app.get('/privacidad', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'privacidad.html'));
});


// MODIFICADO: Logout seguro con función Callback
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Error al destruir la sesión:", err);
            return res.send("Error al cerrar sesión.");
        }
        // Borramos la cookie del navegador manualmente para mayor seguridad
        res.clearCookie('sessionId'); 
        res.redirect('/login.html');
    });
});
// 🔥 NUEVO: Cierre de sesión exclusivo para los Clientes (Pegalo acá)
app.get('/logout-cliente', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Error al destruir la sesión del cliente:", err);
            return res.send("Error al cerrar sesión.");
        }
        // Borramos la misma cookie
        res.clearCookie('sessionId'); 
        
        // 🚪 Redirigimos al inicio o al login de clientes
        // Si tu pantalla principal de carga/login es la raíz, dejás '/'
        res.redirect('/index.html'); 
    });
});

app.get('/admin.html', requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/admin/estadisticas.html', requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'estadisticas.html'));
});
app.post('/api/cambiar-contrasena', async (req, res) => {
    try {
        const { nuevaPassword } = req.body;

        if (!nuevaPassword || nuevaPassword.trim().length < 6) {
            return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres' });
        }

        // Cliente autenticado vía sesión de jugador
        if (req.session && req.session.usuario) {
            const hashedPassword = await bcrypt.hash(nuevaPassword.trim(), 10);
            const cliente = await buscarClientePorUsuario(req.session.usuario);
            if (!cliente) {
                return res.status(404).json({ message: 'Usuario no encontrado' });
            }
            await Cliente.findByIdAndUpdate(cliente._id, { password: hashedPassword });
            return res.json({ success: true, message: 'Contraseña actualizada' });
        }

        // Usuario del panel (colección User)
        const userId = req.session?.userId;
        if (!req.session?.loggedIn || !userId || userId === 'admin') {
            return res.status(401).json({ message: 'No autorizado para cambiar contraseña' });
        }

        const hashedPassword = await bcrypt.hash(nuevaPassword.trim(), 10);
        await User.findByIdAndUpdate(userId, { password: hashedPassword });

        res.json({ success: true, message: 'Contraseña actualizada' });
    } catch (error) {
        console.error('Error al cambiar contraseña:', error);
        res.status(500).json({ message: 'Error al actualizar la contraseña' });
    }
});
// 📌 RUTA NUEVA: GUARDAR LA SUSCRIPCIÓN PUSH DEL CELULAR DEL JUGADOR
app.post('/api/guardar-suscripcion', requireLogin, async (req, res) => {
    try {
        const userId = req.session.userId;

        // Validamos que no sea el admin global
        if (!userId || userId === 'admin') {
            return res.status(400).json({ error: 'No se puede generar suscripción push para el Admin' });
        }

        const { subscription } = req.body;

        // 1. Buscamos el usuario en la colección 'User' usando el ID de la sesión
        const usuarioLogueado = await User.findById(userId);
        if (!usuarioLogueado) {
            return res.status(404).json({ error: 'Usuario de autenticación no encontrado' });
        }

        // 2. Buscamos y actualizamos su perfil de juego en la colección 'Cliente'
        await Cliente.findOneAndUpdate(
            { usuarioCasino: usuarioLogueado.usuarioCasino },
            { 
                pushSubscription: subscription,
                ultimaConexion: new Date() // Actualizamos su última actividad
            }
        );

        res.status(200).json({ mensaje: 'Suscripción guardada con éxito 🎉' });
    } catch (error) {
        console.error('Error al guardar la suscripción push:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});
// RUTA PARA EXTREER LA CLAVE PÚBLICA DESDE EL .ENV HACIA EL FRONTEND
app.get('/api/vapid-public-key', (req, res) => {
    if (!process.env.VAPID_PUBLIC_KEY) {
        return res.status(500).json({ error: "Falta configurar VAPID_PUBLIC_KEY en las variables de entorno de Render" });
    }
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// 🔥 RUTA TEMPORAL PARA PROBAR EL PUSH AL TOQUE
app.get('/api/test-push-rapido', async (req, res) => {
    try {
        const { usuario } = req.query;
        if (!usuario) {
            return res.send("Falta poner el usuario en la URL. Ej: /api/test-push-rapido?usuario=tu_usuario");
        }

        // Buscamos tu usuario en la base de datos de Clientes
        const cliente = await Cliente.findOne({ usuarioCasino: usuario });
        
        if (!cliente) {
            return res.send(`No se encontró el usuario '${usuario}' en la colección Cliente.`);
        }

        if (!cliente.pushSubscription) {
            return res.send(`El usuario '${usuario}' existe, pero NO tiene una suscripción Push registrada. Asegurate de haber entrado desde el celu y darle al botón de permitir.`);
        }

        // El mensaje de prueba que va a viajar al celular
        const payload = JSON.stringify({
            title: '🎰 Casino Fénix 🦅',
            body: '¡Espectacular! Si estás viendo esto, las notificaciones push nativas están activas al 100%. 🚀'
        });

        // Enviamos la notificación push directo a tu dispositivo
        await webpush.sendNotification(cliente.pushSubscription, payload);
        
        res.send(`¡Notificación enviada con éxito al usuario ${usuario}! Revisa la pantalla de tu celu.`);
    } catch (error) {
        console.error("Error en el test de push:", error);
        res.status(500).send("Error al enviar el push: " + error.message);
    }
});
// ==============================================================
// 🛠️ CONFIGURACIÓN DE MULTER PARA GUARDAR COMPROBANTES DE CARGA
// ==============================================================

// Nos aseguramos de que exista una carpeta llamada "uploads" en el servidor para que no falle
const carpetaUploads = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(carpetaUploads)){
    fs.mkdirSync(carpetaUploads, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, carpetaUploads); // Guarda las fotos en public/uploads/
    },
    filename: function (req, file, cb) {
        // Le ponemos de nombre un número único (timestamp) + su extensión original (ej: .jpeg)
        cb(null, 'comprobante-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// ==========================================================================
// 📥 1. RECIBE EL COMPROBANTE QUE SUBE EL USUARIO DESDE EL JUEGO
// ==========================================================================
app.post('/api/subir-comprobante', upload.single('comprobante'), async (req, res) => {
    try {
        const { usuario, plataforma, monto } = req.body;
        const archivo = req.file;

        if (!archivo) {
            return res.status(400).json({ exito: false, mensaje: "No se recibió ninguna imagen de comprobante." });
        }

        const nuevaSolicitud = new Carga({
            usuario: usuario,
            plataforma: plataforma,
            monto: Number(monto),
            comprobante: archivo.filename
        });
        
        await nuevaSolicitud.save();

        res.json({ 
            exito: true, 
            mensaje: "¡Comprobante recibido y registrado en espera de aprobación!" 
        });

    } catch (error) {
        console.error("❌ Error en el servidor al procesar comprobante:", error);
        res.status(500).json({ exito: false, mensaje: "Error interno del servidor al procesar la imagen." });
    }
});

app.get('/api/admin/cargas-pendientes', requireLogin, async (req, res) => {
    try {
        const pendientes = await Carga.find({ estado: 'pendiente' }).sort({ fecha: 1 }).lean();
        
        const cargasConBono = await Promise.all(pendientes.map(async (carga) => {
            
            // 🎯 BUSCAMOS EN CLIENTE: Usamos usuarioCasino para machear con carga.usuario
            const clienteDB = await Cliente.findOne({ usuarioCasino: carga.usuario }); 
            
            return {
                ...carga,
                bonoPendiente: clienteDB ? clienteDB.bonoPendiente : null 
            };
        }));

        res.json(cargasConBono);

    } catch (err) {
        console.error("Error al obtener cargas pendientes:", err);
        res.status(500).json({ exito: false, mensaje: "Error en el servidor al traer la lista." });
    }
});

// ==========================================================================
// 👑 3. PROCESA LA DECISIÓN DEL CAJERO (APROBAR CON CRÉDITO LOCAL O RECHAZAR)
// ==========================================================================
app.post('/api/admin/procesar-carga', requireLogin, async (req, res) => {
    try {
        const { id, accion } = req.body; 
        
        const solicitud = await Carga.findById(id);
        if (!solicitud) {
            return res.status(404).json({ exito: false, mensaje: "La solicitud de carga ya no existe." });
        }

        const cliente = await Cliente.findOne({ usuarioCasino: solicitud.usuario });
        let mensajePush = "";

        if (accion === 'aprobar') {
            solicitud.estado = 'aprobado';

            // 🎁 SI EL CLIENTE EXISTE, CONSUMIMOS SU BONO AL APROBAR
            if (cliente) {
                cliente.bonoPendiente = null; 
                
                // Si es la plataforma interna de Créditos, le sumamos el monto
                if (solicitud.plataforma === 'Créditos') {
                    cliente.creditos += solicitud.monto;
                }
                
                // 🔥 Guardamos al cliente (guarda el reseteo del bono y/o los créditos)
                await cliente.save();
            }

            // Armamos el mensaje para la notificación push según la plataforma
            if (solicitud.plataforma === 'Créditos') {
                mensajePush = `¡Tu carga de $${solicitud.monto} en CRÉDITOS fue APROBADA! 💰 Tu saldo se actualizó.`;
            } else {
                mensajePush = `¡Tu carga de $${solicitud.monto} en ${solicitud.plataforma} fue APROBADA! 🎉 Revisa tu cajero.`;
            }

        } else {
            // ❌ Si se rechaza, NO tocamos al cliente. Así conserva el bono para la próxima carga.
            solicitud.estado = 'rechazado';
            mensajePush = `Tu carga de $${solicitud.monto} en ${solicitud.plataforma} fue rechazada. ❌ Revisa el comprobante.`;
        }

        // Guardamos los cambios de la solicitud de carga
        await solicitud.save();

        // Avisamos por WebSockets al frontend del cliente en tiempo real
        if (io) {
            io.emit('resultado_carga_cliente', {
                usuario: solicitud.usuario,
                estado: solicitud.estado,
                monto: solicitud.monto,
                plataforma: solicitud.plataforma,
                nuevoSaldo: cliente ? cliente.creditos : 0
            });
        }

        // Enviamos la notificación push al celular/navegador del cliente si está suscrito
        if (cliente && cliente.pushSubscription) {
            const payload = JSON.stringify({
                title: '🎰 Casino Fénix',
                body: mensajePush,
                icon: '/icon.png'
            });

            webpush.sendNotification(cliente.pushSubscription, payload)
                .catch(err => console.error("Error al enviar Push de carga:", err));
        }

        res.json({ exito: true, mensaje: `La solicitud fue ${solicitud.estado} con éxito.` });

    } catch (err) {
        console.error("Error al procesar la carga administrativa:", err);
        res.status(500).json({ exito: false, mensaje: "Error interno al guardar la resolución." });
    }
});

// ==========================================
// RUTA DEL SLOT CORREGIDA (Usando Cliente)
// ==========================================
app.post('/api/jugar-slot', async (req, res) => {
    const { usuario, apuestaGasto, apuestaCalculoPremio, esGiroGratis } = req.body;

    try {
        // 1. BUSCAR AL USUARIO en la colección 'Cliente' (donde guardas todo lo demás)
        const cliente = await Cliente.findOne({ usuarioCasino: usuario });
        
        if (!cliente) {
            return res.status(404).json({ exito: false, mensaje: "Usuario no encontrado en Cliente" });
        }

        // 2. VALIDAR SALDO (usando cliente.creditos)
        if (!esGiroGratis && cliente.creditos < apuestaGasto) {
            return res.status(400).json({ exito: false, mensaje: "Créditos insuficientes" });
        }

        // 3. COBRAR
        if (!esGiroGratis) {
            cliente.creditos -= apuestaGasto;
        }

        // 4. GENERAR GIRO
        const rodillos = [tirarRodillo(), tirarRodillo(), tirarRodillo()];
        let premio = 0;
        const esGanador = (rodillos[0] === rodillos[1] && rodillos[1] === rodillos[2]);
        const simboloGanador = rodillos[0];

        // 5. CALCULAR PREMIO
        if (esGanador && tablaPremios[simboloGanador]) {
            premio = apuestaCalculoPremio * tablaPremios[simboloGanador];
            cliente.creditos += premio;
        }

        // 6. GUARDAR
        await cliente.save();

        // 7. RESPUESTA
        res.json({
            exito: true,
            rodillos: rodillos,
            premioGanado: premio,
            nuevoSaldo: cliente.creditos,
            esBonus: esGanador && simboloGanador === 'bonus'
        });

    } catch (error) {
        console.error("Error en la jugada del slot:", error);
        res.status(500).json({ exito: false, mensaje: "Error procesando la jugada" });
    }
});

// ==============================================================
// 5. MOTOR DEL SLOT PREMIUM (FÉNIX SLOTS)
// ==============================================================
const todosLosSimbolos = ['laud', 'bufon', 'zapatos', 'bonus', 'clavas', 'esfera'];

app.get('/api/obtener-saldo', async (req, res) => {
    try {
        const { usuario } = req.query;
        const cliente = await Cliente.findOne({ usuarioCasino: usuario }); 
        if (!cliente) return res.status(404).json({ exito: false, mensaje: "Usuario no encontrado" });
        res.json({ exito: true, saldo: cliente.creditos });
    } catch (error) { res.status(500).json({ exito: false, mensaje: "Error del servidor" }); }
});


/*app.use('/api', slotRoutes); // ESTO MONTA TODO LO QUE SEA /api/jugar-slot*/

app.use(express.static(path.join(__dirname, 'public')));

// ==============================================================
// 4. MEMORIA COMPARTIDA Y WEBHOOKS
// ==============================================================
const sharedState = {
    usuariosConectados: [],
    adminSocketId: null,
    usuarioSeleccionadoActivoAdmin: null
};

async function notificarRetirosPendientesAdmin() {
    const count = await RetiroSolicitud.countDocuments({ estado: 'pendiente' });
    if (sharedState.adminSocketId) {
        io.to(sharedState.adminSocketId).emit('retiros_pendientes_actualizados', { count });
    }
    return count;
}

app.post('/api/webhook/billetera', async (req, res) => {
    res.status(200).send("OK");
    try {
        const accion = req.body?.action; const tipo = req.body?.type; const paymentId = req.body?.data?.id;
        if ((accion === 'payment.created' || tipo === 'payment') && paymentId) {
            const configDb = await PanelConfig.findOne({ identificador: 'global' });
            const accessTokenMP = configDb?.apis?.pass; 
            if (!accessTokenMP) return;

            const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                method: 'GET', headers: { 'Authorization': `Bearer ${accessTokenMP}` }
            });
            const dataMP = await mpResponse.json();

            if (dataMP.status === 'approved') {
                const montoTransferido = dataMP.transaction_amount;
                const saldoFormateado = `$${Number(montoTransferido).toLocaleString('es-AR')} ARS`;

                let datosBilleteraActuales = configDb.billetera || {};
                datosBilleteraActuales.monto = saldoFormateado;
                await PanelConfig.updateOne({ identificador: 'global' }, { $set: { billetera: datosBilleteraActuales } });

                if (sharedState.adminSocketId) {
                    io.to(sharedState.adminSocketId).emit('billetera_actualizada_en_vivo', {
                        saldoFormateado: saldoFormateado, montoTransferido: montoTransferido, tipoMovimiento: 'ingreso'
                    });
                }
            }
        }
    } catch (error) { console.error("🔴 Error procesando Webhook:", error); }
});
// --- RUTA PARA CONFIGURACIÓN DE MINIJUEGOS ---
app.get('/api/configuracion-minijuegos', async (req, res) => {
    try {
        const minijuegos = await Minigame.find({});
        res.json({ success: true, minijuegos: minijuegos });
    } catch (e) {
        res.status(500).json({ success: false, message: "Error al cargar costos" });
    }
});

// --- RUTA PARA OBTENER TIENDA ---
app.get('/api/tienda', async (req, res) => {
    try {
        const config = await PanelConfig.findOne({ identificador: 'global' });
        res.json(config.tienda && config.tienda.length > 0 ? config.tienda : [
            { nombre: 'Bono 10%', costo: 500 },
            { nombre: '10 Tiradas', costo: 1000 },
            { nombre: 'Bono 20%', costo: 2000 },
            { nombre: 'Bono 50%', costo: 5000 }
        ]);
    } catch (e) { res.status(500).json([]); }
});

// --- RUTA PARA GUARDAR TIENDA DESDE ADMIN ---
app.post('/api/admin/actualizar-tienda', requireLogin, async (req, res) => {
    try {
        const { productos } = req.body; 
        await PanelConfig.updateOne({ identificador: 'global' }, { $set: { tienda: productos } }, { upsert: true });
        res.json({ exito: true, mensaje: "Tienda actualizada" });
    } catch (e) { res.status(500).json({ exito: false }); }
});

app.post('/api/canjear-producto', async (req, res) => {
    try {
        const { usuario, nombre, costo } = req.body;
        const cliente = await Cliente.findOne({ usuarioCasino: usuario });
        
        if (!cliente) return res.status(404).json({ exito: false, mensaje: "Usuario no encontrado" });
        
        // 🛑 1. CONTROL DE SEGURIDAD: Evita que el usuario compre otro bono si ya tiene uno activo
        if (cliente.bonoPendiente) {
            return res.status(400).json({ 
                exito: false, 
                mensaje: `Ya tenés un '${cliente.bonoPendiente}' pendiente para tu próxima carga. ¡Usalo primero!` 
            });
        }

        if (cliente.creditos < costo) return res.status(400).json({ exito: false, mensaje: "Créditos insuficientes" });

        // 💸 Descontamos los créditos
        cliente.creditos -= costo;
        
        // 🎁 🔥 ¡ESTA ES LA LÍNEA QUE FALTA EN TU CÓDIGO! 🔥
        // Guarda el nombre del bono (ej: "Bono 100%") en el perfil del jugador
        cliente.bonoPendiente = nombre; 

        // Guardamos los dos cambios juntos en MongoDB (los créditos y el bono)
        await cliente.save();
        
        // Respondemos con éxito mandando el nuevo saldo
        res.json({ 
            exito: true, 
            mensaje: `El '${nombre}' se aplicará automáticamente en tu próxima carga.`,
            nuevoSaldo: cliente.creditos 
        });

    } catch (error) { 
        console.error("Error al canjear el producto:", error);
        res.status(500).json({ exito: false, mensaje: "Error al canjear el producto" }); 
    }
});

app.post('/api/simular-pago-test', requireLogin, (req, res) => {
    if (sharedState.adminSocketId) {
        io.to(sharedState.adminSocketId).emit('billetera_actualizada_en_vivo', {
            saldoFormateado: "$500,00 ARS (Simulado)", montoTransferido: 500, tipoMovimiento: 'ingreso'
        });
        res.json({ exito: true });
    } else {
        res.status(500).json({ exito: false, mensaje: 'No hay administrador conectado.' });
    }
});

app.post('/api/actualizar-costo-minijuego-nombre', requireLogin, async (req, res) => {
    try {
        const { name, nuevoCosto } = req.body;
        const minijuego = await Minigame.findOneAndUpdate({ name: name }, { creditCost: nuevoCosto }, { new: true });

        if (!minijuego) {
            return res.status(404).json({ success: false, message: `Minijuego '${name}' no encontrado en la base de datos.` });
        }
        res.json({ success: true, message: `El costo de ${name} ha sido actualizado a ${nuevoCosto} Créditos.` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error interno al actualizar el costo.', error: error.message });
    }
});

app.post('/api/sumar-premio-bonus', async (req, res) => {
    try {
        const { usuario, premio } = req.body;
        if (premio <= 0) return res.json({ exito: true });
        const cliente = await Cliente.findOne({ usuarioCasino: usuario });
        if (!cliente) return res.status(404).json({ exito: false, mensaje: "Usuario no encontrado" });
        cliente.creditos += premio;
        await cliente.save();
        res.json({ exito: true, nuevoSaldo: cliente.creditos });
    } catch (error) { res.status(500).json({ exito: false, mensaje: "Error sumando bonus" }); }
});
app.post('/api/solicitar-retiro', async (req, res) => {
    try {
        const { usuario, monto, cbuAlias, titular, plataforma } = req.body;

        const plataformasValidas = ['Oropuro', 'Ganamos', 'Créditos'];
        if (!plataforma || !plataformasValidas.includes(plataforma)) {
            return res.json({
                exito: false,
                mensaje: 'Seleccioná una plataforma válida (Oropuro, Ganamos o Créditos).'
            });
        }

        // 1. BUSCAR EL ÚLTIMO RETIRO APROBADO
        // Ahora filtramos por estado: 'aprobado'
        const ultimoRetiroAprobado = await RetiroSolicitud.findOne({ 
            usuario: usuario, 
            estado: 'aprobado' 
        }).sort({ fechaCreacion: -1 });

        // 2. VALIDACIÓN DE 24 HORAS (Solo si hubo un retiro previo aprobado)
        if (ultimoRetiroAprobado) {
            const ahora = Date.now();
            const fechaUltimoRetiro = new Date(ultimoRetiroAprobado.fechaCreacion).getTime();
            
            const veinticuatroHorasMs = 24 * 60 * 60 * 1000;
            const diferenciaMs = ahora - fechaUltimoRetiro;

            if (diferenciaMs < veinticuatroHorasMs) {
                // Cálculo del tiempo restante
                const tiempoRestanteMs = veinticuatroHorasMs - diferenciaMs;
                const horas = Math.floor(tiempoRestanteMs / (1000 * 60 * 60));
                const minutos = Math.floor((tiempoRestanteMs % (1000 * 60 * 60)) / (1000 * 60));
                
                return res.json({ 
                    exito: false, 
                    mensaje: `⚠️ Ya realizaste un retiro aprobado recientemente. Podrás solicitar otro en ${horas} horas y ${minutos} minutos.` 
                });
            }
        }

        // 3. SI PASÓ LA VALIDACIÓN, CREAMOS EL NUEVO RETIRO
        const nuevaSolicitud = new RetiroSolicitud({
            usuario: usuario,
            monto: monto,
            cbu_alias: cbuAlias,
            titular: titular,
            plataforma: plataforma,
            estado: 'pendiente',
            fechaCreacion: new Date()
        });

        await nuevaSolicitud.save();

        await notificarRetirosPendientesAdmin();
        io.emit('nueva_solicitud_retiro', { mensaje: 'Nueva solicitud de retiro recibida' });

        res.json({ exito: true });

    } catch (error) {
        console.error("Error al procesar retiro:", error);
        res.status(500).json({ exito: false, mensaje: "Error interno del servidor" });
    }
});
// --- NUEVA RUTA: SOLICITAR RETIRO ---
/*app.post('/api/solicitar-retiro', async (req, res) => {
    try {
        const { usuario, monto, cbuAlias, titular } = req.body;
        const cliente = await Cliente.findOne({ usuarioCasino: usuario });

        if (!cliente) return res.status(404).json({ exito: false, mensaje: "Usuario no encontrado" });

        // 1. Lógica de las 24hs
        if (cliente.lastWithdrawal) {
            const hace24Horas = new Date(Date.now() - (24 * 60 * 60 * 1000));
            if (cliente.lastWithdrawal > hace24Horas) {
                // Calculamos cuánto tiempo falta para el próximo retiro
                const tiempoRestante = Math.ceil((cliente.lastWithdrawal.getTime() + (24 * 60 * 60 * 1000) - Date.now()) / (1000 * 60));
                const horas = Math.floor(tiempoRestante / 60);
                const minutos = tiempoRestante % 60;
                
                return res.status(400).json({ 
                    exito: false, 
                    mensaje: `⚠️ Recordá que es un retiro cada 24hs. Podrás retirar en ${horas}h ${minutos}m.` 
                });
            }
        }

        // 2. Si pasa la validación, creamos el retiro
        const nuevoRetiro = new Retiro({
            cliente: usuario,
            monto: monto,
            cbuAlias: cbuAlias,
            titular: titular
        });
        await nuevoRetiro.save();

        // 3. Actualizamos la fecha del último retiro del cliente
        cliente.lastWithdrawal = new Date();
        await cliente.save();

        res.json({ exito: true, mensaje: "Retiro solicitado exitosamente. El cajero lo procesará pronto." });

    } catch (error) {
        console.error("Error al solicitar retiro:", error);
        res.status(500).json({ exito: false, mensaje: "Error interno en el servidor" });
    }
});*/
app.post('/api/retiros/gestion', requireLogin, async (req, res) => {
    try {
        const { id, accion, motivo } = req.body;

        const solicitud = await RetiroSolicitud.findById(id);
        if (!solicitud) {
            return res.status(404).json({ exito: false, mensaje: 'Solicitud no encontrada' });
        }

        let mensajePush = '';
        let tituloPush = '🎰 Casino Fénix - Retiro';

        if (accion === 'aprobar') {
            await RetiroSolicitud.findByIdAndUpdate(id, { estado: 'aprobado' });
            mensajePush = `✅ Tu retiro de $${solicitud.monto} (${solicitud.plataforma || 'Créditos'}) fue APROBADO.`;
            io.to(solicitud.usuario).emit('notificacion', mensajePush);
            io.to(solicitud.usuario).emit('resultado_retiro_cliente', {
                estado: 'aprobado',
                monto: solicitud.monto,
                plataforma: solicitud.plataforma
            });
        } else if (accion === 'rechazar') {
            if (!motivo || !motivo.trim()) {
                return res.status(400).json({ exito: false, mensaje: 'Debe indicar el motivo del rechazo' });
            }
            await RetiroSolicitud.findByIdAndUpdate(id, {
                estado: 'rechazado',
                motivoRechazo: motivo.trim()
            });
            mensajePush = `❌ Tu retiro de $${solicitud.monto} fue RECHAZADO. Motivo: ${motivo.trim()}`;
            io.to(solicitud.usuario).emit('notificacion', mensajePush);
            io.to(solicitud.usuario).emit('resultado_retiro_cliente', {
                estado: 'rechazado',
                monto: solicitud.monto,
                plataforma: solicitud.plataforma,
                motivo: motivo.trim()
            });
        } else {
            return res.status(400).json({ exito: false, mensaje: 'Acción inválida' });
        }

        await enviarPushCliente(solicitud.usuario, tituloPush, mensajePush);

        const listaRetiros = await RetiroSolicitud.find({ estado: 'pendiente' });
        io.to(sharedState.adminSocketId).emit('lista_retiros_actualizada', listaRetiros);
        await notificarRetirosPendientesAdmin();

        res.json({ exito: true });
    } catch (error) {
        console.error('Error en gestión de retiro:', error);
        res.status(500).json({ exito: false, mensaje: 'Error interno del servidor' });
    }
});

// ==============================================================
// 6. IMPORTACIÓN DE RUTAS MODULARES
// ==============================================================
// 1. Primero cargamos todos los modelos
require('./models/User');
require('./models/Transaction');
require('./models/Minigame');
require('./models/Retiro'); // <--- Ponelo acá arriba con los otros
require('./models/ShiftReport');

// 2. Luego cargamos las rutas y les pasamos los parámetros necesarios
require('./routes/estadisticas')(app, requireLogin);
require('./routes/finanzas')(app, requireLogin, io, sharedState);
require('./routes/clientes')(app, requireLogin, io, sharedState);
require('./routes/eventos')(app, requireLogin, io, sharedState);

// ==============================================================
// 7. COMUNICACIÓN EN VIVO (SOCKETS)
// ==============================================================
io.on('connection', (socket) => {
    
    socket.on('identificar_admin', async () => {
        sharedState.adminSocketId = socket.id;
        socket.emit('lista_usuarios_actualizada', sharedState.usuariosConectados);
        try {
            const clientesDB = await Cliente.find().sort({ fechaRegistro: -1 });
            const retirosDB = await Retiro.find();
            const internosDB = await UsuarioInterno.find();
            const panelConfigDB = await PanelConfig.findOne({ identificador: 'global' }); 
            const ruletaDB = await Ruleta.findOne();
            const raspaDB = await Raspa.findOne(); 
            const tragaDB = await Tragamonedas.findOne();
            const cartasDB = await Cartas.findOne();
            const monedaDB = await Moneda.findOne();
            socket.emit('cargar_datos_tablas', {
                clientes: clientesDB, retiros: retirosDB, usuariosInternos: internosDB,
                ruleta: ruletaDB ? ruletaDB.configuracion : [], raspa: raspaDB ? raspaDB.configuracion : [],
                tragamonedas: tragaDB ? tragaDB.configuracion : [], cartas: cartasDB ? cartasDB.configuracion : [],
                moneda: monedaDB ? monedaDB.configuracion : [], panelConfig: panelConfigDB,
                newUserHours: NEW_USER_HOURS
            });
            await notificarRetirosPendientesAdmin();
        } catch (e) { console.log(e); }
    });

    socket.on('admin_cambio_chat_activo', async (datos) => {
        sharedState.usuarioSeleccionadoActivoAdmin = datos.usuario;
        if (sharedState.usuarioSeleccionadoActivoAdmin) {
            let usuario = sharedState.usuariosConectados.find(u => u.nombre === sharedState.usuarioSeleccionadoActivoAdmin);
            if (usuario) {
                usuario.historial.forEach(h => { if (h.emisor === 'cliente') marcarMensajeLeido(h); });
                await Cliente.updateOne({ usuarioCasino: usuario.nombre }, { historialChat: usuario.historial });
                if (usuario.id) io.to(usuario.id).emit('tus_mensajes_fueron_leidos');
            }
        }
        if (sharedState.adminSocketId) io.to(sharedState.adminSocketId).emit('lista_usuarios_actualizada', sharedState.usuariosConectados);
    });

    socket.on('identificar_usuario', async (datos) => {
        socket.username = datos.usuario;
        let clienteDB = await buscarClientePorUsuario(datos.usuario);
        if (!clienteDB) {
            clienteDB = new Cliente({
                usuarioCasino: datos.usuario,
                historialChat: [crearMensajeChat('bot', 'Volviste al menú principal. ¿En qué te podemos ayudar?', { is_read: true, leido: true })]
            });
            await clienteDB.save();
        }
        socket.join(clienteDB.usuarioCasino);

        const tieneMensajesClienteSinLeer = clienteDB.historialChat.some(
            h => h.emisor === 'cliente' && !mensajeEstaLeido(h)
        );
        const soportePendiente = clienteDB.soportePendiente === true || tieneMensajesClienteSinLeer;

        let usuarioExistente = sharedState.usuariosConectados.find(
            u => u.nombre.toLowerCase() === clienteDB.usuarioCasino.toLowerCase()
        );
        if (!usuarioExistente) {
            sharedState.usuariosConectados.push({
                id: socket.id,
                nombre: clienteDB.usuarioCasino,
                estado: clienteDB.estado || 'Menú',
                historial: clienteDB.historialChat,
                soportePendiente
            });
        } else {
            usuarioExistente.id = socket.id;
            usuarioExistente.nombre = clienteDB.usuarioCasino;
            usuarioExistente.historial = clienteDB.historialChat;
            usuarioExistente.soportePendiente = soportePendiente;
        }
        socket.emit('resultado_validacion', {
            exito: true,
            usuario: clienteDB.usuarioCasino,
            historial: clienteDB.historialChat,
            creditos: clienteDB.creditos || 0
        });
        if (sharedState.adminSocketId) {
            io.to(sharedState.adminSocketId).emit('lista_usuarios_actualizada', sharedState.usuariosConectados);
            const clientesDB = await Cliente.find().sort({ fechaRegistro: -1 });
            io.to(sharedState.adminSocketId).emit('cargar_datos_tablas', { clientes: clientesDB, newUserHours: NEW_USER_HOURS });
        }
    });

    // ==========================================
    // 🔥 NUEVOS EVENTOS PUSH INTEGRADOS SIN ERRORES
    // ==========================================
    socket.on('solicitar_clave_vapid', () => {
        if (process.env.VAPID_PUBLIC_KEY) {
            socket.emit('respuesta_clave_vapid', { publicKey: process.env.VAPID_PUBLIC_KEY });
        } else {
            console.log("❌ Error: VAPID_PUBLIC_KEY no está definida en las variables de entorno de Render.");
        }
    });

    socket.on('guardar_suscripcion_push', async (datos) => {
        try {
            if (!socket.username) {
                console.log("❌ Intento de guardar push sin usuario identificado en el socket.");
                return;
            }
            await Cliente.findOneAndUpdate(
                { usuarioCasino: socket.username },
                { pushSubscription: datos.subscription }
            );
            console.log(`✅ Suscripción push guardada con éxito vía Socket para: ${socket.username}`);
            socket.emit('suscripcion_guardada_exito');
        } catch (error) {
            console.error('❌ Error al guardar suscripción por Socket:', error);
        }
    });
    // ==========================================
    // CHAT & SOPORTE EN TIEMPO REAL
    // ==========================================

    socket.on('cliente_accion', async (datos) => {
        let usuario = sharedState.usuariosConectados.find(u => u.nombre === socket.username);
        if (usuario) {
            usuario.estado = datos.estado;
            let estaMirandome = (sharedState.usuarioSeleccionadoActivoAdmin === usuario.nombre);
            
            if (datos.mensajeCliente) { 
                usuario.historial.push(crearMensajeChat('cliente', datos.mensajeCliente, { is_read: estaMirandome, leido: estaMirandome }));
                if (!estaMirandome) usuario.soportePendiente = true; 
            }
            if (datos.mensajeBot) { 
                usuario.historial.push(crearMensajeChat('bot', datos.mensajeBot, { is_read: true, leido: true })); 
            }

            if (datos.estado === 'soporte' || datos.estado === 'Soporte') {
                usuario.historial.forEach(m => { if (m.emisor === 'admin') marcarMensajeLeido(m); });
                if (sharedState.adminSocketId) {
                    io.to(sharedState.adminSocketId).emit('actualizar_chat_activo', { nombre: usuario.nombre, historial: usuario.historial });
                }
            }
            
            await Cliente.updateOne(
                { usuarioCasino: usuario.nombre }, 
                { historialChat: usuario.historial, estado: datos.estado, soportePendiente: usuario.soportePendiente }
            );
            
            if (sharedState.adminSocketId) {
                io.to(sharedState.adminSocketId).emit('lista_usuarios_actualizada', sharedState.usuariosConectados);
                io.to(sharedState.adminSocketId).emit('actualizar_chat_activo', { nombre: usuario.nombre, historial: usuario.historial });
                io.to(sharedState.adminSocketId).emit('cliente_accion', datos); 
            }
            
            if (estaMirandome) socket.emit('tus_mensajes_fueron_leidos');
        }
    });

    socket.on('cliente_envia_mensaje_libre', async (datos) => {
        let usuario = sharedState.usuariosConectados.find(u => u.nombre === socket.username);
        if (usuario) {
            let estaMirandome = (sharedState.usuarioSeleccionadoActivoAdmin === usuario.nombre);
            
            if (!estaMirandome) usuario.soportePendiente = true; 

            usuario.historial.push(crearMensajeChat('cliente', datos.mensaje, { is_read: estaMirandome, leido: estaMirandome }));

            await Cliente.updateOne(
                { usuarioCasino: usuario.nombre }, 
                { historialChat: usuario.historial, soportePendiente: usuario.soportePendiente }
            );

            if (sharedState.adminSocketId) {
                io.to(sharedState.adminSocketId).emit('lista_usuarios_actualizada', sharedState.usuariosConectados);
                io.to(sharedState.adminSocketId).emit('actualizar_chat_activo', { nombre: usuario.nombre, historial: usuario.historial });
            }
            if (estaMirandome) socket.emit('tus_mensajes_fueron_leidos');
        }
    });

    socket.on('cliente_cambia_pestaña', async (datos) => {
        let usuario = sharedState.usuariosConectados.find(u => u.nombre === socket.username);
        if (usuario) {
            usuario.estado = datos.pestaña; 
            let adminLeidos = false;

            if (datos.pestaña === 'soporte' || datos.pestaña === 'Soporte') {
                usuario.historial.forEach(m => {
                    if (m.emisor === 'admin' && !mensajeEstaLeido(m)) {
                        marcarMensajeLeido(m);
                        adminLeidos = true;
                    }
                });
            }

            await Cliente.updateOne(
                { usuarioCasino: usuario.nombre }, 
                { estado: datos.pestaña, historialChat: usuario.historial }
            );

            if (sharedState.adminSocketId) {
                io.to(sharedState.adminSocketId).emit('lista_usuarios_actualizada', sharedState.usuariosConectados);
                if (adminLeidos) {
                    io.to(sharedState.adminSocketId).emit('actualizar_chat_activo', { nombre: usuario.nombre, historial: usuario.historial });
                }
            }
        }
    });

    socket.on('cliente_marca_leidos', async () => {
        let usuario = sharedState.usuariosConectados.find(u => u.nombre === socket.username);
        if (!usuario) return;

        let adminLeidos = false;
        usuario.historial.forEach(m => {
            if (m.emisor === 'admin' && !mensajeEstaLeido(m)) {
                marcarMensajeLeido(m);
                adminLeidos = true;
            }
        });

        if (adminLeidos) {
            await Cliente.updateOne({ usuarioCasino: usuario.nombre }, { historialChat: usuario.historial });
            if (sharedState.adminSocketId) {
                io.to(sharedState.adminSocketId).emit('actualizar_chat_activo', { nombre: usuario.nombre, historial: usuario.historial });
            }
        }
    });

    socket.on('admin_selecciona_usuario', async (datos) => {
        sharedState.usuarioSeleccionadoActivoAdmin = datos.nombre;
        let usuario = sharedState.usuariosConectados.find(u => u.nombre === datos.nombre);
        
        if (usuario) {
            usuario.soportePendiente = false;
            usuario.historial.forEach(m => { if (m.emisor === 'cliente') marcarMensajeLeido(m); });

            await Cliente.updateOne(
                { usuarioCasino: usuario.nombre }, 
                { soportePendiente: false, historialChat: usuario.historial }
            );

            if (usuario.id) io.to(usuario.id).emit('tus_mensajes_fueron_leidos');

            if (sharedState.adminSocketId) {
                io.to(sharedState.adminSocketId).emit('lista_usuarios_actualizada', sharedState.usuariosConectados);
                io.to(sharedState.adminSocketId).emit('actualizar_chat_activo', { nombre: usuario.nombre, historial: usuario.historial });
            }
        }
    });

    socket.on('admin_envia_mensaje', async (datos) => {
        let usuario = sharedState.usuariosConectados.find(u => u.nombre === datos.paraUsuario);
        if (usuario) {
            const clienteEnSoporte = (usuario.estado === 'soporte' || usuario.estado === 'Soporte');
            const msg = crearMensajeChat('admin', datos.mensaje, {
                is_read: clienteEnSoporte,
                leido: clienteEnSoporte
            });
            usuario.historial.push(msg);

            await Cliente.updateOne({ usuarioCasino: usuario.nombre }, { historialChat: usuario.historial });
            
            if (usuario.id) {
                io.to(usuario.id).emit('recibir_mensaje_admin', {
                    mensaje: datos.mensaje,
                    hora: msg.hora,
                    is_read: clienteEnSoporte
                });
            }
            socket.emit('actualizar_chat_activo', { nombre: usuario.nombre, historial: usuario.historial });
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            // Nota: Al desconectarse, el estado 'soportePendiente' queda guardado intacto en MongoDB
            sharedState.usuariosConectados = sharedState.usuariosConectados.filter(u => u.nombre !== socket.username);
            if (sharedState.usuarioSeleccionadoActivoAdmin === socket.username) sharedState.usuarioSeleccionadoActivoAdmin = null;
            
            if (sharedState.adminSocketId) {
                io.to(sharedState.adminSocketId).emit('lista_usuarios_actualizada', sharedState.usuariosConectados);
            }
        }
    });
    // ==========================================================================
// 🛑 EVENTO: FINALIZAR SOPORTE DESDE EL PANEL DE ADMINISTRACIÓN
// ==========================================================================
socket.on('admin_finaliza_soporte', async (datos) => {
    try {
        const { nombre } = datos;
        if (!nombre) return;

        console.log(`[SOPORTE] Finalizando soporte para: ${nombre}`);

        // 1. Ahora usamos 'User' (tu modelo correcto)
        await User.updateOne(
            { nombre: nombre }, 
            { $set: { estado: 'Menú', soportePendiente: false } }
        );

        // 2. Envío a la sala (usando el 'join' que configuramos antes)
        io.to(nombre).emit('servidor_limpia_pantalla_soporte');
        
        // 3. Avisamos a los admins usando 'User' también
        const listaActualizada = await User.find({}); 
        io.emit('lista_usuarios_actualizada', listaActualizada); 

    } catch (error) {
        console.error("❌ Error en servidor al finalizar soporte:", error);
    }
});
    socket.on('solicitar_retiro', async (datos) => {
    try {
        const plataformasValidas = ['Oropuro', 'Ganamos', 'Créditos'];
        if (!datos.plataforma || !plataformasValidas.includes(datos.plataforma)) {
            return socket.emit('error_retiro', 'Seleccioná una plataforma válida.');
        }

        const usuarioDB = await User.findOne({ nombre: socket.username });
        
        // Verificación de 24hs (si el campo ultimoRetiro existe y es menor a 24hs)
        const hace24hs = new Date(Date.now() - 24 * 60 * 60 * 1000);
        if (usuarioDB.ultimoRetiro && usuarioDB.ultimoRetiro > hace24hs) {
            return socket.emit('error_retiro', "Debes esperar 24hs para solicitar otro retiro.");
        }

        const nuevaSolicitud = new RetiroSolicitud({
            usuario: socket.username,
            monto: datos.monto,
            cbu_alias: datos.cbu_alias,
            titular: datos.titular,
            plataforma: datos.plataforma
        });
        await nuevaSolicitud.save();

        // Avisamos al Admin
        if (sharedState.adminSocketId) {
            io.to(sharedState.adminSocketId).emit('nuevo_retiro_pendiente', nuevaSolicitud);
        }
        
        socket.emit('retiro_enviado_exito', "Solicitud enviada correctamente.");
    } catch (error) {
        console.error("Error al solicitar retiro:", error);
    }
});
    socket.on('admin_decide_retiro', async (datos) => {
    // 🔥 BLOQUE DE SEGURIDAD (Gatekeeper)
    if (socket.id !== sharedState.adminSocketId) {
        console.warn(`❌ Intento de acceso no autorizado detectado desde socket: ${socket.id}`);
        return; // Cortamos la ejecución aquí si no es el admin
    }

    // --- A partir de aquí, solo entra si es el admin ---
    const { retiroId, accion, motivo } = datos; 
    const solicitud = await RetiroSolicitud.findById(retiroId);
    
    if (!solicitud) return;

    if (accion === 'aprobado') {
        solicitud.estado = 'aprobado';
        // Marcamos la fecha de retiro en el usuario para el bloqueo de 24hs
        await User.updateOne({ nombre: solicitud.usuario }, { ultimoRetiro: new Date() });
        
        io.to(solicitud.usuario).emit('notificacion', "✅ Tu retiro ha sido aprobado.");
    } else {
        solicitud.estado = 'rechazado';
        io.to(solicitud.usuario).emit('notificacion', `❌ Tu retiro fue rechazado. Motivo: ${motivo}`);
    }
    
    await solicitud.save();
    
    // Actualizamos la lista del admin
    const listaRetiros = await RetiroSolicitud.find({ estado: 'pendiente' });
    io.emit('lista_retiros_actualizada', listaRetiros);
});
   

    socket.on('pedir_lista_retiros', async () => {
    if (socket.id !== sharedState.adminSocketId) return; // Seguridad
    const lista = await RetiroSolicitud.find({ estado: 'pendiente' });
    socket.emit('lista_retiros_actualizada', lista);
});
    });
// ==============================================================
// 8. INICIALIZADOR DE DATOS
// ==============================================================
async function inicializarDatosDePrueba() {
    const juegos = ['Ruleta', 'Raspa', 'Tragamonedas', 'Cartas', 'Moneda'];
    for (let nombre of juegos) {
        const existe = await Minigame.findOne({ name: nombre });
        if (!existe) await new Minigame({ name: nombre, creditCost: 10 }).save();
    }
    const countCl = await Cliente.countDocuments();
    if(countCl === 0) { await new Cliente({ usuarioCasino: 'joniz115', saldo: 60000, creditos: 5000, wager: 10000, estado: 'Activo' }).save(); }

    if (await Ruleta.countDocuments() === 0) {
        await new Ruleta({ configuracion: [
            { id: 0, premio: '🏆 JACKPOT', valor: 50000, probabilidad: 2 }, { id: 1, premio: '🔥 Premio Mayor', valor: 10000, probabilidad: 8 },
            { id: 2, premio: '⭐ Premio Medio', valor: 5000, probabilidad: 12 }, { id: 3, premio: '🍀 Premio Chico', valor: 2000, probabilidad: 18 },
            { id: 4, premio: '✨ Consolación', valor: 500, probabilidad: 20 }, { id: 5, premio: '🎁 Sorpresa', valor: 100, probabilidad: 40 }
        ]}).save();
    }
    if (await Raspa.countDocuments() === 0) {
        await new Raspa({ configuracion: [
            { id: 0, premio: '💎 MEGA BONO', valor: 30000, probabilidad: 3 }, { id: 1, premio: '👑 Premio Alto', valor: 15000, probabilidad: 7 },
            { id: 2, premio: '💵 Premio Intermedio', valor: 4000, probabilidad: 15 }, { id: 3, premio: '📦 Premio Base', valor: 1500, probabilidad: 25 },
            { id: 4, premio: '🪙 Recompensa Menor', valor: 600, probabilidad: 20 }, { id: 5, premio: '🎈 Suerte Loca', valor: 200, probabilidad: 30 }
        ]}).save();
    }
    if (await Tragamonedas.countDocuments() === 0) {
        await new Tragamonedas({ configuracion: [
            { id: 0, premio: '🎰 PLENO 777', valor: 50000, probabilidad: 2 }, { id: 1, premio: '💎 Diamantes', valor: 15000, probabilidad: 8 },
            { id: 2, premio: '🔔 Campanas', valor: 5000, probabilidad: 15 }, { id: 3, premio: '🍋 Limones', valor: 1500, probabilidad: 25 },
            { id: 4, premio: '🍒 Cerezas', valor: 500, probabilidad: 30 }, { id: 5, premio: '❌ Sin Suerte', valor: 0, probabilidad: 20 }
        ]}).save();
    }
    if (await Cartas.countDocuments() === 0) {
        await new Cartas({ configuracion: [
            { id: 0, premio: '🃏 AS (Jackpot)', valor: 25000, probabilidad: 5 }, { id: 1, premio: '🤴 Rey (Alto)', valor: 10000, probabilidad: 10 },
            { id: 2, premio: '👸 Reina (Medio)', valor: 5000, probabilidad: 20 }, { id: 3, premio: '🃋 10 de Trébol', valor: 2000, probabilidad: 25 },
            { id: 4, premio: '🃈 7 Diamantes', valor: 500, probabilidad: 30 }, { id: 5, premio: '🃂 2 Corazones', valor: 100, probabilidad: 10 }
        ]}).save();
    }
    if (await Moneda.countDocuments() === 0) {
        await new Moneda({ configuracion: [
            { id: 0, premio: '🟡 Cara Dorada', valor: 10000, probabilidad: 5 }, { id: 1, premio: '⚪ Cruz Plata', valor: 5000, probabilidad: 15 },
            { id: 2, premio: '🪙 Cara Normal', valor: 2000, probabilidad: 30 }, { id: 3, premio: '🪙 Cruz Normal', valor: 1000, probabilidad: 30 },
            { id: 4, premio: '💥 Moneda Caída', valor: 200, probabilidad: 20 }
        ]}).save();
    }

    if (await PanelConfig.countDocuments() === 0) { await new PanelConfig({ identificador: 'global' }).save(); }
}

const PUERTO = process.env.PORT || 3000;
// FUNCTION AUTOMÁTICA: REVISAR INACTIVOS Y ENVIAR NOTIFICACIONES
async function ejecutarVerificacionRetencion() {
    console.log('🔄 Ejecutando control diario de retención de usuarios...');
    try {
        // 1. Traemos las reglas del admin
        const config = await ConfigRetencion.findOne({ id: 'config_global' });
        if (!config) return console.log('⚠️ No hay reglas de retención configuradas aún.');

        const ahora = new Date();

        // 2. Traemos todos los clientes que tengan una suscripción push activa registrada
        const clientes = await Cliente.find({ pushSubscription: { $ne: null } });

        for (let cliente of clientes) {
            if (!cliente.ultimaConexion) continue;

            // Calcular cuántos días pasaron desde su última conexión
            const diferenciaTiempo = ahora.getTime() - new Date(cliente.ultimaConexion).getTime();
            const diasInactivo = Math.floor(diferenciaTiempo / (1000 * 60 * 60 * 24));

            let reglaAplicable = null;

            // Mapeamos los días de inactividad con las reglas del panel
            if (diasInactivo === 1 && config.reglas.h24.activo) reglaAplicable = config.reglas.h24;
            else if (diasInactivo === 3 && config.reglas.d3.activo) reglaAplicable = config.reglas.d3;
            else if (diasInactivo === 7 && config.reglas.d7.activo) reglaAplicable = config.reglas.d7;
            else if (diasInactivo === 15 && config.reglas.d15.activo) reglaAplicable = config.reglas.d15;
            else if (diasInactivo === 30 && config.reglas.d30.activo) reglaAplicable = config.reglas.d30;

            // 3. Si cumple la condición, ¡Le disparamos la notificación push!
            if (reglaAplicable && reglaAplicable.mensaje) {
                const payload = JSON.stringify({
                    title: '🎰 Casino Fénix',
                    body: reglaAplicable.mensaje
                });

                webpush.sendNotification(cliente.pushSubscription, payload)
                    .then(() => console.log(`✅ Push de retención enviado con éxito a: ${cliente.usuarioCasino}`))
                    .catch(async (err) => {
                        console.error(`❌ Error al enviar push a ${cliente.usuarioCasino}. Posiblemente desinstaló la PWA.`);
                        // Si el token expiró o la app se borró, limpiamos la base de datos para no gastar recursos
                        if (err.statusCode === 410 || err.statusCode === 404) {
                            cliente.pushSubscription = null;
                            await cliente.save();
                        }
                    });
            }
        }
    } catch (error) {
        console.error('Error en el motor de retención automatizado:', error);
    }
}

// Configurar para que corra AUTOMÁTICAMENTE cada 24 horas
// (1000ms * 60s * 60m * 24h)
setInterval(ejecutarVerificacionRetencion, 1000 * 60 * 60 * 24);

// 🛠️ TRUCO DE PRUEBA: Correr la función 10 segundos después de que el servidor se encienda
// Esto te sirve para probar si funciona al toque sin esperar 24 horas reales.
setTimeout(ejecutarVerificacionRetencion, 10000);
server.listen(PUERTO, () => { console.log(`🚀 Servidor en puerto ${PUERTO}`); });
module.exports = { app, server };
