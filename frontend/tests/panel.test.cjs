const test=require('node:test');
const assert=require('node:assert/strict');
const {sync}=require('../js/panel.js');

function fixture(mapOnly,compact,focusedInside=false){
  const attributes={},toggleAttributes={};
  const panel={contains:()=>focusedInside,setAttribute:(k,v)=>attributes[k]=v,removeAttribute:k=>delete attributes[k]};
  const toggle={setAttribute:(k,v)=>toggleAttributes[k]=v,focus:options=>{toggle.focused=options;}};
  const workspace={classList:{contains:()=>mapOnly},scrollTop:464};
  return {panel,toggle,workspace,compact,activeElement:{},attributes,toggleAttributes};
}
test('a hidden mobile panel is inert and cannot retain keyboard focus',()=>{
  const f=fixture(true,true,true);sync(f);
  assert.equal(f.panel.inert,true);assert.equal(f.attributes['aria-hidden'],'true');
  assert.equal(f.toggleAttributes['aria-expanded'],'false');assert.deepEqual(f.toggle.focused,{preventScroll:true});
  assert.equal(f.workspace.scrollTop,0);
});
test('returning to the briefing restores its accessibility and clears invalid map scrolling',()=>{
  const f=fixture(true,true);sync(f);f.workspace.classList.contains=()=>false;sync(f);
  assert.equal(f.panel.inert,false);assert.equal(f.attributes['aria-hidden'],undefined);
  assert.equal(f.toggleAttributes['aria-expanded'],'true');assert.equal(f.workspace.scrollTop,0);
});
test('desktop panels remain usable even if a map-only class is present',()=>{
  const f=fixture(true,false);sync(f);assert.equal(f.panel.inert,false);assert.equal(f.toggle.focused,undefined);
});
