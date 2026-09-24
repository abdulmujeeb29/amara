(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AmaraPanel=api;
})(globalThis,function(){
  function sync({workspace,panel,toggle,compact,activeElement}){
    const hidden=compact&&workspace.classList.contains('map-only');
    if(hidden&&panel.contains(activeElement))toggle.focus({preventScroll:true});
    panel.inert=hidden;
    if(hidden)panel.setAttribute('aria-hidden','true');else panel.removeAttribute('aria-hidden');
    toggle.setAttribute('aria-expanded',String(!hidden));
    // Prevent browser focus scrolling from displacing the entire map workspace.
    workspace.scrollTop=0;
    return hidden;
  }
  return {sync};
});
