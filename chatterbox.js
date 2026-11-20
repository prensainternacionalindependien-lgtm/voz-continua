import {decodeMono} from './audio.js';
const SPACE='https://resembleai-chatterbox-multilingual-tts-es-mx-latam.hf.space';
const API=SPACE+'/gradio_api';
async function checked(url,options={}) {
  const response=await fetch(url,{...options,credentials:'omit',referrerPolicy:'no-referrer'});
  if(!response.ok) {
    if(response.status===429) throw Error('Chatterbox alcanzó su cuota gratuita. Puedes continuar más tarde.');
    throw Error('Chatterbox respondió con el error '+response.status+'. Puedes reintentar más tarde.');
  }
  return response;
}
async function* events(stream) {
  const reader=stream.getReader(), decoder=new TextDecoder();let buffer='';
  try {
    while(true) {
      const {done,value}=await reader.read();
      buffer+=decoder.decode(value,{stream:!done});
      const lines=buffer.split('\n'); buffer=lines.pop() || '';
      if(done && buffer){lines.push(buffer);buffer='';}
      for(const line of lines) if(line.startsWith('data:')) yield JSON.parse(line.slice(5).trim());
      if(done) break;
    }
  } finally {await reader.cancel().catch(()=>{});}
}
export async function openCloud(voice,onStatus) {
  const timeout=(ms)=>AbortSignal.timeout(ms);
  onStatus('Enviando tu muestra a Chatterbox…');
  const form=new FormData();form.append('files',voice,'mi-voz.wav');
  const [path]=await (await checked(API+'/upload',{method:'POST',body:form,signal:timeout(90000)})).json();
  if(typeof path!=='string' || !path) throw Error('Chatterbox no recibió la muestra de voz.');
  const config=await (await checked(SPACE+'/config',{signal:timeout(30000)})).json();
  const fn=config.dependencies.find(x=>x.api_name==='generate_tts_audio');
  if(!fn) throw Error('La versión actual de Chatterbox ya no ofrece esta función.');
  const file={path,orig_name:'mi-voz.wav',mime_type:'audio/wav',meta:{_type:'gradio.FileData'}};
  const session=crypto.randomUUID().replaceAll('-','');
  return {close(){},async generate(text) {
    // Los fragmentos se procesan en serie en la misma sesión y respetan la cuota del servidor.
    const signal=timeout(360000);
    const response=await checked(API+'/queue/join',{method:'POST',signal,headers:{'Content-Type':'application/json'},
      body:JSON.stringify({fn_index:fn.id,session_hash:session,data:[text,file,0.5,0.8,0,0.5],event_data:null})});
    const {event_id}=await response.json();
    if(!event_id) throw Error('Chatterbox no pudo iniciar la generación.');
    const queue=await checked(API+'/queue/data?session_hash='+encodeURIComponent(session),{signal});
    for await (const event of events(queue.body)) {
      if(event.event_id && event.event_id!==event_id)continue;
      if(event.msg==='estimation' && event.rank>0) onStatus('En la cola de Chatterbox. Posición '+(event.rank+1)+'.');
      if(event.msg==='unexpected_error' || event.msg==='queue_full' || (event.msg==='process_completed' && !event.success)) {
        const detail=String(event.output?.error || event.message || '');
        if(/quota|limit|GPU time/i.test(detail)) throw Error('Se agotó la cuota gratuita de Chatterbox. El progreso está guardado para continuar más tarde.');
        throw Error('Chatterbox no terminó el fragmento. '+detail.slice(0,160));
      }
      if(event.msg==='process_completed') {
        const url=new URL(event.output?.data?.[0]?.url || '',SPACE);
        if(url.origin!==SPACE || !url.pathname.startsWith('/gradio_api/file=')) throw Error('Chatterbox devolvió un archivo inesperado.');
        return decodeMono(await (await checked(url,{signal})).blob());
      }
    }
    throw Error('Se interrumpió la conexión con Chatterbox. Puedes continuar desde el último fragmento.');
  }};
}
