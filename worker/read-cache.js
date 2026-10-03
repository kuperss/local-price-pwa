// Best-effort isolate-local cache, not an authorization cache. Cold starts are safe misses.
export class ReadCache {
 constructor({maxEntries=128,maxBytes=8*1024*1024,maxEntryBytes=512*1024,ttl=300000,now=Date.now}={}){
  Object.assign(this,{maxEntries,maxBytes,maxEntryBytes,ttl,now});this.entries=new Map();this.bytes=0;
 }
 remove(key){const entry=this.entries.get(key);if(entry){this.bytes-=entry.bytes||0;this.entries.delete(key);}}
 clear(){this.entries.clear();this.bytes=0;}
 async get(key,loader,onHit=()=>{}){
  let entry=this.entries.get(key);
  if(entry&&entry.expires>this.now()){
   this.entries.delete(key);this.entries.set(key,entry);onHit();return structuredClone(await entry.promise);
  }
  this.remove(key);
  entry={expires:this.now()+this.ttl,bytes:0};
  // Register before the loader starts so concurrent callers share the same work.
  entry.promise=Promise.resolve().then(loader).then(value=>{
   const size=new TextEncoder().encode(JSON.stringify(value)).byteLength;
   if(this.entries.get(key)===entry){
    if(size>this.maxEntryBytes)this.remove(key);
    else{entry.bytes=size;this.bytes+=size;while(this.bytes>this.maxBytes||this.entries.size>this.maxEntries)this.remove(this.entries.keys().next().value);}
   }
   return value;
  }).catch(error=>{if(this.entries.get(key)===entry)this.remove(key);throw error;});
  this.entries.set(key,entry);
  while(this.entries.size>this.maxEntries)this.remove(this.entries.keys().next().value);
  return structuredClone(await entry.promise);
 }
}
