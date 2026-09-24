(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AmaraHTTP=api;
})(globalThis,function(){
  function failure(message,status=0,code='request_failed'){
    const error=new Error(message);error.userFacing=true;error.status=status;error.code=code;return error;
  }
  async function json(response,fallback){
    let data;
    try{data=await response.json();}catch(_){throw failure(fallback,response.status);}
    if(!data||typeof data!=='object'||Array.isArray(data))throw failure(fallback,response.status);
    if(!response.ok)throw failure(typeof data.error==='string'?data.error:fallback,response.status,data.code||'request_failed');
    return data;
  }
  function explain(error,fallback){return error?.userFacing?error.message:fallback;}
  return {json,failure,explain};
});
