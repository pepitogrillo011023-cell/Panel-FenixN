// Emojis que usará la máquina (luego podrás cambiarlos por tus imágenes)
const items = ['🍒', '🍋', '🍊', '🔔', '💎', '🎰'];

// Variables de estado del juego (simuladas por ahora)
let creditosActuales = 100;
let estaGirando = false;

// Elementos del HTML que vamos a controlar
const reel1 = document.getElementById('reel-1');
const reel2 = document.getElementById('reel-2');
const reel3 = document.getElementById('reel-3');
const btnSpin = document.getElementById('btn-spin');
const creditosDisplay = document.getElementById('creditos-display');
const mensajePremio = document.getElementById('mensaje-premio');

// Inicializamos la pantalla con emojis fijos
reel1.innerText = '🎰';
reel2.innerText = '🎰';
reel3.innerText = '🎰';
creditosDisplay.innerText = creditosActuales;

// Escuchamos el clic en el botón de GIRAR
btnSpin.addEventListener('click', () => {
    // Si ya está girando o no tiene créditos, no hace nada
    if (estaGirando || creditosActuales < 10) return;

    // Descontamos el costo del tiro localmente
    creditosActuales -= 10;
    creditosDisplay.innerText = creditosActuales;
    
    // Bloqueamos el botón y ocultamos mensajes viejos
    estaGirando = true;
    btnSpin.disabled = true;
    mensajePremio.classList.remove('mensaje-visible');

    // Iniciamos el efecto visual del giro
    iniciarEfectoGiro();
});

function iniciarEfectoGiro() {
    let giros = 0;
    // Creamos un intervalo que cambia los emojis súper rápido (cada 100ms)
    const intervaloGiro = setInterval(() => {
        reel1.innerText = items[Math.floor(Math.random() * items.length)];
        reel2.innerText = items[Math.floor(Math.random() * items.length)];
        reel3.innerText = items[Math.floor(Math.random() * items.length)];
        giros++;

        // Cuando pasa el tiempo de giro (2 segundos / 20 ciclos), frenamos
        if (giros >= 20) {
            clearInterval(intervaloGiro);
            finalizarTiroSimulado();
        }
    }, 100);
}

function finalizarTiroSimulado() {
    // Elegimos el resultado final al azar (SOLO PARA ESTA PRUEBA)
    const res1 = items[Math.floor(Math.random() * items.length)];
    const res2 = items[Math.floor(Math.random() * items.length)];
    const res3 = items[Math.floor(Math.random() * items.length)];

    // Mostramos el resultado definitivo en los rodillos
    reel1.innerText = res1;
    reel2.innerText = res2;
    reel3.innerText = res3;

    // Lógica de premio simulada: si los 3 son iguales
    if (res1 === res2 && res2 === res3) {
        let premio = 100; // Premio fijo simulado
        creditosActuales += premio;
        creditosDisplay.innerText = creditosActuales;
        
        mensajePremio.innerText = `¡GANASTE $${premio}! 🎉`;
        mensajePremio.classList.add('mensaje-visible');
    }

    // Liberamos la máquina para el próximo tiro
    estaGirando = false;
    if (creditosActuales >= 10) {
        btnSpin.disabled = false;
    } else {
        btnSpin.innerText = "SIN CRÉDITOS";
    }
}