const test=require('node:test');
const assert=require('node:assert/strict');
global.window={};
global.AmaraGeo=require('../js/geo.js');
require('../js/evidence.js');
const relevance=window.AmaraEvidence.prototype.relevance;
const route=[[3.37,6.50],[3.37,6.52]];
const view={journey:{route:{geometry:{coordinates:route}}}};
const prefs={muted:false,follow_market_road:false,follow_yaba_area:false};

test('a route-relevant revision keeps route context even after an earlier delivery',()=>{
  const result=relevance.call(view,{coordinates:[3.3701,6.51],has_relevant_evidence:true},prefs,true);
  assert.equal(result.context,'route');
});
test('mute wins over route matching and correction delivery',()=>{
  assert.equal(relevance.call(view,{coordinates:[3.37,6.51]}, {...prefs,muted:true},true),null);
});
test('unrelated reports are not route alerts',()=>{
  assert.equal(relevance.call(view,{coordinates:[3.6,6.7]},prefs),null);
});
test('unlocated area updates are explicit about their uncertain location',()=>{
  const result=relevance.call(view,{coordinates:null,area_scope:'yaba'}, {...prefs,follow_yaba_area:true});
  assert.equal(result.context,'area');assert.match(result.label,/location unknown/);
});
test('a retraction can reach a previously notified visitor without claiming route relevance',()=>{
  const result=relevance.call(view,{coordinates:null,has_relevant_evidence:false},prefs,true);
  assert.equal(result.context,'area');assert.match(result.label,/revised/);
});

test('error recovery does not enable actions that require a missing demo case',()=>{
  const previous=global.document;
  const start={dataset:{evidence:'new_demo'},closest:()=>null};
  const support={dataset:{evidence:'support'},closest:()=>null};
  const submit={dataset:{},closest:()=>({})};
  global.document={querySelectorAll:()=>[start,support,submit]};
  try{
    window.AmaraEvidence.prototype.disableTools.call({hasDemoCase:false},false);
    assert.equal(start.disabled,false);assert.equal(support.disabled,true);assert.equal(submit.disabled,true);
    window.AmaraEvidence.prototype.disableTools.call({hasDemoCase:true},true);
    assert.ok([start,support,submit].every(button=>button.disabled));
    window.AmaraEvidence.prototype.disableTools.call({hasDemoCase:true},false);
    assert.ok([start,support,submit].every(button=>!button.disabled));
  }finally{global.document=previous;}
});

test('a missing or inaccessible job stops polling and permits a fresh check',async()=>{
  const previousDocument=global.document,previousFetch=global.fetch;
  global.document={hidden:false};global.fetch=async()=>({status:404,ok:false});
  const state={job:'missing-job',suspended:()=>false,clearJobLink(id){this.cleared=id;},setProgress(text){this.progress=text;},disableTools(disabled){this.disabled=disabled;},renderResult(){}};
  try{
    await window.AmaraEvidence.prototype.pollJob.call(state);
    assert.equal(state.job,null);assert.equal(state.result.error_code,'job_unavailable');
    assert.equal(state.disabled,false);assert.equal(state.jobTimer,undefined);assert.equal(state.cleared,'missing-job');
  }finally{clearTimeout(state.jobTimer);global.document=previousDocument;global.fetch=previousFetch;}
});

test('saved replay suppresses live feed polling, job polling, and new AI jobs',async()=>{
  const oldDocument=global.document,oldFetch=global.fetch;
  let requests=0;global.document={hidden:false};global.fetch=async()=>{requests++;throw new Error('No live requests allowed');};
  const state={job:'existing-job',suspended:()=>true,notify:()=>{}};
  try{
    await window.AmaraEvidence.prototype.refresh.call(state);
    await window.AmaraEvidence.prototype.pollJob.call(state);
    await window.AmaraEvidence.prototype.createJob.call(state,{action:'new_demo'});
    assert.equal(requests,0);
  }finally{global.document=oldDocument;global.fetch=oldFetch;}
});
