/* Test-only browser geolocation provider. Never included in built app assets. */
(() => {
  let nextId=0;
  const watchers=new Map();
  let fix={coords:{longitude:3.374,latitude:6.5094,accuracy:18},timestamp:Date.now()};
  const cleared=[];
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
    getCurrentPosition(success){setTimeout(()=>success({...fix,timestamp:Date.now()}),0);},
    watchPosition(success,error){const id=nextId++;watchers.set(id,{success,error});setTimeout(()=>{if(watchers.has(id))success({...fix,timestamp:Date.now()});},0);return id;},
    clearWatch(id){cleared.push(id);watchers.delete(id);},
  }});
  window.amaraTestGPS={
    push(longitude,latitude,accuracy=18,age=0){fix={coords:{longitude,latitude,accuracy},timestamp:Date.now()-age};for(const watcher of [...watchers.values()])watcher.success(fix);},
    fail(code){for(const watcher of [...watchers.values()])watcher.error({code});},
    count(){return watchers.size;},
    cleared,
  };
})();
