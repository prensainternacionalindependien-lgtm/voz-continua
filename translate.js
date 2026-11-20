import {splitText} from './audio.js';

// Keep neighboring sentences together when the service allows it (500 UTF-8 bytes per request).
function segments(text) {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= 480) return [text];
  return splitText(text, 450).flatMap(s =>
    encoder.encode(s).length <= 480 ? [s] : splitText(s, 115));
}
export async function translateToSpanish(text, language, signal, progress) {
  const blocks = text.trim().split(/(\n\s*\n)/);
  const result = [];
  let count = 0;
  for (const block of blocks) {
    if (!block.trim()) { result.push(block); continue; }
    const translated = [];
    for (const part of segments(block)) {
      progress('Traduciendo la parte '+(++count)+'…');
      const url = new URL('https://api.mymemory.translated.net/get');
      url.search = new URLSearchParams({q: part, langpair:language+'|es'});
      const response = await fetch(url, {signal,credentials:'omit',referrerPolicy:'no-referrer'});
      if (!response.ok) throw Error('El servicio de traducción respondió con el error '+response.status+'.');
      const data = await response.json();
      if (data.quotaFinished || Number(data.responseStatus) === 429)
        throw Error('Se alcanzó la cuota gratuita de traducción. Tu texto original sigue aquí.');
      if (Number(data.responseStatus)!==200 || !data.responseData?.translatedText?.trim())
        throw Error('El servicio no pudo traducir esta parte. Tu texto original sigue aquí.');
      translated.push(data.responseData.translatedText.trim());
    }
    result.push(translated.join(' '));
  }
  return result.join('');
}
