// Firma dibujada a mano sobre un <canvas> — reutilizable donde se necesite capturar una firma
// real (recepción del instalador en chofer.html, aprobación del cliente en instalador.html).
// Usa Pointer Events (funciona igual con mouse, dedo o lápiz, sin manejar mouse/touch aparte).
export function setupSignaturePad(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#0A3D62';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let drawing = false;
    let hasSignature = false;

    function pos(e) {
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    function start(e) {
        drawing = true;
        hasSignature = true;
        const p = pos(e);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        e.preventDefault();
    }
    function move(e) {
        if (!drawing) return;
        const p = pos(e);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        e.preventDefault();
    }
    function end() { drawing = false; }

    canvas.addEventListener('pointerdown', start);
    canvas.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    return {
        clear() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            hasSignature = false;
        },
        isEmpty() { return !hasSignature; },
        toDataUrl() { return canvas.toDataURL('image/png'); }
    };
}
