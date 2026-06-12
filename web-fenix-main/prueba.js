const mongoose = require('mongoose');

// IP directa del nodo principal (evita el bloqueo de nombres de tu red)
const uri = "mongodb://pepitogrillo011023_db_user:Xk3hYyFHeTn02enV@35.198.59.186:27017,35.198.56.208:27017,35.198.63.149:27017/clubzeus?replicaSet=atlas-enwnzwj-shard-0&authSource=admin&ssl=true";

console.log("⏳ Conectando vía IPs físicas directas...");

mongoose.connect(uri, { family: 4 })
    .then(() => {
        console.log("🟢 ¡ÉXITO TOTAL! CONEXIÓN ESTABLECIDA.");
        process.exit(0);
    })
    .catch(err => {
        console.log("🔴 ERROR:", err.message);
        process.exit(1);
    });