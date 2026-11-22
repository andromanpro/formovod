(() => {
  const asset = name => chrome.runtime.getURL(`brigade-assets/${name.endsWith('.webp')?name:name+'.png'}`);
  const aliases = new Map([
    ['price', 'price'], ['entry', 'price'], ['counterparty', 'price'],
    ['quote', 'quote'], ['quantity', 'quote'], ['product', 'quote'], ['gtd', 'quote'],
    ['contract', 'quote'], ['check', 'check'],
  ]);
  const definitions = {
    price: ['Воркер 1', 'amber', '#ffa634', 0, 53, [246, 663], [238, 664], [243, 661], [324, 664]],
    quote: ['Воркер 2', 'violet', '#bb83f9', 50, 50, [248, 668], [235, 669], [242, 665], [306, 665]],
    check: ['Проверяющий', 'teal', '#008f7c', 100, 51, [246, 664], [240, 666], [248, 663], [328, 663]],
  };
  const actions = {point: 'Идёт к цели', click: 'Нажимает', type: 'Вводит значение',
    read: 'Читает поле', verify: 'Сверяет', select:'Выбирает', key: 'Работает с формой', scroll: 'Прокручивает'};

  globalThis.mountFormovodBrigade = (overlay, ctx, redraw, signal) => {
    const pane = document.createElement('aside');
    pane.id = 'formovod-brigade-dock';
    pane.setAttribute('aria-label','Пульт Формовода');
    const layout = document.createElement('style');
    layout.textContent = `
      html:has(> #formovod-brigade-dock) {
        --fv-edge:clamp(8px,1.65vw,28px); --fv-gap:14px; --fv-top:calc(var(--fv-edge) + 65px);
        --fv-side:clamp(277px,25vw,400px); --fv-left:calc(var(--fv-edge) + 13px);
        --fv-bottom:calc(var(--fv-edge) + 14px);
        background:radial-gradient(ellipse at 67% 0%,#a3734133,#0009 74%),url('${asset('graphite')}') center/850px;
      }
      html:has(> #formovod-brigade-dock) body {background:transparent!important}
      html:has(> #formovod-brigade-dock) :is(#mainSurface,#preloader) {
        position:absolute!important; left:var(--fv-left)!important; top:var(--fv-top)!important;
        width:calc(100% - 2 * var(--fv-left) - var(--fv-side) - var(--fv-gap))!important;
        height:calc(100% - var(--fv-top) - var(--fv-bottom))!important;right:auto!important;bottom:auto!important;
        border-radius:10px;box-shadow:0 0 0 3px #15130f,0 0 0 4px #b7935a80,0 8px 18px #0008;
      }
      @media(max-width:780px){html:has(> #formovod-brigade-dock){--fv-edge:4px;--fv-left:6px;--fv-gap:5px;--fv-side:clamp(145px,32vw,250px);--fv-top:53px;--fv-bottom:6px}}
`;
    const shadow = pane.attachShadow({mode:'open'});
    shadow.innerHTML = `<style>.header { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 8px 11px 16px; flex-wrap: wrap; }
.title { display: flex; align-items: baseline; flex-wrap: wrap; gap: 10px; }
.title strong { color: #fff7e9; font-size: clamp(23px, 3vw, 34px); letter-spacing: -.04em; text-shadow: 0 2px 5px #000c; }
.title span { color: #c8b7a0; font-size: 15px; }
.transport { display: flex; gap: 7px; }
.metal { min-height: 35px; padding: 6px 12px; border: 1px solid #877055; border-radius: 7px; color: #f2e4ce; background: linear-gradient(#98704433, #09080670), var(--graphite) center / 510px; box-shadow: inset 0 1px #e4c5964d, 0 2px 4px #0008; }
.metal:not(:disabled):hover { border-color: #b9935e; }
.panel { position: relative; padding: 17px 11px 15px; border: 1px solid #a68559; border-radius: 12px; background: linear-gradient(125deg, #39260538, #08090758 75%, #30211440), var(--graphite) center / 520px; box-shadow: inset 0 1px 1px #e0bd8480, inset 0 0 0 3px #0d0d0caa, 0 3px 9px #0007; }
.panel::before, .panel::after { content: ''; position: absolute; top: 5px; width: 8px; height: 8px; border-radius: 50%; background: linear-gradient(142deg, transparent 40%, #331b09 44% 52%, transparent 56%), radial-gradient(circle at 32% 26%, #ffe3a3, #9b6228 66%, #352009); box-shadow: 0 1px 3px #000d; pointer-events: none; }
.panel::before { left: 6px; }
.panel::after { right: 6px; }
.panel-block { border: 1px solid #8f7557; border-radius: 8px; background: linear-gradient(140deg, #8d65472b, #0b090868 74%), var(--graphite) center / 450px; box-shadow: inset 0 1px #edcba65e, inset 0 0 0 2px #08070673, 0 3px 5px #0009; }
.orchestrator { --lease-light: #694824; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 7px; min-height: 66px; padding: 8px 10px 8px 13px; }
.orchestrator strong, .architect strong { font: 600 14px var(--engraved); letter-spacing: .035em; text-transform: uppercase; text-shadow: 0 1px 2px #000; }
.orchestrator p { margin: 4px 0 0; color: #e1c9a5; font-size: 12px; }
.lever { position: relative; width: 100px; height: 41px; }
.lever::before { content: ''; position: absolute; inset: 4px 1px 3px 12px; border-radius: 19px; background: linear-gradient(#110e0b, #2f2317); border: 1px solid #876338; box-shadow: inset 0 2px 7px #000d, 0 1px #d0a35d5c; }
.lever::after { content: ''; position: absolute; top: 10px; right: 8px; width: 19px; height: 19px; border-radius: 50%; border: 1px solid #af7138; background: radial-gradient(circle, #241008 21%, var(--lease-light) 26% 45%, #86562f 51% 59%, #150d08 70%); box-shadow: 0 0 11px var(--lease-light); }
.lever span { position: absolute; z-index: 1; top: 16px; left: 19px; width: 66px; height: 10px; border: 1px solid #9b642b; border-radius: 10px; background: linear-gradient(#fff0ba, #cc974d 44%, #5e361a 88%); box-shadow: 0 2px 4px #000b; transform-origin: 6px 50%; transition: transform var(--switch-speed, 230ms) cubic-bezier(.2, .9, .27, 1.2); }
.lever span::before { content: ''; position: absolute; top: -12px; left: -9px; width: 30px; height: 30px; border-radius: 50%; border: 1px solid #bc8d46; background: radial-gradient(circle at 49% 50%, transparent 56%, #fff2bb63 65%, #351e0b 74%), conic-gradient(from 250deg, #6d4223, #e7bd72, #fff0bd, #8e562d, #c69048, #6d4223); box-shadow: inset 0 0 0 2px #40261680, 0 3px 6px #000a; }
.orchestrator[data-owner='price'] { --lease-light: #ffad44; }
.orchestrator[data-owner='quote'] { --lease-light: #c59cf1; }
.orchestrator[data-owner='price'] .lever span { transform: rotate(-13deg); }
.orchestrator[data-owner='quote'] .lever span { transform: rotate(13deg); }
.architect { display: flex; justify-content: space-between; align-items: center; gap: 5px; padding: 9px 11px; margin: 9px 0 13px; }
.architect span { color: #e5cfae; font-size: 12px; white-space: nowrap; }
.lead{margin:0 0 9px;overflow:hidden}.lead summary{cursor:pointer;list-style:none}
.lead summary::-webkit-details-marker{display:none}.lead summary:focus-visible{outline-offset:-3px}
.lead summary strong::after{content:'⌄';display:inline-block;margin-left:8px;color:#d6ad72}
.lead[open] summary strong::after{transform:rotate(180deg)}.lead .architect{margin:0}
.lead-console{aspect-ratio:2;background-color:#252018;background-size:600% 600%;border-top:1px solid #7c6748}
.actors { display: grid; gap: 9px; }
.actor { --role: #ffc56e; --house-slot: 0%; --door-x: 53%; position: relative; display: grid; grid-template-columns: 76px minmax(0, 1fr); align-items: center; gap: 10px; padding: 3px 23px 3px 8px; }
.actor[data-role='quote'] { --role: #d3a4ff; --house-slot: 50%; --door-x: 50%; }
.actor[data-role='check'] { --role: #73e6cf; --house-slot: 100%; --door-x: 51%; }
.actor::before { content: ''; position: absolute; right: 10px; top: 12px; width: 7px; height: 7px; border-radius: 50%; border: 1px solid #967552; background: #31251b; box-shadow: inset 0 1px 2px #000c; }
.actor[data-active='true'] { border-color: color-mix(in srgb, var(--role) 88%, #27211b); box-shadow: inset 0 1px #fff3d64a, inset 0 0 17px color-mix(in srgb, var(--role) 19%, transparent), 0 0 10px color-mix(in srgb, var(--role) 29%, transparent), 0 3px 6px #0009; }
.actor[data-active='true']::before { border-color: var(--role); background: #fff4d9; box-shadow: 0 0 10px 2px var(--role); }
.actor strong { color: var(--role); font: 600 17px var(--engraved); text-shadow: 0 2px 4px #000a; }
.actor p { margin: 4px 0 0; color: #efdec4; font-size: 12px; }
.actor:not([data-pastime]) .break-label, .actor[data-pastime] p:not(.break-label) { display:none }
.house { position: relative; width: 76px; aspect-ratio: 1; background: url('${asset('houses')}') var(--house-slot) center / 300% 100% no-repeat; filter: drop-shadow(0 4px 3px #0e0b08b0); }
.house::after { content: ''; position: absolute; left: var(--door-x); bottom: 16%; width: 27%; height: 32%; transform: translateX(-50%); border-radius: 50% 50% 3px 3px; background: radial-gradient(ellipse at 50% 100%, var(--role), transparent 72%); opacity: 0; transition: opacity 240ms ease; }
.door { position: absolute; left: var(--door-x); top: 87%; width: 1px; height: 1px; }
.actor[data-active='true'] .house::after { opacity: .65; }
.speed { display: grid; grid-template-columns: auto minmax(0, 1fr) 40px; gap: 8px; align-items: center; margin-top: 13px; padding: 7px 2px; font-size: 13px; }
#rate { min-width: 0; width: 100%; accent-color: #efb965; }
#rate-output { text-align: right; font-variant-numeric: tabular-nums; }
.composer { margin-top: 7px; padding: 10px; }
.composer label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 650; }
textarea { display: block; width: 100%; min-height: 63px; padding: 8px; resize: vertical; border: 1px solid #705f4c; border-radius: 6px; color: #fff3df; background: #1b1916; font-size: 14px; }
.send-row { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 7px; margin-top: 7px; }
.send { min-height: 39px; border: 1px solid #a5783a; border-radius: 7px; color: #2c1a08; background: linear-gradient(#ffdc94, #dda350); font-weight: 750; box-shadow: inset 0 1px #fff4c2, 0 2px 5px #0008; }
.send:not(:disabled):hover { background: linear-gradient(#ffe2a5, #edb264); }
      :host{position:fixed;top:var(--fv-top);right:var(--fv-left);bottom:var(--fv-bottom);width:var(--fv-side);z-index:2147483646;color-scheme:dark;font:14px 'Segoe UI',sans-serif;color:#f7ebd9;--engraved:'Bahnschrift','Segoe UI',sans-serif;--graphite:url('${asset('graphite')}')}
      :host::before{content:'';position:fixed;inset:var(--fv-edge);border:1px solid #9c7e5a;border-radius:17px;box-shadow:inset 0 2px 1px #dfbe8e70,inset 0 0 0 4px #17130e,0 0 0 3px #161411,0 12px 36px #0009;pointer-events:none}
      *{box-sizing:border-box}
      button,input,textarea,select{font:inherit} button,select{cursor:pointer} button:disabled{cursor:default;opacity:.52}
      :focus-visible{outline:2px solid #efbc6d;outline-offset:2px}
      .header{position:fixed;left:var(--fv-left);right:var(--fv-left);top:calc(var(--fv-edge) + 3px);height:57px;padding:4px 11px;flex-wrap:nowrap}
      .panel{height:100%;overflow:auto;scrollbar-width:thin}
      .actor small{display:block;margin-top:2px;color:#c7b89f;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.actor small:empty{display:none}
      .result{font-size:12px;color:#e6cfaa;margin:9px 2px 0;line-height:1.35}.result:empty{display:none}
      #mic{display:grid;place-items:center;min-width:0;padding:4px;color:#ffd38a}
      @media(max-height:820px){.house{width:60px}.actor{grid-template-columns:60px minmax(0,1fr)}.actors{gap:6px}.panel{padding-top:12px}.orchestrator{min-height:51px}}
      @media(max-width:780px){.header{height:42px;padding:0 2px}.title span{display:none}.title strong{font-size:23px}.transport{gap:3px}.transport .metal{min-height:30px;padding:3px}.panel{padding:12px 5px 6px}.orchestrator{grid-template-columns:1fr}.lever{display:none}.house{width:36px}.actor{grid-template-columns:36px minmax(0,1fr);padding-left:2px;gap:4px}.actor strong{font-size:13px}.architect span{white-space:normal}.composer{padding:5px}}
</style><header class="header"><div class="title"><strong>Формовод</strong><span>Рабочая область</span></div>
       <div class="transport"><select class="metal" aria-label="Отображение агентов"><option value="crew">Бригада</option><option value="cursor">Курсоры</option></select>
       <button class="metal" type="button" id="pause">Пауза</button><button class="metal" type="button" id="reset" title="Сбросить подсветку" aria-label="Сбросить подсветку">Сбросить</button></div></header><section class="panel">
      <details class="lead panel-block" data-console="chief"><summary class="orchestrator"><div><strong>Оркестратор</strong><p id="owner">Ожидает действий MCP</p></div><div class="lever" aria-hidden="true"><span></span></div></summary><div class="lead-console" role="img" aria-label="Оркестратор за диспетчерским пультом"></div></details>
      <details class="lead panel-block" data-console="architect"><summary class="architect"><strong>Архитектор</strong><span>Цель → Ввод → Сверка</span></summary><div class="lead-console" role="img" aria-label="Архитектор у чертёжного пульта"></div></details>
      <div id="actors" class="actors"></div>
      <div class="speed"><label for="rate">Скорость</label><input id="rate" type="range" min="0.5" max="3" step="0.25" value="1"><output id="rate-output" for="rate">1×</output></div>
      <form class="composer panel-block" hidden><label for="task">Поручение</label><textarea rows="2" id="task">Заполни и сверь позиции</textarea>
        <div class="send-row"><button class="metal" type="button" id="mic" aria-label="Диктовка Windows" title="Голосовой ввод (Win + H)">
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="9" y="2" width="6" height="13" rx="3" fill="currentColor"/>
            <path d="M5.5 10.5v1a6.5 6.5 0 0 0 13 0v-1M12 18v4m-3 0h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg></button><button class="send">Отправить</button></div></form>
      <p class="result" role="status"></p></section>`;
    document.documentElement.append(layout, pane);
    window.dispatchEvent(new Event('resize'));
    signal.addEventListener('abort', () => {layout.remove();pane.remove();}, {once:true});
    const $ = selector => shadow.querySelector(selector);
    // 1C handles keys on the document and sees the shadow host, not the textarea.
    // Keep the composer events local and leave text editing to the browser.
    const composer = $('form');
    for(const type of ['keydown','keypress','keyup','beforeinput','input','compositionstart',
      'compositionupdate','compositionend','paste','cut','copy','pointerdown','pointerup',
      'mousedown','mouseup','click','dblclick','focusin','focusout']){
      composer.addEventListener(type,event=>event.stopPropagation(),{signal});
    }
    const mode = $('select');
    const speed = $('#rate');
    const actors = new Map();
    const impact = globalThis.createFormovodImpact?.(asset,redraw);
    const inspection = globalThis.createFormovodInspection?.({asset,redraw,shadow,signal});
    const motion = globalThis.createFormovodMotion?.(ctx.canvas.parentNode,asset,signal);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const playbackRate = () => overlay.dataset.brigadePaused === '1' ? 0 : Number(speed.value);
    const guides = () => overlay.dataset.showGuides === '1';
    const consolePlayers=[];
    for(const card of shadow.querySelectorAll('details.lead')){
      const art=card.querySelector('.lead-console');
      let loop,visible=false;
      function update(){
        if(!card.open || !visible || document.hidden){loop?.pause();return}
        if(!loop){
          art.style.backgroundImage=`url("${asset('leader-console-'+card.dataset.console+'.webp')}")`;
          const frames=Array.from({length:37},(_,i)=>({offset:i/36,easing:'steps(1,end)',
            backgroundPosition:`${(i%36)%6*20}% ${Math.floor(i%36/6)*20}%`}));
          loop=art.animate(frames,{duration:3200,iterations:Infinity});
        }
        if(reduced.matches || !playbackRate()){loop.pause();return}
        loop.playbackRate=playbackRate();loop.play();
      }
      const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;update()});
      observer.observe(art);
      card.addEventListener('toggle',update,{signal});
      speed.addEventListener('input',update,{signal});
      consolePlayers.push(update);
      reduced.addEventListener('change',update,{signal});
      document.addEventListener('visibilitychange',update,{signal});
      signal.addEventListener('abort',()=>{observer.disconnect();loop?.cancel()},{once:true});
    }
    reduced.addEventListener('change', () => {motion?.reset();redraw();}, {signal});
    const figureSize = () => innerWidth < 1200 ? 48 : 55;
    overlay.dataset.impactCount = overlay.dataset.inspectionReads = '0';
    const rings = [];
    let last = performance.now();
    let clock = 0;
    let delta = 0;
    let demoAssignment = null;
    let demoSequence = 0;
    function showBreak(role, status) {
      if(status){
        if(!role.card.dataset.pastime)role.card.dataset.pastime='smoking';
        if(role.breakLabel.textContent!==status)role.breakLabel.textContent=status;
      }else if(role.card.dataset.pastime)delete role.card.dataset.pastime;
    }
    for (const [key, [label, sprite, color, slot, threshold, ...feet]] of Object.entries(definitions)) {
      const card = document.createElement('div');
      card.className = 'actor panel-block';
      card.dataset.role = key;
      card.style.cssText = `--role:${key === 'check' ? '#70e0cc' : color};--house-slot:${slot}%;--door-x:${threshold}%`;
      card.innerHTML = `<div class="house" aria-hidden="true"><i class="door"></i></div><div><strong>${label}</strong><p>На месте</p><p class="break-label"></p><small></small></div>`;
      $('#actors').append(card);
      const image = new Image();
      image.addEventListener('load',redraw,{once:true});
      image.src = asset(sprite);
      actors.set(key,{key,label,color,card,foot:card.querySelector('.door'),status:card.querySelector('p'),
        breakLabel:card.querySelector('.break-label'),detail:card.querySelector('small'),image,feet,changed:0});
    }

    const pause = $('#pause');
    pause.onclick = () => {
      const paused = overlay.dataset.brigadePaused === '1';
      overlay.dataset.brigadePaused = paused ? '0' : '1';
      for(const update of consolePlayers)update();
      pause.textContent = paused ? 'Пауза' : 'Продолжить';
      pause.setAttribute('aria-pressed',String(!paused));
      redraw();
    };
    $('#reset').onclick = () => {
      for (const actor of aliases.keys()) {
        document.dispatchEvent(new CustomEvent('testpilot:overlay',{detail:{kind:'clear',actor}}));
      }
      for (const role of actors.values()) {
        role.x = role.y = role.lastTarget = role.lastVisible = undefined;
        role.direction = role.mark = undefined;
        role.assignment = role.station = role.routeOrigin = role.actionRef = role.actionId = null;
        role.released = false;
        role.card.dataset.phase = 'home';
        delete role.card.dataset.pastime;
        role.running = false;
        role.swing = role.reading = role.intent = role.watch = role.observedAssignment = null;
        role.card.dataset.deployed = role.card.dataset.active = 'false';
        role.status.textContent = 'На месте';
        role.card.title = role.detail.textContent = '';
      }
      rings.length = 0;
      motion?.reset();
      inspection?.reset();
      $('.orchestrator').dataset.owner = '';
      $('#owner').textContent = 'Ожидает поручение';
      redraw();
    };
    speed.oninput = () => {$('output').textContent = `${Number(speed.value).toLocaleString('ru-RU')}×`; redraw();};
    mode.onchange = () => {
      motion?.reset();
      for(const role of actors.values()){
        delete role.card.dataset.pastime;
        if(role.reading?.receipt)inspection?.setReceipt(role.reading.receipt);
        role.swing=role.reading=role.watch=null;
      }
      redraw();
    };
    window.addEventListener('resize',redraw,{signal});
    function interact(event, handler) {document.addEventListener(event,handler,{signal});}
    function releaseAssignment(id){
      if(!id)return;
      for(const [token,trip] of travels){
        if(actors.get(trip.role)?.assignment===id)acknowledge(token,false);
      }
      for(const role of actors.values()){
        if(role.assignment!==id)continue;
        role.released=true;role.running=false;role.watch=null;
        if(role.reading && !role.reading.observed)role.reading=null;
        if(role.swing?.phase==='windup'){
          if(role.swing.awaiting)role.swing.deadline=clock+2000;
          else role.swing=null;
        }
      }
      redraw();
    }
    interact('testpilot:assignment-ended',e=>releaseAssignment(e.detail?.id));
    interact('testpilot:activity', event => {
      const update = event.detail;
      const role = actors.get(aliases.get(update?.actor));
      if (!role) return;
      if(update.state!=='running' && role.actionId!==update.id)return;
      if(update.state==='running'){
        role.watch=null;
        role.assignment=update.assignment||demoAssignment;
        if(role.actionId!==update.id){
          const alreadyOut=role.x!==undefined && role.card.dataset.deployed==='true';
          role.routeOrigin=alreadyOut?{x:role.x,y:role.y}:null;
          if(alreadyOut && role.assignment && role.direction==='home'){
            role.direction='form';role.leg=2;
          }
        }
        role.released=false;role.actionRef=update.ref;role.actionId=update.id;
      }
      role.changed = performance.now();
      role.intent = update.intent || update.action;
      if(update.state==='running'){
        if(role.reading && role.reading.id!==update.id){
          if(role.reading.receipt)inspection?.setReceipt(role.reading.receipt);
          role.reading=null;
        }
        if(update.action==='type' && impact && role.key!=='check' && mode.value==='crew' && !reduced.matches){
          inspection?.reset();
          role.swing={ref:update.ref,start:clock,phase:'windup',deadline:Infinity};
        }
        if((update.action==='verify'||update.action==='read') && inspection && role.key==='check'){
          if(update.action==='verify')inspection.reset();
          role.reading={ref:update.ref,id:update.id,start:clock,observed:false};
        }
      }else{
        if(update.action==='type'&&role.swing?.ref===update.ref && role.swing.phase==='windup'){
          if(update.state==='error')role.swing=null;
          else if(!role.swing.awaiting)role.swing.deadline=clock+1800;
        }
        if(role.reading && role.reading.id===update.id){
          if(update.state==='error')role.reading=null;
          else{
            const read=role.reading;
            read.observed=true;read.value=update.value;read.until=clock+950;
            if(update.state==='match'||update.state==='mismatch'){
              read.receipt={label:update.label,context:document.querySelector('.openedItem.select,.openedItem[aria-selected=true]')?.innerText?.trim(),
                value:update.value,expected:update.expected,match:update.state==='match'};
            }
            if(mode.value!=='crew'||reduced.matches||overlay.dataset.brigadePaused==='1'){
              if(read.receipt)inspection.setReceipt(read.receipt);
              role.reading=null;
            }
          }
        }
      }
      role.action = update.action;
      role.running = update.state === 'running';
      role.status.textContent = update.state === 'match' ? 'Совпало' : update.state === 'mismatch' ? 'Расхождение' :
        update.state === 'error' ? 'Действие прервано' : role.running ? actions[update.action] || 'Работает с формой' :
        update.action === 'point' ? update.note || 'Цель найдена' :
        role.swing?.awaiting ? 'Ждёт подтверждения 1С' : 'Действие выполнено';
      if (update.label) role.card.title = role.detail.textContent = update.label;
      if (role.key !== 'check' && ['type','click','select','key'].includes(update.action)) {
        $('.orchestrator').dataset.owner = role.running ? role.key : '';
        $('#owner').textContent = role.running ? `Управление: ${role.label}` : 'Форма доступна для чтения';
      }
      redraw();
    });
    interact('testpilot:brigade-demo', event => {
      const {state,message} = event.detail ?? {};
      if(state==='busy')demoAssignment??='demo-'+(++demoSequence);
      else {releaseAssignment(demoAssignment);demoAssignment=null}
      $('form').hidden = state === 'hidden';
      $('.send').disabled = state === 'busy';
      $('.result').textContent = message ?? '';
    });
    $('form').onsubmit = event => {
      event.preventDefault();
      if (globalThis.mountFormovodPanel || !event.isTrusted || $('.send').disabled) return;
      if (overlay.dataset.brigadePaused === '1') {
        $('.result').textContent = 'Возобновите правки перед запуском.';
        return;
      }
      const text = $('#task').value.trim().replace(/[.!?]+$/u,'').toLowerCase();
      const request = text === 'заполни и сверь позиции' ? 'fill' : text === 'сверь позиции' ? 'verify' : '';
      if (!request) {
        $('.result').textContent = 'Для этого прогона доступны «Заполни и сверь позиции» и «Сверь позиции».';
        return;
      }
      overlay.dataset.brigadeRequest = request;
      $('.send').disabled = true;
      $('.result').textContent = 'Поручение принято.';
    };
    $('#mic').onclick = () => {$('#task').focus();$('.result').textContent = 'Нажмите Win + H, чтобы надиктовать поручение.';};

    globalThis.mountFormovodPanel?.(shadow,overlay,actors,asset,speed,signal);
    const travels = new Map();
    function acknowledge(token, ok) {
      const trip=travels.get(token);
      travels.delete(token);
      document.dispatchEvent(new CustomEvent('testpilot:arrived',{detail:{token,ok,actor:trip?.actor,ref:trip?.ref,id:trip?.id}}));
    }
    interact('testpilot:travel', e => {
      const {token,actor,ref,position,action,id} = e.detail;
      if (mode.value !== 'crew' || reduced.matches || overlay.dataset.brigadePaused==='1') {
        acknowledge(token,true);
        return;
      }
      const trip={id,actor,action,role:aliases.get(actor),ref,position,deadline:performance.now()+14500};
      if(position){
        const element=document.elementFromPoint(position.x,position.y);
        if(!element || element===pane){acknowledge(token,false);return}
        trip.mark={ref,element,markedAt:performance.now()};
      }
      travels.set(token,trip);
      redraw();
    });
    function home(role) {
      const rect = role.foot.getBoundingClientRect();
      return {x:rect.left,y:rect.bottom};
    }

    function showPress(role,goal,trip,progress){
      const rect=goal.rect;
      const x=trip.position?.x??(Math.max(0,rect.left)+Math.min(innerWidth,rect.right))/2;
      const y=trip.position?.y??(Math.max(0,rect.top)+Math.min(innerHeight,rect.bottom))/2;
      const handX=role.x+(goal.faceRight?1:-1)*8,handY=role.y-figureSize()*.48;
      ctx.save();
      ctx.lineWidth=1.8;ctx.strokeStyle=role.color;ctx.shadowBlur=2;ctx.shadowColor='#332419';
      if(guides()){ctx.beginPath();ctx.moveTo(handX,handY);ctx.lineTo(x,y);ctx.stroke()}
      ctx.beginPath();ctx.arc(x,y,5+(1-progress)*8,0,2*Math.PI);ctx.stroke();
      ctx.beginPath();ctx.arc(x,y,2.6,0,2*Math.PI);ctx.fillStyle='#fff4ce';ctx.fill();
      ctx.restore();
    }

    function trace(points, role) {
      ctx.save();
      ctx.strokeStyle = role.color;
      ctx.shadowColor = role.color;
      ctx.shadowBlur = 5;
      ctx.globalAlpha = .78;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.setLineDash(role.running ? [] : [5,5]);
      ctx.lineDashOffset = -(clock/43)%10;
      ctx.beginPath();
      ctx.moveTo(points[0].x,points[0].y);
      for (const point of points.slice(1)) ctx.lineTo(point.x,point.y);
      ctx.stroke();
      ctx.restore();
    }

    const walkCycle = new Image();
    walkCycle.addEventListener('load',redraw,{once:true});
    walkCycle.src = asset('walk-cycle');
    const walkRows = {price:0,quote:1,check:2};
    function figure(role, frame, facingRight, stride, working) {
      if (!role.image.naturalWidth) return;
      const [footX,footY] = role.feet[frame];
      const scale = (innerWidth < 1200 ? 48 : 62)/602;
      ctx.save();
      ctx.translate(role.x, role.y);
      ctx.beginPath();
      ctx.fillStyle='#21130c38';
      ctx.ellipse(0,-.5,scale*99,scale*30,0,0,Math.PI*2);
      ctx.fill();
      // Plant the feet between strides and shift the weight before each step.
      const walking = stride !== null;
      const lift = walking ? Math.abs(Math.sin(stride)) : 0;
      const reach = working ? (1 - Math.cos(clock / 125)) / 2 : 0;
      ctx.translate(0, -2.6 * lift);
      if (facingRight) ctx.scale(-1,1);
      ctx.rotate(walking ? .035 * Math.sin(stride) : -.032 * reach);
      ctx.scale(1 + .018 * reach, 1 - .018 * reach + .012 * lift);
      if (walking && walkCycle.naturalWidth) {
        const phase = Math.floor(stride * 16 / (2*Math.PI)) % 16;
        const unit = scale / .16;
        ctx.drawImage(walkCycle,phase*104,walkRows[role.key]*120,104,120,-52*unit,-112*unit,104*unit,120*unit);
      } else {
        ctx.drawImage(role.image,543*frame,0,543,724,-footX*scale,-footY*scale,543*scale,724*scale);
      }
      ctx.restore();
    }

    function scan(rect) {
      const x = rect.left + rect.width*((clock%680)/680);
      const beam = ctx.createLinearGradient(x-13,0,x+13,0);
      beam.addColorStop(0,'#1bba9c00');
      beam.addColorStop(.5,'#7bf5daa8');
      beam.addColorStop(1,'#1bba9c00');
      ctx.save();
      ctx.fillStyle = beam;
      ctx.fillRect(rect.left+1,rect.top+1,Math.max(0,rect.width-2),Math.max(0,rect.height-2));
      ctx.restore();
    }

    function advance(role, goal, rail, direction) {
      if (role.direction !== direction) {
        role.direction = direction;
        role.leg = 0;
      }
      const points = [{x:rail,y:role.y},{x:rail,y:goal.y},goal];
      let distance = delta * .50;
      while (role.leg < points.length) {
        const point = points[role.leg];
        const dx = point.x-role.x;
        const dy = point.y-role.y;
        const gap = Math.hypot(dx,dy);
        if (Math.abs(dx) > 1) role.facingRight = dx > 0;
        if (gap > distance) {
          role.x += dx*distance/gap;
          role.y += dy*distance/gap;
          return;
        }
        role.x = point.x;
        role.y = point.y;
        distance -= gap;
        role.leg++;
      }
      if (Math.hypot(goal.x-role.x,goal.y-role.y) > 1) role.leg = 2;
    }

    function toolPosition(role,rect,element,edge) {
      const size=figureSize();
      if(role.key==='check'){
        // Determine the actual painted span once per target. The lens and its holder
        // occupy the spare side, leaving punctuation and the original value visible.
        const txt=element && ('value' in element?element.value:element.textContent)?.trim();
        let span=role.textSpan;
        if(!span || span.element!==element || span.txt!==txt || span.width!==rect.width){
          let lo=0,hi=rect.width;
          if(element && txt){
            const leaf=Array.from(element.childNodes).find(n=>n.nodeType===Node.TEXT_NODE && n.textContent.trim());
            if(leaf){
              const range=new Range();range.selectNodeContents(leaf);
              const box=range.getBoundingClientRect();lo=box.left-rect.left;hi=box.right-rect.left;
            }else{
              const css=getComputedStyle(element);ctx.save();ctx.font=css.fontSize+' '+css.fontFamily;
              const tw=Math.min(rect.width,ctx.measureText(txt).width+4);ctx.restore();
              const right=/right|end/.test(css.textAlign);
              lo=right?rect.width-tw-4:3;hi=lo+tw;
            }
          }
          span=role.textSpan={element,txt,width:rect.width,lo,hi};
        }
        const textLeft=rect.left+span.lo,textRight=rect.left+span.hi;
        let flip=textLeft>size*1.24, lensX=flip?Math.min(textLeft-size*.29,rect.left+rect.width*.34):textRight+size*.29;
        let lensY=rect.top+rect.height*.48;
        const sharedColumn=role.assignment && element?.closest('.gridLine') &&
          ['price','quote'].some(key=>actors.get(key).assignment===role.assignment && !actors.get(key).released);
        if(sharedColumn && rect.right+size*1.04>edge && rect.top>size){
          // The hammer occupies the left edge of the last column. Approach
          // the digits from above so both silhouettes and the cell stay visible.
          lensX=Math.max(size,Math.min(edge-size*.3,(textLeft+textRight)/2));
          lensY=rect.top-size*.32;flip=true;
        }else if(lensX<size*.95||lensX>edge-size*.95){
          lensX=Math.max(size,Math.min(edge-size,rect.left+rect.width*.5));
          lensY=rect.top>size*.65?rect.top-size*.29:rect.bottom+size*.28;
          flip=lensX>size;
        }
        lensY=Math.max(size*.36,Math.min(innerHeight-size*.7,lensY));
        return {x:lensX+(flip?-1:1)*size*.56,y:lensY+size*.65,lensX,lensY,flip,
          faceRight:flip,textLeft,textRight};
      }
      const flip=rect.right+size*1.04>edge && rect.left>size;
      const hitX=flip?rect.left+2:Math.min(edge-2,rect.right-2);
      const hitY=Math.max(3,Math.min(innerHeight-3,rect.bottom-1));
      return {x:hitX+(flip?-1:1)*size*.56,y:hitY,hitX,hitY,flip,faceRight:flip};
    }
    function drawTools(role,goal){
      const size=figureSize(),swing=role.swing,read=role.reading;
      if(swing && impact && goal.hitX!==undefined){
        const strike=swing.phase==='strike';
        const p=Math.min(1,Math.max(0,(clock-swing.start)/(strike?660:420)));
        if(!strike && motion && !reduced.matches && impact.ready(role.key)){
          return motion.hold(role.key,goal,size,playbackRate(),p);
        }
        const drawn=impact.draw(ctx,{x:goal.hitX,y:goal.hitY,scale:size,flip:goal.flip,role:role.key,phase:swing.phase,p});
        if(strike && p>=.24 && drawn && !swing.hit){
          swing.hit=true;
          overlay.dataset.impactCount=String(Number(overlay.dataset.impactCount)+1);
        }
        if(strike && p>=.24 && p<.63 && drawn && !reduced.matches){
          const a=(p-.24)/.39;ctx.save();ctx.globalAlpha=1-a;ctx.strokeStyle=role.color;ctx.lineWidth=1.6;
          for(const [dx,dy] of [[-9,-3],[-8,5],[1,8],[7,4]]){
            ctx.beginPath();ctx.moveTo(goal.hitX+dx*a,goal.hitY+dy*a);
            ctx.lineTo(goal.hitX+dx*(a+.45),goal.hitY+dy*(a+.45));ctx.stroke();
          }
          ctx.restore();
        }
        return drawn;
      }
      if(read && inspection && !read.returning && goal.lensX!==undefined){
        const p=Math.min(1,Math.max(0,(clock-read.start)/290));
        const drawn=inspection.draw(ctx,{x:goal.lensX,y:goal.lensY,rect:goal.rect,value:read.observed?read.value:'',
          scale:size,p,flip:goal.flip});
        if(drawn && read.observed && read.receipt && !read.counted){
          read.counted=true;overlay.dataset.inspectionReads=String(Number(overlay.dataset.inspectionReads)+1);
        }
        if(guides() && drawn && read.observed && goal.lensY<goal.rect.top){
          ctx.save();ctx.strokeStyle='#47a790';ctx.lineWidth=1;ctx.beginPath();
          ctx.moveTo(goal.lensX,goal.lensY+size*.16);ctx.lineTo(goal.lensX,goal.rect.top+2);
          ctx.stroke();ctx.restore();
        }else if(guides() && drawn && read.observed && goal.textLeft>goal.lensX+size*.23){
          const y=Math.min(goal.rect.bottom-1,goal.lensY+size*.16);ctx.save();
          ctx.strokeStyle='#47a790';ctx.lineWidth=1;ctx.beginPath();
          ctx.moveTo(goal.lensX+size*.17,goal.lensY+3);ctx.lineTo(goal.textLeft-2,y);
          ctx.lineTo(Math.min(goal.textRight,goal.textLeft+size*.24),y);ctx.stroke();ctx.restore();
        }
        return drawn;
      }
      return false;
    }
    function finishRead(role){
      if(role.reading?.receipt)inspection?.setReceipt(role.reading.receipt);
      role.reading=null;role.changed=-Infinity;
    }
    return {
      observeGridEdit(actor,locate){
        const worker=actors.get(aliases.get(actor)),checker=actors.get('check');
        if(!worker?.assignment || worker.released || checker.observedAssignment===worker.assignment ||
          (checker.assignment && checker.assignment!==worker.assignment && !checker.released) ||
          checker.running || checker.reading || mode.value!=='crew' || reduced.matches || !locate())return;
        // Stand by the first edited row. Only an actual MCP read may use the
        // lens, mark the value, or issue a receipt. A busy checker keeps its job.
        checker.watch=locate;
        checker.assignment=checker.observedAssignment=worker.assignment;checker.released=false;
        checker.actionRef=checker.actionId=null;checker.action=checker.intent='observe';
        checker.card.title=checker.detail.textContent=worker.detail.textContent;
        checker.status.textContent='К строке на сверку';
        redraw();
      },
      awaitingEdit(actor,ref){
        const role=actors.get(aliases.get(actor));
        if(role?.swing?.ref===ref && role.swing.phase==='windup'){
          role.swing.awaiting=true;role.swing.deadline=Infinity;
          role.status.textContent='Ждёт подтверждения 1С';
        }
      },
      cancelEdit(actor,ref){
        const role=actors.get(aliases.get(actor));
        if(role?.swing?.ref===ref && role.swing.phase==='windup'){
          if(role.swing.awaiting)role.status.textContent='Ввод завершён без удара';
          role.swing=null;
        }
      },
      acceptEdit(actor,ref,locate){
        const role=actors.get(aliases.get(actor));
        if(!role || !impact || role.key==='check' || mode.value!=='crew' || reduced.matches || !locate())return;
        const mark=role.mark?.ref===ref ? role.mark : {ref,markedAt:performance.now()};
        role.swing={ref,phase:'strike',start:clock,deadline:clock+950,locate,mark,hit:false};
        role.status.textContent='Значение принято';
        redraw();
      },
      begin(now) {
        motion?.begin();
        delta = overlay.dataset.brigadePaused==='1' ? 0 : Math.max(0,Math.min(80,now-last))*Number(speed.value);
        clock += delta;
        last = now;
        for (const role of actors.values()) role.target = role.candidate = null;
      },
      color(actor) { return actors.get(aliases.get(actor))?.color; },
      speed() {return Number(speed.value);},
      target(actor, rect, mark, element) {
        if (mode.value !== 'crew') return false;
        const role = actors.get(aliases.get(actor));
        const edge = pane.getBoundingClientRect().left;
        if (!role || rect.left >= edge) return false;
        if(role.assignment && role.actionRef!==mark.ref)return true;
        const useLeft = role.key !== 'quote' && rect.left > 60;
        const limited = useLeft ? rect.left-(role.key === 'check' ? 27 : 13) : Math.min(edge-20,rect.right+20);
        if (!role.candidate || role.candidate.mark.markedAt <= mark.markedAt) {
          const editCell=element?.closest('.gridLine[rowindex] > [colindex]') ??
            (element?.matches('input,textarea') && element.closest('.gridContent') ? formovodEditorCell(element) : null);
          const fieldRect=editCell && formovodVisibleRect(editCell);
          const tool=impact && role.key!=='check' && (role.intent==='type' || (fieldRect && role.intent==='click')) ||
            inspection && role.key==='check' && ['read','verify'].includes(role.intent);
          const placement=tool?toolPosition(role,fieldRect||rect,element??mark.element,edge):
            {x:limited,y:Math.min(innerHeight-7,rect.bottom+16),faceRight:useLeft};
          role.candidate = {mark,rect,...placement};
        }
        return true;
      },
      draw(now) {
        let animating = inspection?.tick(delta) || false;
        for (const [token,trip] of travels) {
          if (mode.value !== 'crew' || reduced.matches){acknowledge(token,true);continue}
          if(now>=trip.deadline || overlay.dataset.brigadePaused==='1' ||
             (trip.ref && !document.querySelector('[data-testpilot-mcp="'+CSS.escape(trip.ref)+'"]'))){
            acknowledge(token,false);continue;
          }
          if(trip.position){
            const {x,y}=trip.position;
            if(document.elementFromPoint(x,y)!==trip.mark.element){acknowledge(token,false);continue}
            const rect=new DOMRect(x-7,y-7,14,14);
            this.target(trip.actor,rect,trip.mark,trip.mark.element);
          }
        }
        for (const role of actors.values()) {
          const start = home(role);
          let mark = role.candidate?.mark;
          if(role.swing && clock>=role.swing.deadline)role.swing=null;
          // Once contact is visible, a new real action owns the worker. The
          // recovery frames of the previous blow must not pin him to that cell.
          if(role.swing?.hit && role.running && mark && mark.ref!==role.swing.ref)role.swing=null;
          if(role.swing?.phase==='strike'){
            const rect=role.swing.locate();
            if(!rect)role.swing=null;
            else {
              const placement=toolPosition(role,rect,null,pane.getBoundingClientRect().left);
              mark=role.swing.mark;
              role.candidate={mark,rect,...placement};
            }
          }
          if(role.reading?.observed && clock>=role.reading.until){
            if(role.assignment)finishRead(role);
            else role.reading.returning=true;
          }
          if (mark) {
            role.target = role.candidate;
            role.lastTarget = role.candidate;
            role.lastVisible = now;
            role.working = Boolean(mark.done || mark.mismatch ||
              (role.running && ['click','select','type','read','verify','key'].includes(role.action)));
            if (role.mark !== mark) {
              role.mark = mark;
              role.changed = now;
              if (role.x === undefined && !role.released) rings.push({...start,time:clock,color:role.color});
            }
          }
          if (!role.target && !role.assignment && now-role.lastVisible < 230) role.target = role.lastTarget;
          const dwell = role.action === 'type' ? 510 : role.action === 'point' ? 4300 : 1900;
          const onDuty=Boolean(role.assignment && !role.released);
          const gesture=Boolean(role.running || role.swing || role.reading);
          const atField=Boolean(role.target && !role.reading?.returning &&
            (onDuty || gesture || (!role.released && now-role.changed<dwell)));
          const watchRect=onDuty && role.watch?.();
          const active=atField || (onDuty && (role.x!==undefined || Boolean(watchRect)));
          const engaged=atField && (!onDuty || gesture);
          if(role.card.dataset.active!==String(engaged))role.card.dataset.active=String(engaged);
          if (mode.value !== 'crew') {
            if(!onDuty){role.x=role.y=undefined;role.station=null}
            role.card.dataset.deployed=String((onDuty && role.x!==undefined) || role.running);continue;
          }
          if (active && role.card.dataset.deployed!=='true') role.card.dataset.deployed='true';
          if (!active && role.x === undefined) {if(role.reading?.returning)finishRead(role);continue;}
          const edge = pane.getBoundingClientRect().left;
          // A closed menu or a rebuilt row has no valid work target. Keep only
          // the worker's footing; never aim a tool at the old rectangle.
          if(watchRect){
            role.station={x:Math.max(figureSize(),Math.min(edge-figureSize(),watchRect.left+watchRect.width*.35)),
              y:Math.max(figureSize()+5,watchRect.top-7),faceRight:true};
          }else if(!atField && active){
            if(role.watch)role.station=null;
            role.station??={x:role.x,y:role.y,faceRight:role.facingRight};
            role.station.x=Math.max(8,Math.min(edge-12,role.station.x));
            role.station.y=Math.max(figureSize(),Math.min(innerHeight-6,role.station.y));
          }else role.station=null;
          const goal=atField ? role.target : active ? role.station : start;
          const rail = edge + (role.key==='price' ? 3 : role.key==='quote' ? 7 : 11);
          if (engaged && guides()) {
            const path=role.assignment && role.routeOrigin ? [role.routeOrigin,goal] :
              [start,{x:rail,y:start.y},{x:rail,y:goal.y},goal];
            trace(path,role);
          }
          if (engaged && role.key === 'check' && mark && !mark.done && !mark.mismatch) scan(goal.rect);
          role.x ??= start.x;
          role.y ??= start.y;
          const prevX = role.x, prevY = role.y;
          const direction=active ? 'form' : 'home';
          const useMotion=motion && walkCycle.naturalWidth && !reduced.matches;
          let walking;
          if(useMotion) {
            walking=motion.move(role,goal,rail,direction,playbackRate(),(innerWidth<1200?48:62)/602/.16);
          } else if(reduced.matches) {
            role.x=goal.x;role.y=goal.y;walking=false;
          } else {
            advance(role,goal,rail,direction);
            walking=Math.hypot(goal.x-role.x,goal.y-role.y)>4;
          }
          role.travelled = (role.travelled || 0) + Math.hypot(role.x-prevX, role.y-prevY);
          let pressing=false;
          for (const [token,trip] of travels) {
            if(trip.role!==role.key || trip.id!==role.actionId)continue;
            if(!atField || walking || !mark || trip.ref!==mark.ref){trip.contactStart=null;continue}
            if(['click','select'].includes(trip.action)){
              trip.contactStart??=clock;
              const progress=Math.min(1,(clock-trip.contactStart)/320);
              showPress(role,goal,trip,progress);pressing=true;
              if(progress<1)continue;
              document.dispatchEvent(new CustomEvent('testpilot:press-ready',{detail:{
                token,id:trip.id,actor:trip.actor,ref:trip.ref,position:trip.position}}));
            }
            acknowledge(token,true);
          }
          const phase=active ? (walking?'walking':engaged?'working':watchRect?'observing':'waiting') : walking?'returning':'home';
          if(role.card.dataset.phase!==phase)role.card.dataset.phase=phase;
          const idleStatus=phase==='observing'?'Следит за вводом':phase==='waiting'?'Ждёт следующего действия':
            phase==='returning'?'Возвращается в мастерскую':phase==='home'?'На месте':'';
          if(walking || !onDuty || !useMotion)showBreak(role,null);
          if(idleStatus && role.status.textContent!==idleStatus)role.status.textContent=idleStatus;
          if (!active && !walking) {role.x=role.y=undefined;role.card.dataset.deployed='false';if(role.reading?.returning)finishRead(role);continue;}
          if (useMotion && walking) {animating=true;continue;}
          const stride = walking ? role.travelled / 23 : null;
          const working = pressing || (!walking && engaged && role.working);
          // The violet work sprite holds a literal "8" placard.
          const markValue = role.mark?.element?.value ?? role.mark?.element?.textContent;
          const showWorkPose = role.key !== 'quote' ||
            (/количество/iu.test(role.card.title) && /^8(?:,0+)?$/u.test(markValue?.trim() ?? ''));
          const frame = walking ? (Math.sin(stride) >= 0 ? 1 : 2) : working && showWorkPose ? 3 : 0;
          if(walking || !engaged || !drawTools(role,goal)){
            if(useMotion && active && !walking && role.image.naturalWidth){
              motion.stance(role,goal,frame,(innerWidth<1200?48:62)/602,playbackRate());
            }else figure(role,frame,walking ? role.facingRight : goal.faceRight,stride,working);
          }
          const waitingOnForm=role.swing?.phase==='windup' && role.swing.awaiting;
          const canSmoke=useMotion && onDuty && !walking && role.key!=='check' &&
            (phase==='waiting' && !role.running || waitingOnForm);
          const smoking=motion?.smoking(role,goal,figureSize(),canSmoke);
          showBreak(role,smoking ? (waitingOnForm?'Перекур · ждёт форму':'Перекур · на месте') : null);
          animating = true;
        }
        for (let i=rings.length-1;i>=0;i--) {
          const ring=rings[i], phase=(clock-ring.time)/430;
          if (phase>=1) {rings.splice(i,1);continue;}
          ctx.save();ctx.strokeStyle=ring.color;ctx.globalAlpha=(1-phase)*.85;ctx.lineWidth=2;
          ctx.beginPath();ctx.ellipse(ring.x,ring.y,3+phase*20,2+phase*10,0,0,Math.PI*2);ctx.stroke();ctx.restore();
        }
        motion?.end();
        return animating || rings.length>0 || travels.size>0;
      },
    };
  };
})();
