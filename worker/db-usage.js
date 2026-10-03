// Request-local counters only. Never log SQL, bindings, identities or key material.
const identities=new WeakMap(), counters=new WeakMap();
export const databaseIdentity=db=>identities.get(db)||db;
export function recordCacheHit(db){const usage=counters.get(db);if(usage)usage.cacheHits++;}
export function measureDatabase(raw){
 const usage={statements:0,failedStatements:0,rowsRead:0,rowsWritten:0,unmeasured:0,cacheHits:0};
 const originals=new WeakMap();
 function count(result){
  usage.statements++;
  const meta=result?.meta;
  if(Number.isFinite(meta?.rows_read)&&Number.isFinite(meta?.rows_written)){
   usage.rowsRead+=meta.rows_read;usage.rowsWritten+=meta.rows_written;
  }else usage.unmeasured++;
  return result;
 }
 function wrap(statement){
  const proxy={
   bind(...values){return wrap(statement.bind(...values));},
   async all(){try{return count(await statement.all());}catch(error){usage.failedStatements++;usage.unmeasured++;throw error;}},
   async first(column){const result=await proxy.all();const row=result.results?.[0]??null;return column&&row?row[column]:row;},
   async run(){try{return count(await statement.run());}catch(error){usage.failedStatements++;usage.unmeasured++;throw error;}}
  };
  originals.set(proxy,statement);return proxy;
 }
 const db={prepare(sql){return wrap(raw.prepare(sql));},async batch(statements){try{return (await raw.batch(statements.map(s=>originals.get(s)||s))).map(count);}catch(error){usage.failedStatements+=statements.length;usage.unmeasured+=statements.length;throw error;}}};
 identities.set(db,databaseIdentity(raw));counters.set(db,usage);
 return {db,summary:()=>({...usage})};
}
