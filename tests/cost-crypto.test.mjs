import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCostGesture,createCostPasswordConfig,validCostConfig,isCostField} from '../cost-crypto.js';

test('only 5 → 4 → 3 opens the password prompt; wrong tap and timeout reset',()=>{
  let opened=0,time=1;
  const tap=createCostGesture(()=>opened++,()=>time);
  const press=(key,count)=>{for(let i=0;i<count;i++)tap(key);};
  press('pill',5);press('logo',5);press('pill',3);assert.equal(opened,0);
  time+=3001;press('pill',5);press('logo',4);press('pill',3);assert.equal(opened,1);
  time+=3001;press('pill',5);time+=3001;press('logo',4);press('pill',3);assert.equal(opened,1);
  time+=3001;press('pill',5);press('logo',4);press('pill',3);assert.equal(opened,2);
});
test('cost password parameters and field classification are constrained',async()=>{
  await assert.rejects(createCostPasswordConfig('short'));
  await assert.rejects(createCostPasswordConfig(' '.repeat(12)));
  assert.equal(validCostConfig({iterations:1,salt:'bad',wrappingKey:'bad'}),false);
  for(const key of ['成本','銷售成本','規格_成本','COST','unit_cost'])assert.equal(isCostField(key),true);
  for(const key of ['底價','量價','中文品名','型號'])assert.equal(isCostField(key),false);
});
