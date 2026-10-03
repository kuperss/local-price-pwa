import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ReadCache} from '../worker/read-cache.js';
import {measureDatabase,databaseIdentity,recordCacheHit} from '../worker/db-usage.js';

test('cache coalesces work, clones values and expires without caching failures',async()=>{
 let now=0,calls=0;const cache=new ReadCache({ttl:10,now:()=>now});
 const loader=async()=>{calls++;return {value:1};};
 const [a,b]=await Promise.all([cache.get('a',loader),cache.get('a',loader)]);
 assert.equal(calls,1);a.value=9;assert.equal(b.value,1);assert.equal((await cache.get('a',loader)).value,1);
 now=11;await cache.get('a',loader);assert.equal(calls,2);
 for(let i=0;i<2;i++)await assert.rejects(cache.get('bad',()=>{calls++;throw Error('fail');}),/fail/);
 assert.equal(calls,4);assert.equal(cache.entries.has('bad'),false);
});

test('cache is bounded by entry count and bytes, including pending entries',async()=>{
 const cache=new ReadCache({maxEntries:2,maxEntryBytes:10,maxBytes:12});
 await cache.get('big',async()=>'a'.repeat(20));assert.equal(cache.entries.size,0);
 for(const key of ['a','b','c'])await cache.get(key,async()=>'1234');
 assert.ok(cache.entries.size<=2);assert.ok(cache.bytes<=12);assert.ok(!cache.entries.has('a'));
 let finish;const pending=cache.get('pending',()=>new Promise(resolve=>finish=resolve));
 await Promise.resolve();cache.clear();finish('late');await pending;
 assert.equal(cache.entries.size,0);assert.equal(cache.bytes,0);
});

test('usage preserves raw database identity and batch behavior without SQL or bind leakage',async()=>{
 const raw={prepare(sql){return {bind(){return this;},async all(){return {results:[{v:1}],meta:{rows_read:3,rows_written:0}};},async run(){return {meta:{rows_read:1,rows_written:2}};}};},async batch(stmts){return Promise.all(stmts.map(s=>s.run()));}};
 const measured=measureDatabase(raw),db=measured.db;
 assert.equal(databaseIdentity(db),raw);
 assert.equal(await db.prepare('private SQL').bind('secret').first('v'),1);
 await db.batch([db.prepare('private SQL').bind('secret')]);recordCacheHit(db);
 assert.deepEqual(measured.summary(),{statements:2,failedStatements:0,rowsRead:4,rowsWritten:2,unmeasured:0,cacheHits:1});
 assert.ok(!JSON.stringify(measured.summary()).includes('secret'));
});

test('evicted pending entries cannot reinsert themselves or corrupt cache byte accounting',async()=>{
 const cache=new ReadCache({maxEntries:2});const finishes=[],pending=[];
 for(let i=0;i<6;i++){
  pending.push(cache.get(String(i),()=>new Promise(resolve=>finishes[i]=resolve)));
  await Promise.resolve();assert.ok(cache.entries.size<=2);
 }
 for(let i=5;i>=0;i--)finishes[i]({i});
 await Promise.all(pending);
 assert.deepEqual([...cache.entries.keys()],['4','5']);
 assert.equal(cache.bytes,14);
});
