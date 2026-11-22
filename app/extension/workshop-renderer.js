(() => {
  const W=960,H=540;
  const scenes=[
    {name:'Проверка звонка', role:'quote', end:6.9,
      cues:[[0,'Оркестратор подаёт сигнал.'],[1.65,'Воркер выбирает кувалду.'],[2.94,'Звонок выдержал. Оркестратор тоже.']]},
    {name:'Приёмка сушки', role:'check', end:7.7,
      cues:[[0,'Первая деталь проходит контроль.'],[2.3,'На проверку подают второй образец.'],[4.65,'У этой шестерни вместо зубьев мак.']]},
    {name:'Перерыв на один глоток', role:'price', end:7.5,
      cues:[[0,'Кружка стоит на краю тележки.'],[2.4,'До первого глотка остаётся секунда.'],[3.78,'Вызов. Кружку придётся вернуть.']]},
    {name:'План на одну страницу', role:null, end:7.8,
      cues:[[0,'Архитектор разворачивает план.'],[2.45,'Оркестратор готов дать отмашку.'],[4.02,'У страницы нашлось продолжение.']]},
  ];
  const clamp=t=>Math.max(0,Math.min(1,t));
  function ease(a,b,t){const p=clamp((t-a)/(b-a));return p*p*(3-2*p)}
  // Monotone Hermite: carry velocity through a gesture; settle only at holds and reversals.
  function pose(t,keys){
    function tangent(i){
      if(i===0 || i===keys.length-1)return 0;
      const [x,v]=keys[i],a=x-keys[i-1][0],b=keys[i+1][0]-x;
      const prev=(v-keys[i-1][1])/a,next=(keys[i+1][1]-v)/b;
      return prev*next<=0?0:3*(a+b)/((2*b+a)/prev+(b+2*a)/next);
    }
    for(let i=1;i<keys.length;i++){
      const [b,to]=keys[i];
      if(t<=b){
        const [a,from]=keys[i-1],span=b-a,u=clamp((t-a)/span),v=1-u;
        return v*v*(1+2*u)*from+u*u*(3-2*u)*to+span*u*v*(v*tangent(i-1)-u*tangent(i));
      }
    }
    return keys.at(-1)[1];
  }
  const foremanCall=[[0,0],[.45,0],[1.10,1],[1.32,2],[1.63,1],[1.83,2],[2.3,1],[2.90,1],[3.19,3],[4.9,3],[5.55,2],[6.5,0]];
  const hammerArc=[[0,0],[.8,0],[1.64,7],[2.16,12],[2.53,12],[2.70,16],[2.82,25],[2.94,40],[3.05,40],[3.47,44],[6.9,44]];
  const liftCup=[[0,0],[.52,0],[1.2,1],[1.65,2],[2.16,3],[2.75,4],[3.1,5],[3.52,6],[3.78,6],
    [4.03,7],[4.65,7],[5.05,6],[5.42,5],[5.84,4],[6.12,3],[6.46,2],[6.77,1],[7.2,0]];
  // Centre of the enamel rim in each registered 288 × 384 cel.
  const cupRim=[[47,217],[47,217],[47,214],[49,192],[64,155],[85,127],[97,108],[97,108]];
  const paper=[[0,0],[.55,0],[1.82,1],[2.28,1],[3.31,2],[3.72,2],[4.10,3],[6.55,3],[7.45,2.68]];
  const examine=[[0,0],[.32,0],[1.38,1.7],[1.78,2],[2.18,2],[2.89,1.15],
    [4.05,1],[4.88,2],[5.25,2],[5.67,3],[6.65,3],[7.48,2.62]];
  const lensCenters=[[80.7,137.4],[75.8,148.2],[73.7,145.1],[86.6,141.1]];
  const propRects=[[6,2,310,314],[326,77,314,239],[696,2,217,314],[4,324,314,314],[330,324,306,314],[648,374,314,264]];
  // Each take has its own camera blocking: reveal the contact, then give the reacting actor room.
  const cameras=[
    {x:[[0,465],[1.4,474],[2.86,525],[3.18,527],[4.58,394],[6.9,387]],y:[[0,298],[2.9,333],[3.2,333],[4.7,304]],z:[[0,1.08],[1.45,1.16],[2.85,1.49],[3.25,1.49],[4.75,1.34],[6.9,1.30]]},
    {x:[[0,467],[1.55,503],[4.8,521],[6.35,537],[7.7,535]],y:[[0,312],[2.2,317],[5.2,316],[6.6,306]],z:[[0,1.15],[2.1,1.38],[4.95,1.58],[6.65,1.43]]},
    {x:[[0,489],[2.8,532],[3.72,539],[4.48,506],[6.93,485]],y:[[0,319],[3.55,301],[4.59,298],[7.3,318]],z:[[0,1.16],[2.75,1.39],[3.67,1.47],[4.35,1.40],[7.2,1.17]]},
    {x:[[0,462],[2.5,486],[3.9,514],[5.35,512],[7.8,472]],y:[[0,298],[3.65,291],[4.95,324],[7.8,321]],z:[[0,1.13],[3.65,1.43],[4.8,1.27],[7.8,1.16]]},
  ];

  // Both views show the same take. Only the visible canvas owns the clock.
  function createWorkshop(asset,away,getSpeed,onCue){
    const images=new Map(),blends=new Map();
    const textureNames=['workshop-room.webp','workshop-props.webp','workshop-architect.webp',
      'workshop-chief.webp','workshop-tea.webp','workshop-inspector.webp','workshop-recovery.webp','impact-violet'];
    let canvas=null,ctx=null,loaded=null,ready=false,failed=false;
    let index=0,t=0,tick=0,last=null,nextDraw=0,mix=1,lastCue='',dirty=true;

    function awake(){if(canvas&&!tick)tick=requestAnimationFrame(frame)}
    function invalidate(){dirty=true;awake()}
    function load(){
      if(loaded)return;
      loaded=Promise.all(textureNames.map(async key=>{
        const im=new Image();im.src=asset(key);await im.decode();
        // Keep the expanded texture available across cuts, including the first frame
        // of the large tea atlas. Deferred WebP rasterisation otherwise shows up at the cut.
        images.set(key,await createImageBitmap(im));
      })).then(()=>{ready=true;invalidate()}).catch(()=>{failed=true;invalidate()});
    }
    function available(i){return !away.has(scenes[i].role)}
    function nextAvailable(direction){
      for(let i=1;i<=scenes.length;i++){
        const n=(index+direction*i+scenes.length*2)%scenes.length;
        if(available(n))return n;
      }
      return index;
    }
    function change(n,dissolve){
      mix=dissolve && ready && getSpeed()>0 ? 0 : 1;
      index=n;t=0;lastCue='';invalidate();
    }
    function cue(){
      const s=scenes[index];
      const line=failed?'Не удалось загрузить рисунки мастерской.':ready?s.cues.filter(c=>c[0]<=t).at(-1)[1]:'Загружаю мастерскую…';
      const count=scenes.filter((_,i)=>available(i)).length,key=index+'|'+line+'|'+count;
      if(lastCue!==key){lastCue=key;onCue(s.name,line,count)}
    }
    function shadow(x,y,rx,ry,opacity=.34){
      ctx.save();ctx.translate(x,y);ctx.scale(rx,ry);
      const fill=ctx.createRadialGradient(0,0,0,0,0,1);fill.addColorStop(0,'rgba(41,28,16,'+opacity+')');fill.addColorStop(1,'rgba(41,28,16,0)');
      ctx.fillStyle=fill;ctx.fillRect(-1,-1,2,2);ctx.restore();
    }
    function light(x,y,r,strength){
      if(strength<=.001)return;
      ctx.save();ctx.globalAlpha=strength;ctx.globalCompositeOperation='screen';
      const g=ctx.createRadialGradient(x,y,1,x,y,r);g.addColorStop(0,'#ffda78');g.addColorStop(.34,'#fa982d99');g.addColorStop(1,'#f28d2100');
      ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);ctx.restore();
    }
    function prop(n,x,base,w,h=null){
      const [sx,sy,sw,sh]=propRects[n];const height=h??w*sh/sw;
      ctx.drawImage(images.get('workshop-props.webp'),sx,sy,sw,sh,x-w/2,base-height,w,height);
    }
    function trolley(x,surface,w,h){
      const bottom=surface+h*.90;
      shadow(x-3,bottom,w*.52,6,.38);
      prop(1,x,bottom,w,h);
    }
    function sample(key,frame,w,h,cols,gutter,x,y,dw,dh){
      const img=images.get(key),start=Math.floor(frame),fraction=frame-start;
      const sx=i=>(i%cols)*(w+2*gutter)+gutter,sy=i=>Math.floor(i/cols)*(h+2*gutter)+gutter;
      if(fraction<.02){ctx.drawImage(img,sx(start),sy(start),w,h,x,y,dw,dh);return}
      if(fraction>.98){ctx.drawImage(img,sx(start+1),sy(start+1),w,h,x,y,dw,dh);return}
      let layer=blends.get(key);
      if(!layer){
        const c=document.createElement('canvas');c.width=w;c.height=h;
        layer={canvas:c,g:c.getContext('2d')};blends.set(key,layer);
      }
      // Add weighted premultiplied colours on a separate transparent sheet. A normal
      // source-over fade between the two bodies would make their moving edges translucent.
      const g=layer.g;g.clearRect(0,0,w,h);g.globalCompositeOperation='source-over';g.globalAlpha=1-fraction;
      g.drawImage(img,sx(start),sy(start),w,h,0,0,w,h);
      g.globalCompositeOperation='lighter';g.globalAlpha=fraction;
      g.drawImage(img,sx(start+1),sy(start+1),w,h,0,0,w,h);
      ctx.drawImage(layer.canvas,x,y,dw,dh);
    }
    function cel(key,value,x,y,height){
      const tea=key==='tea',inspector=key==='inspector',w=inspector?340:288,h=tea?384:352,cols=tea?10:8;
      const scale=height/(tea?349.5:334);
      const ax=tea?166.5:inspector?214:144,ay=tea?361.5:344;
      // Scale from the registered sole. Neither a moving hand nor the width of paper shifts the boots.
      sample('workshop-'+key+'.webp',value*12,w,h,cols,1,x-ax*scale,y-ay*scale,w*scale,h*scale);
    }
    function chief(x,y,h,phase){
      shadow(x,y,h*.31,5);
      ctx.save();ctx.translate(x,y);ctx.transform(1,0,.009*Math.sin(2.15*t+.4),1,0,0);
      cel('chief',phase,0,0,h);ctx.restore();
    }
    function bellShot(){
      chief(289,416,205,pose(t,foremanCall));
      const hit=2.94,d=t-hit,ring=d>0?Math.exp(-d*3.4)*Math.sin(d*37):0;
      const x=558,y=410;
      shadow(x+86,y,58,5,.45);shadow(x,y+51,34,4,.42);
      ctx.save();ctx.translate(x,y+52);ctx.rotate(ring*.064);prop(0,0,0,54,54.6-2.3*ring);ctx.restore();
      const s=212/176;
      ctx.save();ctx.translate(x,y);
      ctx.scale(1,1+.006*Math.sin((t-3.47)*3)*ease(3.47,3.9,t));
      if(t<3.47){
        const i=pose(t,hammerArc);
        sample('impact-violet',i,228,224,7,0,-51*s,-209*s,228*s,224*s);
      }else{
        const lift=pose(t,[[3.47,0],[3.83,.12],[4.63,1.45],[5.32,2],[6.9,2]]);
        sample('workshop-recovery.webp',12*lift,228,224,8,1,-51*s,-209*s,228*s,224*s);
      }
      ctx.restore();
      if(d>0&&d<.7)light(x,y+3,15,(1-d/.7)*.40);
    }
    function conveyor(travel){
      const rail=544-travel,surface=333;
      trolley(507,surface+10,245,105);
      // The comparison samples ride a leather belt. The workbench stays planted.
      ctx.save();ctx.lineCap='round';
      for(const [w,col] of [[12,'#5a4934'],[8,'#a98b5e'],[5,'#463e32']]){
        ctx.lineWidth=w;ctx.strokeStyle=col;ctx.beginPath();ctx.moveTo(405,surface+5);ctx.lineTo(609,surface+5);ctx.stroke();
      }
      for(const x of [405,609]){
        ctx.save();ctx.translate(x,surface+5);ctx.rotate(-travel/5);
        ctx.fillStyle='#be9c64';ctx.beginPath();ctx.arc(0,0,4.6,0,2*Math.PI);ctx.fill();
        ctx.strokeStyle='#61523b';ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(-3.2,0);ctx.lineTo(3.2,0);ctx.stroke();ctx.restore();
      }
      ctx.lineWidth=1;ctx.strokeStyle='#c9b48e';
      for(let x=416-travel%12;x<601;x+=12){ctx.beginPath();ctx.moveTo(x,surface+2);ctx.lineTo(x+3,surface+2);ctx.stroke()}
      ctx.restore();
      const roll=Math.sin(Math.max(0,t-4.15)*11)*Math.exp(-Math.max(0,t-4.15)*5)*ease(4.15,4.25,t);
      for(const [kind,dx,w] of [[4,-41,58],[3,43,57]]){
        shadow(rail+dx,surface,w*.42,2.3,.46);
        ctx.save();ctx.translate(rail+dx,surface);ctx.rotate(kind===3?roll*.07:0);
        prop(kind,0,0,w);ctx.restore();
      }
    }
    function inspectionShot(){
      const travel=84*ease(2.3,4.28,t);
      conveyor(travel);
      const action=pose(t,examine),k=Math.min(2,Math.floor(action)),f=action-k;
      const ax=590,feet=435,height=218,s=height/334;
      const lensX=ax+(lensCenters[k][0]*(1-f)+lensCenters[k+1][0]*f-214)*s;
      const lensY=feet+(lensCenters[k][1]*(1-f)+lensCenters[k+1][1]*f-344)*s;
      const radius=50.8*s;
      // Repaint the same moving objects through the lens. Reading the display canvas back
      // into itself forced Chromium to copy the rendered frame on every inspection tick.
      const magnification=1.42+.44*ease(3.9,5.18,t);
      ctx.save();ctx.beginPath();ctx.ellipse(lensX,lensY,radius,radius*1.055,0,0,Math.PI*2);ctx.clip();
      ctx.translate(lensX,lensY);ctx.scale(magnification,magnification*1.055);ctx.translate(-lensX,-lensY);
      ctx.drawImage(images.get('workshop-room.webp'),0,0,W,H);conveyor(travel);
      ctx.restore();
      shadow(ax,feet,53,4,.45);
      cel('inspector',action,ax,feet,height);
      chief(286,410,177,pose(t,[[0,0],[2.7,0],[4.5,.94],[5.0,1],[5.55,1.6],[6.2,.9],[7.4,0]]));
    }
    function teaShot(){
      const x=589,y=431,h=258,scale=h/466;
      const surface=y+(321-482)*scale,cupX=x+(64-222)*scale;
      trolley(cupX-57,surface,178,105);
      const call=ease(3.68,3.79,t)*(1-ease(5.65,6.18,t));
      prop(2,cupX-113,surface,36,52);
      light(cupX-113,surface-31,55,call*(.56+.25*Math.cos((t-3.78)*8)));
      chief(273,413,189,pose(t,[[0,0],[2.8,0],[3.5,1],[3.77,2],[4.22,1],[4.52,2],[5.1,1],[6.0,0]]));
      shadow(x,y,53,5,.46);
      cel('tea',pose(t,liftCup),x,y,h);
      // Each wisp leaves the cup at its earlier position; it trails a rising or falling hand.
      const unit=h/349.5;
      function vaporPoint(age,plume){
        const phase=pose(Math.max(0,t-age),liftCup),i=Math.min(6,Math.floor(phase)),u=phase-i;
        const rimX=cupRim[i][0]*(1-u)+cupRim[i+1][0]*u,rimY=cupRim[i][1]*(1-u)+cupRim[i+1][1]*u;
        return [x+(rimX-166.5)*unit-2-age*9+age*5*Math.sin(4*t-8*age+plume),
          y+(rimY-361.5)*unit-1-age*39];
      }
      ctx.save();ctx.lineCap='round';
      for(let plume=0;plume<3;plume++){
        const age=(t*.82+plume/3)%1,alpha=Math.sin(Math.PI*age)*.32;
        const a=vaporPoint(age*.76,plume),b=vaporPoint(age*.76+.10,plume),c=vaporPoint(age*.76+.21,plume);
        ctx.beginPath();ctx.moveTo(...a);ctx.quadraticCurveTo(...b,...c);
        ctx.lineWidth=3.4;ctx.strokeStyle='rgba(253,237,207,'+alpha*.40+')';ctx.stroke();
        ctx.lineWidth=1.3;ctx.strokeStyle='rgba(255,246,224,'+alpha+')';ctx.stroke();
      }
      ctx.restore();
    }
    function planShot(){
      chief(328,427,205,pose(t,[[0,0],[2.0,0],[3.0,1],[3.73,1.35],[4.13,1.6],[5.25,1.55],[6.28,0]]));
      shadow(575,438,51,5,.40);
      if(t<4.1 || t>=6.55){
        cel('architect',pose(t,paper),575,438,259);
      }else{
        // The hands stop first. The lower accordion folds keep travelling after the last fold opens.
        // The hem and boots are on separate source strips; the boots stay planted.
        const img=images.get('workshop-architect.webp'),sx=(36%8)*290+1,sy=Math.floor(36/8)*354+1;
        const age=t-4.10,unit=259/334,decay=Math.exp(-2.5*age)*(1-ease(5.95,6.55,t));
        const folds=[150,174,193,213,234,253,274,294,316];
        const offset=y=>{const weight=(y-150)/166;return 11*weight*decay*
          Math.sin(Math.max(0,age-.075*weight)*12)};
        ctx.save();ctx.translate(575-144*unit,438-344*unit);ctx.scale(unit,unit);
        ctx.drawImage(img,sx,sy+316,288,36,0,316,288,36);
        // Paint adjacent strips with a one-pixel overlap to cover antialiased seams.
        for(let i=folds.length-1;i>0;i--){
          const top=folds[i-1],bottom=folds[i],height=bottom-top;
          ctx.save();ctx.translate(offset(top),top);
          ctx.transform(1,0,(offset(bottom)-offset(top))/height,1,0,0);
          ctx.drawImage(img,sx,sy+top,288,height+1,0,0,288,height+1);ctx.restore();
        }
        ctx.drawImage(img,sx,sy,288,151,0,0,288,151);ctx.restore();
      }
      trolley(182,350,108,77);prop(5,179,350,64);
    }
    const renderers=[bellShot,inspectionShot,teaShot,planShot];
    function draw(){
      const width=canvas.clientWidth;
      if(!width)return;
      const dpr=Math.min(2,devicePixelRatio||1),px=Math.round(width*dpr),py=Math.round(width*dpr*9/16);
      if(canvas.width!==px||canvas.height!==py){canvas.width=px;canvas.height=py}
      ctx.setTransform(px/W,0,0,py/H,0,0);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      if(!ready){ctx.fillStyle='#292c29';ctx.fillRect(0,0,W,H);return}
      const cam=cameras[index],zoom=pose(t,cam.z);
      const impactAge=t-2.94;
      const vibration=index===0 && impactAge>=0?1.65*Math.exp(-impactAge*12)*Math.sin(impactAge*48):0;
      const dx=Math.max(W*(1-zoom),Math.min(0,W/2-pose(t,cam.x)*zoom));
      const dy=Math.max(H*(1-zoom),Math.min(0,H/2-pose(t,cam.y)*zoom+vibration));
      ctx.save();ctx.translate(dx,dy);ctx.scale(zoom,zoom);
      ctx.drawImage(images.get('workshop-room.webp'),0,0,W,H);renderers[index]();ctx.restore();
      const fade=getSpeed()>0?Math.max(1-ease(0,1,mix),ease(scenes[index].end-.16,scenes[index].end,t)):0;
      if(fade>0){ctx.save();ctx.globalAlpha=.34*fade;ctx.fillStyle='#342c23';ctx.fillRect(0,0,W,H);ctx.restore()}
    }
    function frame(now){
      tick=0;
      if(!canvas||document.hidden)return;
      if(!available(index))change(nextAvailable(1),false);
      const speed=getSpeed(),dt=last===null?0:Math.min(.08,Math.max(0,now-last)/1000);last=now;
      if(ready&&speed>0){t+=dt*speed;mix=Math.min(1,mix+dt*speed/.18)}
      if(t>=scenes[index].end){const extra=t-scenes[index].end;change(nextAvailable(1),true);t=Math.min(extra,.15)}
      const interval=1000/60;
      if(dirty||now>=nextDraw-.45){
        nextDraw=dirty||!nextDraw?now+interval:nextDraw+(1+Math.floor(Math.max(0,now-nextDraw)/interval))*interval;
        draw();cue();dirty=false;
      }
      if(ready && speed>0)awake();else last=null;
    }
    const resize=new ResizeObserver(invalidate);
    function show(target){
      if(canvas===target)return;
      cancelAnimationFrame(tick);tick=0;resize.disconnect();
      canvas=target;last=null;nextDraw=0;mix=1;dirty=true;lastCue='';
      if(canvas){ctx=canvas.getContext('2d');resize.observe(canvas);load();awake()}
    }
    function next(direction=1){change(nextAvailable(direction),true)}
    return {show,next,invalidate};
  }

  // The ERP and this extension page have independent rendering contexts. Only presentation
  // state crosses the port; all textures and the animation clock belong to this frame.
  window.addEventListener('message',function connect(event){
    if(event.source!==parent || event.data!=='formovod-workshop' || !event.ports[0])return;
    window.removeEventListener('message',connect);
    const port=event.ports[0],away=new Set(),view=document.querySelector('canvas');
    let speed=1;
    const asset=key=>chrome.runtime.getURL('brigade-assets/'+(key.endsWith('.webp')?key:key+'.png'));
    const room=createWorkshop(asset,away,()=>speed,(name,beat,count)=>{
      view.setAttribute('aria-label',name+'. '+beat);
      if(view.dataset.scene!==name)view.dataset.scene=name;
      port.postMessage({name,beat,count});
    });
    port.onmessage=({data})=>{
      if(data.step){room.next(data.step);return}
      speed=data.speed;away.clear();for(const role of data.away)away.add(role);
      room.show(data.visible?view:null);room.invalidate();
    };
  });
})();
