'use strict';

// --- CONFIGURACIÓN DE PREMIOS ---
const premiosConfig = [
    { id: 'bufon', nombre: 'Bufón', tipo: 'multiplicador', valor: 10 },
    { id: 'laud', nombre: 'Laúd', tipo: 'multiplicador', valor: 8 },
    { id: 'clavas', nombre: 'Clavas', tipo: 'multiplicador', valor: 6 },
    { id: 'zapatos', nombre: 'Zapatos', tipo: 'multiplicador', valor: 3 },
    { id: 'esfera', nombre: 'Esfera', tipo: 'multiplicador', valor: 1 },
    { id: 'bonus', nombre: 'Bonus', tipo: 'fijo', valor: '10 Tiradas Gratis' }
];

function actualizarTablaPremios() {
    // IMPORTANTE: Asegúrate de que este ID coincida con tu HTML
    const input = document.getElementById('input-apuesta');
    if (!input) return; // Si no existe, salimos para evitar errores

    const apuesta = parseInt(input.value) || 0;
    const contenedorTabla = document.getElementById('contenedor-premios');
    
    if (!contenedorTabla) return;

    contenedorTabla.innerHTML = '';

    premiosConfig.forEach(premio => {
        let textoPremio = '';

        if (premio.tipo === 'multiplicador') {
            const calculo = apuesta * premio.valor;
            textoPremio = `${calculo} CR`;
        } else {
            textoPremio = premio.valor;
        }

        contenedorTabla.innerHTML += `
            <div class="prize-row">
                <span>3x ${premio.nombre}:</span> 
                <span class="highlight">${textoPremio}</span>
            </div>
        `;
    });
} // <--- ¡ESTA LLAVE FALTABA! Cierra la función de la tabla

// --- LÓGICA DE LA MÁQUINA ---
function SlotMachine(container, reels, callback, options) {
    const self = this;
    
    function createReelElm(config) {
        const div = document.createElement('div');
        div.classList.add('reel');
        const ul = document.createElement('ul');
        ul.classList.add('strip');
        
        for (let i = 0; i < 12; i++) {
            const indexSimbolo = i % 6; 
            const li = document.createElement('li');
            li.style.backgroundImage = `url("${config.imageSrc}")`;
            li.style.backgroundPosition = `0px -${indexSimbolo * 150}px`;
            ul.appendChild(li);
        }
        config['element'] = ul;
        div.appendChild(ul);
        return div;
    }

    const divSlots = document.createElement('div');
    divSlots.classList.add('slots');
    divSlots.style.display = "flex";
    reels.forEach(reel => divSlots.appendChild(createReelElm(reel)));
    container.appendChild(divSlots);

    self.startSpinAnimation = function() {
        reels.forEach(r => {
            let pos = -900; 
            const speed = 12; 
            
            function animate() {
                pos += speed; 
                if (pos >= 0) pos = -900 + pos; 
                
                r.element.style.marginTop = pos + "px";
                r.animationId = requestAnimationFrame(animate); 
            }
            
            r.animationId = requestAnimationFrame(animate);
        });
    };

    self.stopSpinAndShowResult = function(resultadoArray) {
        reels.forEach((reel, index) => {
            const ul = reel.element;
            const simbolo = reel.symbols.find(s => s.name === resultadoArray[index]);
            const finalPos = simbolo ? simbolo.position : 0;

            setTimeout(() => {
                cancelAnimationFrame(reel.animationId); 
                
                ul.style.transition = "margin-top 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)"; 
                ul.style.marginTop = `-${finalPos}px`; 
                
                setTimeout(() => {
                    ul.style.transition = "none"; 
                    if (index === reels.length - 1 && callback) callback(resultadoArray);
                }, 400); 

            }, 1000 + (index * 400)); 
        });
    };
    return self;
}

// Exportamos para usarlo en otros archivos
window.slotMachine = (c, r, cb, o) => new SlotMachine(c, r, cb, o);

// Inicializar tabla apenas cargue el archivo
window.addEventListener('DOMContentLoaded', actualizarTablaPremios);
