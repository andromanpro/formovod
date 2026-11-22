(() => {
  globalThis.createFormovodDepartment=(actors,getSpeed,onCue,signal)=>{
    const frame=document.createElement('iframe');
    frame.title='Мастерская бригады';frame.tabIndex=-1;
    const url=chrome.runtime.getURL('workshop-frame.html');
    let target=null,port=null,waiting=[];
    function invalidate(){
      const away=[...actors].filter(([,role])=>role.card.dataset.deployed==='true').map(([key])=>key);
      port?.postMessage({visible:Boolean(target),speed:getSpeed(),away});
    }
    frame.addEventListener('load',()=>{
      port?.close();
      const channel=new MessageChannel();
      port=channel.port1;
      port.onmessage=({data})=>onCue(data.name,data.beat,data.count);
      frame.contentWindow.postMessage('formovod-workshop',new URL(url).origin,[channel.port2]);
      invalidate();
      for(const step of waiting)port.postMessage({step});
      waiting=[];
    },{signal});
    frame.src=url;
    const duty=new MutationObserver(invalidate);
    for(const {card} of actors.values())duty.observe(card,{attributes:true,attributeFilter:['data-deployed']});
    function show(slot){
      if(target===slot)return;
      target=slot;
      if(slot && frame.parentNode!==slot){
        // Chromium's state-preserving move keeps the same browsing context, poses and clock.
        if(frame.isConnected && slot.moveBefore)slot.moveBefore(frame,null);
        else slot.append(frame);
      }
      invalidate();
    }
    function next(step=1){if(port)port.postMessage({step});else waiting.push(step)}
    signal.addEventListener('abort',()=>{duty.disconnect();port?.close();frame.remove()},{once:true});
    return {show,next,invalidate};
  };
})();
