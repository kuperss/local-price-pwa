import {test} from 'node:test';
import assert from 'node:assert/strict';
import {serviceError} from '../worker/service-error.js';
import worker from '../worker/index.js';
const quota="Your account has exceeded D1's free tier daily row read limit.";

test('daily D1 quota is actionable, generic errors remain private and authorization errors retain status',()=>{
 for(const error of [new Error(quota),new Error('D1_ERROR',{cause:new Error(quota)})]){
  const result=serviceError(error);
  assert.equal(result.status,503);assert.equal(result.body.code,'D1_DAILY_READ_LIMIT');
  assert.match(result.body.error,/每日早上 8 點/);
  assert.doesNotMatch(result.body.error,/SELECT|token|Your account/);
 }
 assert.deepEqual(serviceError(new Error('7500: private SQL SELECT secret')),{status:500,body:{error:'服務暫時無法使用'}});
 assert.deepEqual(serviceError(Object.assign(new Error('請先登入'),{status:401})),{status:401,body:{error:'請先登入'}});
});

test('Worker returns no-store 503 for quota errors without pretending authorization succeeded',async()=>{
 const response=await worker.fetch(new Request('https://test/api/status',{headers:{
  'X-Device-Id':crypto.randomUUID(),'X-Device-Nonce':crypto.randomUUID(),'X-Device-Time':String(Date.now())
 }}),{DB:{prepare(){throw new Error('D1_ERROR',{cause:new Error(quota)});}}});
 assert.equal(response.status,503);
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 const result=await response.json();assert.equal(result.code,'D1_DAILY_READ_LIMIT');assert.equal(result.status,undefined);
});
