// Chatterbox recorta a 300 caracteres. Dejamos margen y respetamos frases y palabras.
export function splitText(value, size = 260) {
  const text = value.trim();
  const parts = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const block = text.slice(start, end);
      const minimum = Math.floor(size * .4);
      const breaks = [/(?:[.!?…](?:[»”"')\]]*)\s+|\n+)/gu, /[,;:]\s+/gu, /\s+/gu];
      for (const pattern of breaks) {
        let best = 0;
        for (const m of block.matchAll(pattern)) best = m.index + m[0].length;
        if (best >= minimum) { end = start + best; break; }
      }
      if (/[\uD800-\uDBFF]/.test(text.charAt(end-1)) && /[\uDC00-\uDFFF]/.test(text.charAt(end))) end--;
    }
    const part = text.slice(start, end).trim();
    if (part) parts.push(part);
    start = end;
  }
  return parts;
}

export const RATE = 24000;
export function waveHeader(bytes, rate = RATE) {
  if (bytes > 0xffffffff - 36) throw Error('Este archivo supera el tamaño máximo del formato WAV.');
  const a = new ArrayBuffer(44), v = new DataView(a);
  const label = (offset,s) => [...s].forEach((c,i) => v.setUint8(offset+i,c.charCodeAt(0)));
  label(0,'RIFF'); v.setUint32(4,36+bytes,true); label(8,'WAVE'); label(12,'fmt ');
  v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
  v.setUint32(24,rate,true); v.setUint32(28,rate*2,true); v.setUint16(32,2,true);
  v.setUint16(34,16,true); label(36,'data'); v.setUint32(40,bytes,true);
  return a;
}
export function encodeWave(samples) {
  const a = new ArrayBuffer(samples.length*2), view = new DataView(a);
  for (let i=0;i<samples.length;i++) {
    const v=Math.max(-1,Math.min(1,samples[i])); view.setInt16(i*2,Math.round(v*(v<0?32768:32767)),true);
  }
  return new Blob([waveHeader(a.byteLength),a],{type:'audio/wav'});
}
export function waveFloats(buffer) {
  // Solo para WAV PCM canónico creado por encodeWave.
  const data = new DataView(buffer); const a = new Float32Array((buffer.byteLength-44)/2);
  for(let i=0;i<a.length;i++) a[i]=data.getInt16(44+2*i,true)/32768;
  return a;
}
export async function decodeMono(blob, maxSeconds = Infinity) {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const reader = new Offline(1,1,RATE);
  const buf = await reader.decodeAudioData(await blob.arrayBuffer());
  const length = Math.min(buf.length,Math.floor(maxSeconds * buf.sampleRate));
  const target = Math.ceil(length * RATE / buf.sampleRate);
  if (!target) throw Error('El archivo de audio está vacío.');
  const mix = new Offline(1,target,RATE);
  const source = mix.createBufferSource(); source.buffer = buf; source.connect(mix.destination); source.start();
  return (await mix.startRendering()).getChannelData(0);
}
