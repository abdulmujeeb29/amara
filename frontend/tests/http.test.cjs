const test=require('node:test');
const assert=require('node:assert/strict');
const HTTP=require('../js/http.js');

test('non-JSON outage responses become actionable messages, not parser errors',async()=>{
  const response={ok:false,status:503,json:async()=>{throw new SyntaxError('Unexpected token <');}};
  await assert.rejects(HTTP.json(response,'Route service unavailable. Try again.'),error=>error.message==='Route service unavailable. Try again.'&&error.userFacing&&error.status===503);
});
test('structured validation errors retain their safe application message and code',async()=>{
  await assert.rejects(HTTP.json({ok:false,status:400,json:async()=>({error:'Choose a point in Lagos.',code:'outside_area'})},'Unavailable'),error=>error.code==='outside_area'&&error.message==='Choose a point in Lagos.');
});
test('network errors use the caller fallback instead of technical browser text',()=>{
  assert.equal(HTTP.explain(new TypeError('Failed to fetch'),'Check your connection.'),'Check your connection.');
});
test('malformed successful payloads are rejected while valid objects pass',async()=>{
  await assert.rejects(HTTP.json({ok:true,status:200,json:async()=>[]},'Invalid response'));
  assert.deepEqual(await HTTP.json({ok:true,status:200,json:async()=>({route:{}})},'Invalid'),{route:{}});
});
