const database = new Promise((resolve,reject)=>{
  const open = indexedDB.open('voz-continua-v1',1);
  open.onupgradeneeded=()=>{open.result.createObjectStore('settings');open.result.createObjectStore('parts');};
  open.onsuccess=()=>{open.result.onversionchange=()=>open.result.close();resolve(open.result);};
  open.onerror=()=>reject(open.error);
});
export async function read(store,key) {
  const db=await database;
  return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(key);
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
export async function write(stores,changes) {
  const db=await database;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(stores,'readwrite');
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || Error('No se pudo guardar el progreso.'));
    changes(tx);
  });
}
export const save=(key,value)=>write(['settings'], tx=>tx.objectStore('settings').put(value,key));
export const load=(key)=>read('settings',key);
export function startJob(job) {
  return write(['settings','parts'], tx=>{tx.objectStore('settings').put(job,'job');tx.objectStore('parts').clear();});
}
export function savePart(job,index,audio) {
  return write(['settings','parts'],tx=>{
    const settings=tx.objectStore('settings');
    const get=settings.get('job');
    get.onsuccess=()=>{
      if(get.result?.id!==job.id || get.result.done!==index){tx.abort();return;}
      tx.objectStore('parts').put(audio,index);settings.put(job,'job');
    };
  });
}
