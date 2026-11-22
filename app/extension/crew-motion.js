(() => {
  // Transform-only Web Animations keep the already-authorized walk and anticipation
  // moving on Chromium's compositor while the ERP tab is processing an input event.
  function element(parent, css) {
    const node = document.createElement('div');
    node.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;' + css;
    parent.append(node);
    return node;
  }
  const transform = (x,y) => `translate3d(${x}px,${y}px,0)`;
  const distance = (a,b) => Math.hypot(b.x-a.x,b.y-a.y);
  function sprite(parent, image, fw, fh, cols, rows, fx, fy) {
    const mover=element(parent,'will-change:transform');
    const facing=element(mover,'transform-origin:0 0;will-change:transform');
    const body=element(facing,'transform-origin:0 0;will-change:transform');
    const clip=element(body,`left:${-fx}px;top:${-fy}px;width:${fw}px;height:${fh}px;overflow:hidden`);
    const atlas=element(clip,`width:${fw*cols}px;height:${fh*rows}px;background:url("${image}") 0 0/100% 100% no-repeat;will-change:transform`);
    function cycle(frames,ms) {
      return atlas.animate(frames.map((index,i)=>({
        offset:i/(frames.length-1),easing:'steps(1,end)',transform:transform(-(index%cols)*fw,-Math.floor(index/cols)*fh)
      })),{duration:ms,iterations:Infinity});
    }
    return {mover,facing,body,clip,atlas,cycle};
  }
  function setRate(track,rate) {
    if(track.rate===rate)return;
    track.rate=rate;
    for(const a of track.animations)a.playbackRate=rate;
    for(const a of track.breakPose?.animations ?? [])
      a.playbackRate=track.breakPose.fades.includes(a)?Number(rate>0):rate;
  }
  function clearBreak(track) {
    const rest=track?.breakPose;
    if(!rest)return;
    for(const a of rest.animations)a.cancel();
    rest.rig.remove();
    track.breakPose=null;
  }
  function dispose(map,key) {
    const track=map.get(key);if(!track)return;
    clearBreak(track);
    track.animations.forEach(a=>a.cancel());track.mover.remove();map.delete(key);
  }
  globalThis.createFormovodMotion=(parent,asset,signal)=>{
    const walks=new Map(),holds=new Map(),row={price:0,quote:1,check:2};
    function reset(){
      for(const key of walks.keys())dispose(walks,key);
      for(const key of holds.keys())dispose(holds,key);
    }
    signal.addEventListener('abort',reset,{once:true});
    // Sample the very same timeline as the compositor before acknowledging arrival.
    function position(role,track) {
      const elapsed=Math.max(0,Number(track.animations[0].currentTime)||0);
      const t=Math.min(1,elapsed/track.duration)*track.length;
      let i=1;
      while(i<track.path.length-1 && track.path[i].at<t)i++;
      const a=track.path[i-1],b=track.path[i],p=(t-a.at)/(b.at-a.at);
      role.x=a.x+(b.x-a.x)*p;role.y=a.y+(b.y-a.y)*p;
      if(Math.abs(b.x-a.x)>1)role.facingRight=b.x>a.x;
      return t>=track.length-.01;
    }
    function move(role,goal,rail,direction,rate,unit) {
      let track=walks.get(role.key);
      const settle=4;
      if(track){
        const done=position(role,track);
        if(done || track.direction!==direction || distance(track.end,goal)>settle || track.unit!==unit) {
          dispose(walks,role.key);track=null;
        }
      }
      if(!track){
        const begin={x:role.x,y:role.y,at:0};
        if(distance(begin,goal)<=settle){role.x=goal.x;role.y=goal.y;return false}
        const path=[begin];
        const via=role.direction===direction?[]:[{x:rail,y:begin.y},{x:rail,y:goal.y}];
        for(const pt of [...via,goal]){
          const prev=path.at(-1),len=distance(prev,pt);
          if(len>.01)path.push({x:pt.x,y:pt.y,at:prev.at+len});
        }
        role.direction=direction;
        const length=path.at(-1).at,duration=Math.max(160,length/.5);
        const s=sprite(parent,asset('walk-cycle'),104*unit,120*unit,16,3,52*unit,112*unit);
        const travel=s.mover.animate(path.map(pt=>({transform:transform(pt.x,pt.y),offset:pt.at/length})),
          {duration,fill:'forwards',easing:'linear'});
        let right=!!role.facingRight;
        const turns=path.map((pt,i)=>{
          const dx=(path[i+1]?.x??pt.x)-pt.x;
          if(Math.abs(dx)>1)right=dx>0;
          return {transform:'scaleX('+(right?-1:1)+')',offset:pt.at/length,easing:'steps(1,end)'};
        });
        const face=s.facing.animate(turns,{duration,fill:'forwards'});
        const start=row[role.key]*16;
        // Bound the feet to the same trip as the mover, including when the page
        // cannot run another animation frame to acknowledge arrival.
        const strideMs=2*Math.PI*23*duration/length;
        const gait=s.cycle(Array.from({length:17},(_,i)=>start+i%16),strideMs);
        gait.effect.updateTiming({iterations:duration/strideMs,fill:'forwards'});
        const scale=unit*.16,[fx,fy]=role.feet[0];
        const idle=element(s.body,`left:${-fx*scale}px;top:${-fy*scale}px;width:${543*scale}px;height:${724*scale}px;`+
          `background:url("${role.image.src}") 0 0/400% 100% no-repeat;opacity:0`);
        const landing={duration,fill:'forwards',easing:'steps(1,end)'};
        const stopFeet=s.clip.animate([{opacity:1},{opacity:0}],landing);
        const plantFeet=idle.animate([{opacity:0},{opacity:1}],landing);
        track={mover:s.mover,animations:[travel,face,gait,stopFeet,plantFeet],end:{x:goal.x,y:goal.y},unit,length,duration,path,direction};
        walks.set(role.key,track);
      }
      setRate(track,rate);
      return true;
    }
    function place(track,x,y,flip,rate) {
      const location=transform(x,y),face=flip?'scaleX(-1)':'scaleX(1)';
      if(track.location!==location){track.location=location;track.mover.style.transform=location}
      if(track.face!==face){track.face=face;track.facing.style.transform=face}
      track.seen=true;setRate(track,rate);return true;
    }
    function shiftWeight(body,amount,ms){
      return body.animate([
        {transform:'translate3d(0,0,0) rotate(0deg)'},
        {transform:`translate3d(${amount*.4}px,${amount*.5}px,0) rotate(${amount}deg)`},
        {transform:'translate3d(0,0,0) rotate(0deg)'}
      ],{duration:ms,iterations:Infinity,easing:'ease-in-out'});
    }
    function breathe(body,ms){
      // The sprite origin is the sole. Both boots stay on that baseline.
      return body.animate([{transform:'none'},{transform:'skewX(.9deg) scaleY(.986)'},{transform:'none'}],
        {duration:ms,iterations:Infinity,easing:'ease-in-out'});
    }
    function hold(key,goal,size,rate,progress){
      let track=holds.get(key);
      if(track && (track.kind!=='hammer' || track.size!==size)){dispose(holds,key);track=null}
      if(!track){
        const u=size/176,s=sprite(parent,asset(key==='quote'?'impact-violet':'impact-amber'),228*u,224*u,7,7,51*u,209*u);
        const riseTime=365;
        const rise=s.atlas.animate(Array.from({length:13},(_,i)=>({
          offset:1-Math.sqrt(1-i/12),transform:transform(-(i%7)*228*u,-Math.floor(i/7)*224*u),
          easing:'steps(1,end)'
        })),{duration:riseTime});
        // Small load shift after the lift. Neither animation contains a strike.
        const tension=s.cycle([12,11,10,9,8,9,10,11,12],760);
        tension.effect.updateTiming({delay:riseTime});
        rise.currentTime=tension.currentTime=Math.min(riseTime,progress*420);
        track={...s,kind:'hammer',animations:[rise,tension,shiftWeight(s.body,2.2,920)],size};holds.set(key,track);
      }
      return place(track,goal.hitX,goal.hitY,goal.flip,rate);
    }
    function stance(role,goal,frame,unit,rate){
      const key=role.key;
      let track=holds.get(key);
      if(track && (track.kind!=='stance' || track.frame!==frame || track.unit!==unit)){
        dispose(holds,key);track=null;
      }
      if(!track){
        const [fx,fy]=role.feet[frame];
        const s=sprite(parent,role.image.src,543*unit,724*unit,4,1,fx*unit,fy*unit);
        s.atlas.style.transform=transform(-543*unit*frame,0);
        track={...s,kind:'stance',frame,unit,animations:[breathe(s.body,2100)]};
        holds.set(key,track);
      }
      return place(track,goal.x,goal.y,goal.faceRight,rate);
    }
    // Arm the change of pose on the compositor. Even a synchronous 1C handler
    // can then occupy the JS thread without freezing the worker beside the field.
    function smoking(role,goal,size,enabled) {
      const track=holds.get(role.key);
      if(!enabled || !track?.seen){clearBreak(track);return false}
      let rest=track.breakPose;
      if(!rest){
        const rig=element(track.mover,'transform-origin:0 0;opacity:0');
        const body=element(rig,'transform-origin:0 0');
        const sheet=asset(role.key==='quote'?'impact-violet':'impact-amber');
        element(body,`left:-144px;top:-209px;width:228px;height:224px;background:url("${sheet}") 0 0 no-repeat`);
        // Frame zero is the relaxed two-handed grip. Positions below are in
        // the atlas coordinate system, relative to the midpoint of the boots.
        const cigarette=element(body,'left:-58px;top:-136px;width:35px;height:5px;border-radius:3px;'+
          'background:linear-gradient(90deg,#776960 0 9%,#fff5dd 14% 73%,#be8d53 75%);'+
          'box-shadow:0 1px 2px #342823;transform-origin:right center;transform:rotate(-9deg)');
        const ember=element(cigarette,'width:6px;height:6px;border-radius:50%;background:#ff702e;box-shadow:0 0 6px 2px #ffad52');
        const delay=2800;
        const fade={delay,duration:180,fill:'both',easing:'ease-out'};
        const reveal=rig.animate([{opacity:0},{opacity:1}],fade);
        const fades=[reveal,track.body.animate([{opacity:1},{opacity:0}],fade)];
        const animations=[...fades,
          breathe(body,2300),
          ember.animate([{opacity:.45},{opacity:1,offset:.24},{opacity:.48,offset:.45},{opacity:.45}],
            {duration:2900,iterations:Infinity})];
        // Two joined arcs give each wisp a bend. Pale centres and cool edges
        // stay legible on both white tables and the dark dock.
        for(let i=0;i<3;i++){
          const wisp=element(body,'left:-63px;top:-146px;width:16px;height:23px;'+
            'border-left:4px solid #85948f;border-radius:65%;filter:drop-shadow(2px 0 1.4px #fff)');
          element(wisp,'left:2px;top:-17px;width:13px;height:20px;border-right:3px solid #94a19c;border-radius:60%');
          animations.push(wisp.animate([
            {transform:'translate(0,8px) scale(.45)',opacity:0},
            {transform:'translate(-6px,-7px) scale(.85)',opacity:.96,offset:.19},
            {transform:'translate(1px,-38px) scale(1.32) rotate(16deg)',opacity:.76,offset:.56},
            {transform:'translate(-17px,-80px) scale(1.8) rotate(-21deg)',opacity:0}
          ],{duration:2200,delay:-i*730,iterations:Infinity,easing:'linear'}));
        }
        for(const a of animations)a.playbackRate=fades.includes(a)?Number(track.rate>0):track.rate;
        rest=track.breakPose={rig,animations,fades,reveal,delay};
      }
      const glyph=goal.mark?.glyphAt;
      if(rest.actionId!==role.actionId || rest.glyph!==glyph){
        for(const a of rest.fades)a.currentTime=0;
        rest.actionId=role.actionId;rest.glyph=glyph;
      }
      const scale=size/176;
      const dx=track.kind==='hammer'?goal.x-goal.hitX:0;
      const dy=track.kind==='hammer'?goal.y-goal.hitY:0;
      const transformCSS=transform(dx,dy)+' scale('+(goal.faceRight?-scale:scale)+','+scale+')';
      if(rest.position!==transformCSS){rest.rig.style.transform=transformCSS;rest.position=transformCSS}
      return rest.reveal.currentTime>=rest.delay;
    }
    return {move,hold,stance,smoking,reset,
      begin(){for(const track of holds.values())track.seen=false},
      end(){for(const [key,track] of holds)if(!track.seen)dispose(holds,key)}
    };
  };
})();
