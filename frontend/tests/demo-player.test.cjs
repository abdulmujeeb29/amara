const test=require('node:test');
const assert=require('node:assert/strict');
const Player=require('../js/demo-player.js');
const geo=require('../js/geo.js');

function harness(replayEvents=null){
  let time=0,id=0;const callbacks=new Map(),frames=[],cues=[];
  const route=[[3.37,6.50],[3.37,6.51],[3.38,6.51]];
  const player=new Player({route,geo,reportIds:['one','two'],replayEvents,now:()=>time,requestFrame:fn=>{const key=id++;callbacks.set(key,fn);return key;},cancelFrame:key=>callbacks.delete(key),onFrame:frame=>frames.push(frame),onCue:cue=>cues.push(cue)});
  return {player,frames,cues,callbacks,advance(ms){for(let n=0;n<ms;n+=50){time+=Math.min(50,ms-n);const pending=[...callbacks.values()];callbacks.clear();pending.forEach(fn=>fn());}},jumpClock(ms){time+=ms;}};
}

test('marker changes continuously before the first incident, rather than jumping per scene',()=>{
  const h=harness();h.player.start();h.advance(2000);
  assert.ok(h.frames.length>=30);
  assert.ok(geo.distance(h.frames[0].coordinates,h.frames.at(-1).coordinates)>20);
  const deltas=h.frames.slice(1).map((f,i)=>geo.distance(f.coordinates,h.frames[i].coordinates));
  assert.ok(deltas.every(d=>d>0&&d<10));
  assert.equal(h.cues.length,0);h.player.stop();
});

test('report reveals and journey notices fire once at separate times',()=>{
  const h=harness();h.player.start();h.advance(8000);assert.deepEqual(h.cues.map(c=>c.id),['report-one']);
  h.advance(72000);
  assert.deepEqual(h.cues.map(c=>c.id),['report-one','report-two','wrong-way','back-on-route','arrived']);
  assert.equal(h.player.state,'complete');assert.equal(h.callbacks.size,0);
  assert.ok(geo.distance(h.frames.at(-1).coordinates,[3.38,6.51])<.001);
});

test('pause freezes position and does not fast-forward through alerts on resume',()=>{
  const h=harness();h.player.start();h.advance(5000);h.player.pause();const elapsed=h.player.elapsed,count=h.frames.length;
  h.jumpClock(30000);assert.equal(h.callbacks.size,0);assert.equal(h.frames.length,count);
  h.player.resume();h.advance(500);assert.equal(h.player.elapsed,elapsed+500);assert.equal(h.cues.length,0);h.player.stop();
});

test('backward section remains on road geometry and recovery moves forward again',()=>{
  const h=harness();h.player.start();h.advance(29000);const before=h.frames.at(-1);
  h.advance(1000);const backwards=h.frames.at(-1);assert.equal(backwards.backwards,true);assert.ok(backwards.fraction<before.fraction);
  assert.ok(geo.project(backwards.coordinates,h.player.route).distance<1);
  h.advance(8000);assert.equal(h.frames.at(-1).backwards,false);h.player.stop();
});

test('stop cancels animation and late frame callbacks cannot restart it',()=>{
  const h=harness();h.player.start();const pending=[...h.callbacks.values()][0];h.player.stop();const count=h.frames.length;
  pending();assert.equal(h.frames.length,count);assert.equal(h.callbacks.size,0);assert.equal(h.player.state,'idle');
});

test('saved reports progress from received to checking to reviewed in 3.5 replay seconds',()=>{
  const h=harness([{key:'saved',at_ms:8000,review_after_ms:3500}]);h.player.start();h.advance(8000);
  assert.deepEqual(h.cues.map(c=>c.type),['report-received']);
  h.advance(500);assert.equal(h.cues.at(-1).type,'report-checking');
  h.advance(2950);assert.equal(h.cues.at(-1).type,'report-checking');
  h.advance(50);assert.equal(h.cues.at(-1).type,'report-reviewed');
  assert.equal(h.cues.at(-1).at-h.cues[0].at,3500);h.player.stop();
});

test('pausing the replay freezes review timing and replay restarts the same progression',()=>{
  const h=harness([{key:'saved',at_ms:8000,review_after_ms:3500}]);h.player.start();h.advance(8500);h.player.pause();
  h.jumpClock(60000);assert.equal(h.cues.at(-1).type,'report-checking');
  h.player.resume();h.advance(3000);assert.equal(h.cues.at(-1).type,'report-reviewed');
  h.player.start();h.advance(8000);assert.equal(h.cues.at(-1).type,'report-received');h.player.stop();
});
