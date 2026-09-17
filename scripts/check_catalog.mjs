// Read-only operational check of the real admin query path against D1.
// No device creation, no Access bypass on the deployed site, no product rows logged.
import {readFile} from 'node:fs/promises';
import {catalogApi} from '../worker/catalog.js';
const cfg=JSON.parse(await readFile(new URL('../deployment.local.json',import.meta.url),'utf8'));
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!account||!token)throw new Error('Existing Cloudflare environment required');
async function query(sql,params){
 if(!/^(SELECT\b|WITH universe AS\s*\()/i.test(sql.trim())||/\b(INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\b/i.test(sql))throw new Error('Only readonly catalog SQL permitted');
 const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${cfg.database_id}/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
 const value=await r.json();if(!r.ok||!value.success||!value.result?.[0]?.success)throw new Error('D1 readonly query failed: HTTP '+r.status);
 return value.result[0].results;
}
const db={prepare(sql){return {params:[],bind(...params){this.params=params;return this;},async first(){return (await query(sql,this.params))[0]||null;},async all(){return {results:await query(sql,this.params)};}};}};
for(const search of ['', '?scope=all','?filters=transfer_zero','?filters=clearance','?scope=archived']){
 const url=new URL('https://diagnostic.invalid/admin/api/products'+search),start=Date.now();
 const r=await catalogApi(new Request(url),db,url,{},'readonly-diagnostic');
 const data=await r.json();if(!Array.isArray(data.rows)||typeof data.total!=='number')throw new Error('Unexpected catalog response');
 console.log(JSON.stringify({filter:search||'active',total:data.total,pageRows:data.rows.length,fetchedAt:data.fetchedAt,elapsedMs:Date.now()-start}));
}
