import {splitText, RATE, waveHeader, encodeWave, waveFloats, decodeMono} from './audio.js';
import {read,load,save,startJob,savePart} from './store.js';
import {openCloud} from './chatterbox.js';

const el = id => document.getElementById(id);
const script = el('script'), engine = el('engine'), output = el('output');
const nf = new Intl.NumberFormat('es-US');
let voice, job, recorded, busy=false, changingSample=false, stopRequested=false, ready=false;
let currentPart=-1, playingURL='', sampleURL='', exportURLs=[], draftTimer, timer, playVersion=0;
const notice=(id,text,error=false)=>{const node=el(id); node.textContent=text;node.classList.toggle('error',error);};
function errorText(e) {
  if (e.name==='QuotaExceededError') return 'El almacenamiento de este dispositivo está lleno. Guarda los fragmentos terminados y libera espacio antes de continuar.';
  if (e.name==='NotAllowedError') return 'Safari necesita permiso para usar el micrófono. También puedes tocar Subir audio.';
  if (e.name==='NotFoundError') return 'No se encontró un micrófono. Puedes subir una grabación.';
  if (['TimeoutError','AbortError'].includes(e.name)) return 'La operación se interrumpió. Puedes volver a intentarlo.';
  if (/failed to fetch|load failed|networkerror/i.test(e.message)) return 'No se pudo conectar. Comprueba tu conexión y vuelve a intentarlo.';
  return e.message || 'No se pudo completar la operación.';
}
function duration(n) {
  const secs=Math.floor(n); return Math.floor(secs/60).toString().padStart(2,'0')+':'+(secs%60).toString().padStart(2,'0');
}
function wave(samples) {
  const canvas=el('wave'), c=canvas.getContext('2d'), w=canvas.width, h=canvas.height;
  const count=64;c.clearRect(0,0,w,h);c.lineWidth=4;c.lineCap='round';
  for(let i=0;i<count;i++) {
    let level=0;
    if(samples?.length){
      const from=Math.floor(i*samples.length/count), to=Math.floor((i+1)*samples.length/count);
      for(let j=from;j<to;j+=4)level=Math.max(level,Math.abs(samples[j]));
    }else level=.08+.58*Math.abs(Math.sin(i*.43)*Math.sin(i*.091+.5))*(.64+.36*Math.cos(i*1.12));
    const half=Math.max(2,Math.min(.94,level)*h*.47);
    c.strokeStyle=samples?'#d2ef7f':'#829b78'; const x=(i+.5)*w/count;
    c.beginPath();c.moveTo(x,h/2-half);c.lineTo(x,h/2+half);c.stroke();
  }
}
function matches() {
  return job && job.voice===voice?.id && job.text===script.value.trim() && job.engine===engine.value;
}
function controls() {
  const lock=busy || changingSample || !!recorded;
  el('count').textContent=nf.format(script.value.length)+' caracteres';
  el('generate').disabled=!ready || lock || !voice || !script.value.trim() || (matches()&&job.done===job.total);
  el('gen-label').textContent=busy?'Generando…':matches()&&job.done<job.total?'Continuar narración':'Generar con mi voz';
  el('pause').hidden=!busy;el('pause').disabled=stopRequested;
  script.readOnly=busy;engine.disabled=lock;el('upload').disabled=!ready||lock;
  document.querySelector('.upload').classList.toggle('disabled',el('upload').disabled);
  el('record').disabled=!ready||busy||changingSample;
  el('record').classList.toggle('on',!!recorded);el('rec-label').textContent=recorded?'Terminar':'Grabar';
  el('engine-info').textContent=engine.value==='cloud'?'Al generar, se envían tu grabación y el texto a Chatterbox en Hugging Face. Su cuota gratuita es diaria.':'Descarga inicial de unos 160 MB. Luego tu voz y tu texto se procesan aquí, sin cuota por minuto.';
  el('player').hidden=!job?.done;
  el('progress').hidden=!job;
  if(job){
    el('progress').max=job.total;el('progress').value=job.done;
    el('progress-label').textContent=nf.format(job.done)+' de '+nf.format(job.total)+' fragmentos';
    el('output-info').textContent=job.done===job.total?'Narración completa. Puedes escucharla o guardarla.':job.done?'Los fragmentos terminados ya se pueden escuchar y guardar.':'El primer fragmento aparecerá aquí.';
  }
  el('prev').disabled=currentPart<=0;el('next').disabled=!job || currentPart>=job.done-1;
  el('position').textContent=currentPart>=0?'Fragmento '+nf.format(currentPart+1):'';
}
async function showVoice() {
  if(!voice){wave();return;}
  el('sample-state').textContent='Tu muestra';el('clock').textContent=duration(voice.seconds);
  if(sampleURL)URL.revokeObjectURL(sampleURL);sampleURL=URL.createObjectURL(voice.wav);
  el('sample-audio').src=sampleURL;el('sample-audio').hidden=false;
  wave(waveFloats(await voice.wav.arrayBuffer()));
}
async function storeSample(blob) {
  changingSample=true;controls();notice('sample-message','Preparando tu muestra…');
  try {
    if(blob.size>32*1024*1024)throw Error('Elige un archivo de voz de menos de 32 MB.');
    const data=await decodeMono(blob,12);
    if(data.length<2*RATE)throw Error('La muestra es demasiado corta. Graba al menos 2 segundos de voz.');
    let power=0;for(const v of data)power+=v*v;
    if(Math.sqrt(power/data.length)<.001)throw Error('La muestra está en silencio. Grábala otra vez más cerca del micrófono.');
    const sample={id:crypto.randomUUID(),wav:encodeWave(data),seconds:data.length/RATE};
    await save('voice',sample);voice=sample;await showVoice();
    notice('sample-message','Muestra lista. Puedes escucharla antes de generar.');
  }catch(e){notice('sample-message',errorText(e),true);await showVoice();}
  finally{changingSample=false;el('upload').value='';controls();}
}
el('upload').onchange=()=>{const file=el('upload').files[0];if(file)storeSample(file);};
el('record').onclick=async()=>{
  if(recorded){if(recorded.state==='recording')recorded.stop();return;}
  changingSample=true;controls();notice('sample-message','Abriendo el micrófono…');
  let stream;
  try{
    if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)throw Error('Este navegador no ofrece grabación. Abre la app en Safari o toca Subir audio.');
    stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1},video:false});
    const type=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));
    const recorder=new MediaRecorder(stream,type?{mimeType:type}:undefined), pieces=[];
    recorder.ondataavailable=e=>{if(e.data.size)pieces.push(e.data);};
    recorder.onstop=async()=>{
      clearInterval(timer);stream.getTracks().forEach(t=>t.stop());recorded=null;
      await storeSample(new Blob(pieces,{type:recorder.mimeType}));
    };
    recorder.onerror=e=>{clearInterval(timer);stream.getTracks().forEach(t=>t.stop());recorded=null;changingSample=false;controls();notice('sample-message',errorText(e.error||e),true);};
    recorder.start();recorded=recorder;changingSample=false;
    const start=performance.now();el('sample-state').textContent='Grabando';el('clock').textContent='00:00';
    timer=setInterval(()=>{const s=(performance.now()-start)/1000;el('clock').textContent=duration(s);if(s>=12&&recorder.state==='recording')recorder.stop();},150);
    notice('sample-message','Habla con naturalidad. La grabación se detiene a los 12 segundos.');
  }catch(e){stream?.getTracks().forEach(t=>t.stop());changingSample=false;recorded=null;notice('sample-message',errorText(e),true);}
  controls();
};
function clearDownloads() {
  for(const url of exportURLs)URL.revokeObjectURL(url);exportURLs=[];el('downloads').replaceChildren();
}
async function playPart(index,autoplay=false) {
  if(!job || index<0 || index>=job.done)return;
  const version=++playVersion, blob=await read('parts',index);
  if(version!==playVersion || !blob)return;
  output.pause();if(playingURL)URL.revokeObjectURL(playingURL);
  playingURL=URL.createObjectURL(blob);output.src=playingURL;currentPart=index;controls();
  if(autoplay)await output.play().catch(()=>notice('status','Toca reproducir para seguir escuchando.'));
}
output.onended=()=>{if(job && currentPart+1<job.done)playPart(currentPart+1,true).catch(e=>notice('status',errorText(e),true));};
el('prev').onclick=()=>playPart(currentPart-1,!output.paused);
el('next').onclick=()=>playPart(currentPart+1,!output.paused);
el('export').onclick=async()=>{
  const button=el('export');button.disabled=true;clearDownloads();
  try{
    const {id,done}=job;let blocks=[],bytes=0,volume=0;
    function finish(){
      if(!bytes)return;
      const blob=new Blob([waveHeader(bytes),...blocks],{type:'audio/wav'}),url=URL.createObjectURL(blob);
      exportURLs.push(url);const a=document.createElement('a');a.href=url;a.download='mi-narracion-'+(++volume)+'.wav';a.textContent='Descargar WAV '+volume+' · '+(blob.size/1048576).toFixed(1)+' MB';el('downloads').append(a);
      blocks=[];bytes=0;
    }
    for(let i=0;i<done;i++){
      const part=await read('parts',i);
      if(!part || job.id!==id)throw Error('La narración cambió. Vuelve a preparar la descarga.');
      if(bytes+part.size-44>128*1024*1024)finish();
      blocks.push(part.slice(44));bytes+=part.size-44;
    }
    finish();
  }catch(e){clearDownloads();notice('status',errorText(e),true);}finally{button.disabled=false;}
};
script.oninput=()=>{controls();clearTimeout(draftTimer);draftTimer=setTimeout(()=>save('draft',script.value).catch(e=>notice('status',errorText(e),true)),250);};
engine.onchange=()=>{controls();save('engine',engine.value).catch(e=>notice('status',errorText(e),true));};
el('pause').onclick=()=>{stopRequested=true;controls();notice('status','Pausa solicitada. Se guardará el fragmento en curso.');};
async function run(lock) {
  if(!lock){notice('status','Hay una narración en marcha en otra pestaña.',true);return;}
  busy=true;stopRequested=false; controls();let motor,wake;
  const status=t=>notice('status',t);
  try {
    const text=script.value.trim(), parts=splitText(text);
    const old=await load('job');job=old;
    if(!voice || !parts.length)return;
    // El audio anterior sigue disponible si el nuevo motor no llega a iniciar.
    if(engine.value==='local'){
      status('Preparando el motor en español…');
      const {openLocal}=await import('./local/local-engine.js');
      motor=await openLocal(status);
      status('Preparando tu voz…');await motor.setVoice(waveFloats(await voice.wav.arrayBuffer()));
    }else motor=await openCloud(voice.wav,status);
    if(!matches()){
      if(stopRequested)return;
      const nextJob={id:crypto.randomUUID(),voice:voice.id,text,engine:engine.value,total:parts.length,done:0};
      await startJob(nextJob);job=nextJob;++playVersion;currentPart=-1;output.pause();output.removeAttribute('src');output.load();
      if(playingURL)URL.revokeObjectURL(playingURL);playingURL='';clearDownloads();
    }
    await save('draft',text);controls();
    wake=await navigator.wakeLock?.request('screen').catch(()=>undefined);
    for(let i=job.done;i<parts.length&&!stopRequested;i++){
      status('Generando el fragmento '+nf.format(i+1)+' de '+nf.format(parts.length)+'…');
      const samples=await motor.generate(parts[i]);
      if(!samples?.length)throw Error('El motor devolvió un fragmento vacío.');
      const next={...job,done:i+1};
      await savePart(next,i,encodeWave(samples));job=next;
      if(currentPart===-1)await playPart(0);
      controls();
    }
    status(job.done===job.total?'Tu narración está lista.':'En pausa. Puedes continuar desde el siguiente fragmento.');
  }catch(e){notice('status',errorText(e),true);}
  finally{motor?.close();await wake?.release().catch(()=>{});busy=false;controls();}
}
el('generate').onclick=()=>{
  if(busy)return;
  if(navigator.locks)navigator.locks.request('voz-continua-generar',{ifAvailable:true},run).catch(e=>notice('status',errorText(e),true));
  else run(true);
};
async function init() {
  wave();controls();
  try {
    const [v,j,text,mode]=await Promise.all([load('voice'),load('job'),load('draft'),load('engine')]);
    voice=v;job=j;script.value=text??j?.text??'';engine.value=mode==='cloud'?'cloud':'local';await showVoice();
    if(job?.done)await playPart(0);ready=true;
    if(job && job.done<job.total)notice('status','Tu progreso está guardado. Toca Continuar narración para seguir.');
  }catch(e){notice('status','La app necesita almacenamiento en este navegador. '+errorText(e),true);}
  controls();
}
init();
