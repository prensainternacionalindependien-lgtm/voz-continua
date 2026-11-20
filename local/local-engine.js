// Each instance uses a separate iframe so closing it can release the WASM heap.
export async function openLocal(onStatus = () => {}, signal) {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    frame.title = "Motor local de voz";
    let closed = false;
    let busy = false;
    let processor;
    const stop = new AbortController();
    function close() {
        if (closed) return;
        closed = true;
        processor?.cancel();
        stop.abort();
        frame.remove();
        signal?.removeEventListener("abort", close);
    }

    // Removing the frame also cancels downloads that belong to its document.
    function untilClosed(task) {
        return new Promise((resolve, reject) => {
            const cancelled = () => reject(new DOMException("Se cerró el motor de voz.", "AbortError"));
            if (closed) { cancelled(); return; }
            stop.signal.addEventListener("abort", cancelled, {once: true});
            Promise.resolve(task).then(resolve, reject).finally(() => {
                stop.signal.removeEventListener("abort", cancelled);
            });
        });
    }

    async function run(task) {
        if (closed) throw new Error("El motor de voz está cerrado.");
        if (busy) throw new Error("Espera a que termine el fragmento actual.");
        busy = true;
        try { return await untilClosed(task()); }
        finally { busy = false; }
    }

    if (signal?.aborted) throw new DOMException("Se canceló la carga.", "AbortError");
    signal?.addEventListener("abort", close, {once: true});
    try {
        onStatus("Cargando el motor de voz en el dispositivo…");
        const loaded = new Promise((resolve, reject) => {
            frame.onload = resolve;
            frame.onerror = () => reject(new Error("No se pudo abrir el motor de voz."));
        });
        frame.src = new URL("./engine-frame.html", import.meta.url).href;
        document.body.append(frame);
        await untilClosed(loaded);
        processor = frame.contentWindow.VozMotor;
        if (!processor) throw new Error("No se pudo cargar el motor de voz.");
        await untilClosed(processor.load(onStatus));
        return {
            sampleRate: 24000,
            setVoice(samples) {
                if (!(samples instanceof Float32Array) || !samples.length) {
                    return Promise.reject(new Error("Selecciona una grabación de tu propia voz."));
                }
                return run(() => processor.setVoice(samples));
            },
            async generate(text) {
                const pcm = await run(() => processor.generate(text));
                return new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length);
            },
            close
        };
    } catch (error) {
        close();
        throw error;
    }
}
