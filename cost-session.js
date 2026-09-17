import {passwordKey,decryptCostEnvelopeWithKey} from './cost-crypto.js';
export const COST_ACCESS_KEY='managed-cost-access';

// Persist a non-exportable KEK, never the password or decrypted product rows.
// Scope is device + approval generation + password revision, NOT dataset version.
export function createCostSession({get,set,del,context,lock,show}) {
  let epoch=0,queue=Promise.resolve();
  const exclusive=fn=>{const task=queue.then(fn);queue=task.catch(()=>{});return task;};
  const same=(a,b)=>a.id===b.id&&a.approval===b.approval&&a.revision===b.revision;
  const usable=c=>c.allowed&&c.id&&c.approval&&c.envelope?.configured;
  const unchanged=(c,token)=>token===epoch&&usable(context())&&same(c,context())&&c.version===context().version;
  function forget(){epoch++;lock();return exclusive(()=>del(COST_ACCESS_KEY));}
  async function unlock(password){
    const c=context(),token=epoch;
    if(!usable(c))throw new Error('請先連線確認装置權限及@密碼設定');
    const key=await passwordKey(password,c.envelope.salt);
    const rows=await decryptCostEnvelopeWithKey(key,c.envelope);
    await exclusive(async()=>{
      if(!unchanged(c,token))throw new Error('權限或料檔已變更，請重新解鎖');
      await set(COST_ACCESS_KEY,{id:c.id,approval:c.approval,revision:c.revision,key});
    });
    if(!unchanged(c,token))throw new Error('權限或料檔已變更，請重新解鎖');
    return rows;
  }
  async function restore(){
    const c=context(),token=epoch;
    if(!usable(c)){lock();return false;}
    const saved=await get(COST_ACCESS_KEY);
    if(!unchanged(c,token))return false;
    if(!saved){lock();return false;}
    if(!same(c,saved)||saved.key?.type!=='secret'||saved.key.extractable!==false){await forget();return false;}
    try{
      const rows=await decryptCostEnvelopeWithKey(saved.key,c.envelope);
      if(!unchanged(c,token))return false;
      show(rows);return true;
    }catch{if(unchanged(c,token))await forget();return false;}
  }
  return {unlock,restore,forget};
}
