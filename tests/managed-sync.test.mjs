import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startManaged} from '../managed.js';
import {COST_FORMAT} from '../cost-crypto.js';

// Small DOM boundary double: this tests controller state/security, not browser layout.
class Element extends EventTarget {
 constructor(){super();this.hidden=false;this.disabled=false;this.children=new Map();}
 setAttribute(){}
 append(){}
 querySelector(selector){if(!this.children.has(selector))this.children.set(selector,new Element());return this.children.get(selector);}
}
test('combined sync reuses loaded rows, but rotation, reapproval and revocation remain live',async()=>{
 const original=new Map(['document','window','navigator','location','fetch','setInterval','caches'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const values=new Map(),routes=[],statuses=[],intervals=[];
 let activations=0,locks=0,clears=0,offline=false,quota=false;
 const doc=new Element();doc.body=new Element();doc.createElement=()=>new Element();doc.querySelectorAll=()=>[];doc.hidden=false;
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 const identity={id:crypto.randomUUID(),privateKey:pair.privateKey,registered:true};
 values.set('managed-identity',identity);
 const key=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12));
 const cryptoKey=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt']);
 const version='controller-test-v1',rows=[{'型號':'SAFE-001','品名':'測試產品','底價':'100'}];
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(version)},cryptoKey,new TextEncoder().encode(JSON.stringify(rows)));
 const full={version,fetchedAt:'2026-09-21T17:00:00',count:1,key:Buffer.from(key).toString('base64'),iv:Buffer.from(iv).toString('base64'),cipher:Buffer.from(cipher).toString('base64'),hash:Buffer.from(await crypto.subtle.digest('SHA-256',cipher)).toString('hex'),securityFormat:COST_FORMAT,costRevision:'none',cost:{configured:false,revision:'none'}};
 let state={id:identity.id,name:'Synthetic User',status:'approved',approvedAt:'approval-1',bundle:full};
 const globals={document:doc,window:new Element(),navigator:{onLine:true},location:{origin:'https://app.test'},caches:{keys:async()=>[]},setInterval:(fn,delay)=>{intervals.push({fn,delay});return 1;},fetch:async(url,options)=>{
  const path=new URL(url).pathname;routes.push(path);
  if(offline)throw new TypeError('network unavailable');
  if(quota)return Response.json({error:'每日額度已用完',code:'D1_DAILY_READ_LIMIT'},{status:503});
  if(path==='/api/sync'){
   assert.equal(options.method,'POST');assert.ok(options.headers['X-Device-Signature']);
   const request=JSON.parse(options.body);assert.ok('version' in request&&'costRevision' in request);
   return Response.json(state);
  }
  if(path==='/api/events')return Response.json({ok:true,status:state.status});
  throw new Error('Unexpected endpoint '+path);
 }};
 try{
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  const controller=await startManaged({get:async k=>values.get(k),set:async(k,v)=>values.set(k,v),del:async k=>values.delete(k),activate:async data=>{assert.deepEqual(data,rows);activations++;},clear:()=>{clears++;},lockCosts:()=>{locks++;},showCosts:()=>{},status:s=>statuses.push(s),toast:()=>{}});
  assert.equal(controller.allowed,true);assert.equal(activations,1);
  assert.equal(intervals.length,1);assert.equal(intervals[0].delay,60000);
  const cached=values.get('managed-cache');
  assert.equal(cached.localKey.extractable,false);assert.equal(cached.key,undefined);
  state={...state,bundle:{unchanged:true,version,securityFormat:COST_FORMAT,costRevision:'none'}};
  for(let i=0;i<3;i++)await controller.sync();
  assert.equal(activations,1,'unchanged successful checks do not rebuild the displayed data');
  assert.equal(routes.filter(x=>x==='/api/sync').length,4,'permission checks are not skipped');
  assert.equal(routes.includes('/api/status')||routes.includes('/api/bundle'),false);
  values.set('managed-cost-access',{sentinel:'must be deleted'});
  state={...state,bundle:{...state.bundle,costRevision:'rotated',cost:{configured:false,revision:'rotated'}}};
  const locksBefore=locks;await controller.sync();
  assert.equal(values.has('managed-cost-access'),false);assert.ok(locks>locksBefore);
  assert.equal(values.get('managed-cache').costRevision,'rotated');
  values.set('managed-cost-access',{sentinel:'reapproval must delete'});
  state={...state,approvedAt:'approval-2'};await controller.sync();
  assert.equal(values.has('managed-cost-access'),false);
  assert.equal(values.get('managed-grant').approvedAt,'approval-2');
  const count=activations;
  offline=true;await controller.sync();offline=false;
  assert.equal(controller.allowed,true);assert.equal(activations,count);
  quota=true;await controller.sync();quota=false;
  assert.equal(controller.allowed,true);assert.ok(statuses.at(-1).includes('保留原料檔'));
  assert.equal(activations,count);
  state={...state,status:'revoked'};delete state.bundle;
  await controller.sync();
  assert.equal(controller.allowed,false);assert.equal(values.has('managed-cache'),false);
  assert.equal(values.has('managed-grant'),false);assert.equal(values.has('managed-cost-access'),false);
  assert.equal(values.get('managed-identity'),identity);assert.ok(clears>0);
 }finally{
  for(const [key,descriptor] of original)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
 }
});
