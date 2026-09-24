const test = require('node:test');
const assert = require('node:assert/strict');
const Geo = require('../js/geo.js');
const Tracker = require('../js/location.js');

const route = [[3.37,6.50],[3.37,6.51],[3.38,6.51]];
test('route projection distinguishes progress, backward movement, and off-route points', () => {
  const start=Geo.project([3.37,6.502],route), later=Geo.project([3.375,6.51],route), off=Geo.project([3.365,6.505],route);
  assert.ok(later.along>start.along);
  assert.ok(start.distance<1 && later.distance<1);
  assert.ok(off.distance>500);
  assert.ok(Geo.project([3.37,6.507],route).along < later.along-25);
});
test('only reports in the route corridor are selected', () => {
  const hits=Geo.relevant([{id:'near',coordinates:[3.3701,6.505]},{id:'far',coordinates:[3.4,6.54]},{id:'unknown',coordinates:null}],route);
  assert.deepEqual(hits.map(item=>item.id),['near']);
});
test('simulation follows distance rather than geometry-point count', () => {
  const line=[[0,0],[0,.001],[0,.01]];
  const mid=Geo.pointAlong(line,.5);
  assert.ok(Math.abs(mid[1]-.005)<.00001);
});
test('accuracy circle uses metres and closes its ring', () => {
  const center=[3.37,6.51], shape=Geo.circle(center,80).features[0].geometry.coordinates[0];
  assert.ok(Math.abs(Geo.distance(center,shape[0])-80)<.01);
  assert.ok(Geo.distance(shape[0],shape.at(-1))<.01);
});

function harness() {
  let now=100000, success, failure, timer;
  const cleared=[], events=[];
  const provider={watchPosition(ok,bad){success=ok;failure=bad;return 0;},clearWatch(id){cleared.push(id);}};
  const tracker=new Tracker({secure:true,geolocation:provider,now:()=>now,setInterval:callback=>{timer=callback;return 1;},clearInterval:()=>{timer=null;},onChange:state=>events.push(state)});
  return {tracker,provider,cleared,events,get success(){return success;},get failure(){return failure;},get timer(){return timer;},advance(ms){now+=ms;},fix(accuracy=15,timestamp=now){success({coords:{longitude:3.37,latitude:6.51,accuracy},timestamp});}};
}
test('live fixes include accuracy; stale fixes stop precise route claims', () => {
  const h=harness();h.tracker.start();h.fix();assert.equal(h.tracker.snapshot().fresh,true);
  h.advance(31000);h.tracker.refresh();assert.equal(h.tracker.snapshot().status,'stale');assert.equal(h.tracker.snapshot().fresh,false);
  h.fix(800);assert.equal(h.tracker.snapshot().status,'approximate');assert.equal(h.tracker.snapshot().fresh,false);h.tracker.stop();
});
test('end clears watch ID zero and rejects delayed callbacks', () => {
  const h=harness();h.tracker.start();h.fix();const delayed=h.success;h.tracker.stop();
  assert.deepEqual(h.cleared,[0]);assert.equal(h.timer,null);assert.equal(h.tracker.snapshot().sample,null);
  delayed({coords:{longitude:3.4,latitude:6.5,accuracy:10},timestamp:100000});assert.equal(h.tracker.snapshot().status,'ended');assert.equal(h.tracker.snapshot().sample,null);
});
test('pause clears tracking and resume requires an explicit start', () => {
  const h=harness();h.tracker.start();h.fix();h.tracker.pause();
  assert.equal(h.tracker.snapshot().status,'paused');assert.equal(h.tracker.snapshot().watching,false);assert.equal(h.tracker.snapshot().fresh,false);
  h.tracker.start();h.fix();assert.equal(h.tracker.snapshot().fresh,true);h.tracker.stop();
});
test('denial and synchronous denial cannot leave a watch running', () => {
  const h=harness();h.tracker.start();h.failure({code:1});assert.equal(h.tracker.snapshot().status,'denied');assert.equal(h.timer,null);
  h.provider.watchPosition=(ok,bad)=>{bad({code:1});return 0;};h.tracker.start();assert.equal(h.tracker.watchId,null);assert.equal(h.tracker.status,'denied');
});
test('timeout can recover; invalid coordinates never become current position', () => {
  const h=harness();h.tracker.start();h.failure({code:3});assert.equal(h.tracker.status,'timeout');h.fix();assert.equal(h.tracker.snapshot().fresh,true);
  h.success({coords:{longitude:NaN,latitude:6.5,accuracy:10},timestamp:100000});assert.equal(h.tracker.status,'unavailable');assert.equal(h.tracker.snapshot().fresh,false);h.tracker.stop();
});
test('unsupported or throwing geolocation remains a controlled state', () => {
  const h=harness();h.tracker.secure=false;h.tracker.start();assert.equal(h.tracker.status,'unsupported');
  h.tracker.secure=true;h.provider.watchPosition=()=>{throw new Error('blocked');};h.tracker.start();assert.equal(h.tracker.status,'unavailable');assert.equal(h.tracker.watchId,null);
});
