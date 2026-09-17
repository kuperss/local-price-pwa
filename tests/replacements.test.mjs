import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stockStatus,replacementCodes,operationalQuantity} from '../admin/replacements.js';
test('replacement stock labels distinguish positive, zero, negative, unknown and missing',()=>{
 assert.deepEqual(stockStatus({available:19275}),{tone:'in-stock',label:'有貨 · 19,275'});
 assert.equal(stockStatus({available:0}).label,'無貨 · 0');
 assert.equal(stockStatus({available:-2}).label,'無可用量 · -2');
 assert.equal(stockStatus({available:null}).label,'庫存未知');
 assert.equal(stockStatus({missing:1,available:0}).label,'查無來源');
 assert.deepEqual(replacementCodes({transfer:'NEW',targets:'["NEW","NEW2"]'}),['NEW','NEW2']);
});

test('A2 zero and incoming zero/missing are neutral without treating missing stock as zero',()=>{
 assert.deepEqual(operationalQuantity(0,'a2'),{label:'0',tone:'neutral'});
 assert.deepEqual(operationalQuantity(0,'incoming'),{label:'0',tone:'neutral'});
 assert.deepEqual(operationalQuantity(null,'incoming'),{label:'未列在途',tone:'neutral'});
 assert.deepEqual(operationalQuantity(null,'a2'),{label:'未知',tone:'neutral'});
 assert.equal(operationalQuantity(-1,'a2').tone,'negative');
});
