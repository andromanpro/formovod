(() => {
  globalThis.mountFormovodPanel=(shadow,overlay,actors,asset,speed,signal)=>{
    const $=s=>shadow.querySelector(s),dialog=document.createElement('dialog');
    const css=document.createElement('style');
    css.textContent=`
      dialog.fv-settings{box-sizing:border-box;width:min(640px,94vw);max-height:88vh;overflow:auto;color-scheme:dark;padding:0;border:1px solid #a7895f;border-radius:13px;background:linear-gradient(140deg,#302c24,#1c1e1c);color:#f8edd8;box-shadow:0 22px 80px #000a}
      dialog.fv-settings[open]{position:fixed;inset:50% auto auto 50%;margin:0;transform:translate(-50%,-50%);z-index:9}
      dialog.fv-settings[data-working=true]{inset:var(--fv-top) var(--fv-left) auto auto;transform:none;width:var(--fv-side);max-height:calc(100vh - var(--fv-top) - var(--fv-bottom))}
      :host(.office-open)::after{content:'';position:fixed;inset:0;background:#100d0a85;z-index:2;pointer-events:none}
      .fv-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;background:#252520;border-bottom:1px solid #66563f}
      .fv-heading h2{font:600 22px Bahnschrift,'Segoe UI',sans-serif;margin:0}.fv-settings[data-working=true] .fv-heading h2{font-size:18px}
      .fv-choices,.fv-speech{margin:0 18px;padding:15px 0;border:0;border-bottom:1px solid #574e40;display:grid;gap:12px}
      .fv-settings label{display:grid;gap:5px;font-size:13px;color:#ecddc7}.fv-settings input{accent-color:#d4a05d}
      .fv-settings select{width:100%;min-width:0}.fv-speech h3{font:600 17px Bahnschrift,'Segoe UI',sans-serif;margin:0;color:#f6d49c}
      .fv-local-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:9px}
      .fv-install-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.fv-install-row small,.fv-route{color:#d0c1ab;font-size:12px}
      .fv-route{margin:0;overflow-wrap:anywhere}.fv-diagnostics{margin:13px 18px;font-size:13px}.fv-diagnostics summary{cursor:pointer}.fv-diagnostics p{margin:5px 0}.fv-settings .metal{color:#ffedd3}
      .architect span{white-space:normal;overflow-wrap:anywhere}.result{white-space:pre-wrap;overflow-wrap:anywhere}
      .fv-stop{min-height:39px;color:#ffddc8;border-color:#a46149}.send-row [hidden]{display:none}
      .fv-bases{margin:0 0 9px}.fv-basebar{display:flex;gap:6px}.fv-basebar button:first-child{flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .fv-base-editor{padding:9px 0 2px;display:grid;gap:7px}.fv-base-editor label{display:grid;gap:3px;font-size:12px;color:#e2d7bd}
      .fv-base-editor select,.fv-base-editor input{box-sizing:border-box;min-width:0;width:100%;padding:5px}
      .fv-base-editor [hidden],.fv-bases [hidden],.fv-settings [hidden]{display:none}.fv-base-error{font-size:12px;color:#ffccaa}
      .fv-voice-hint{display:block;margin-top:6px;color:#f3d59d;font-size:12px}.fv-voice-hint:empty{display:none}
      #mic[aria-pressed=true]{outline:2px solid #ffc26e;outline-offset:1px}
    `;
    shadow.append(css);
    const button=document.createElement('button');
    button.type='button';button.className='metal fv-settings-open';button.textContent='Настройки';$('.transport').append(button);
    dialog.className='fv-settings';
    dialog.innerHTML=`<div class="fv-heading"><h2>Настройки Формовода</h2><button type="button" class="metal" id="fv-close">Закрыть</button></div>
      <div class="fv-choices"><label>Модель Codex по умолчанию<select class="metal" id="fv-model"></select></label>
      <button type="button" class="metal" id="fv-model-settings">Модели, роли и прокси</button>
      <label><span><input type="checkbox" id="fv-guides"> Показывать линии от работников к целям</span></label></div>
      <section class="fv-speech"><h3>Распознавание речи</h3>
      <label>Способ диктовки<select class="metal" id="fv-voice-mode"><option value="auto">Автоматически</option><option value="local">Whisper на компьютере</option><option value="browser">Служба браузера</option><option value="windows">Диктовка Windows · Win + H</option></select></label>
      <div class="fv-local-grid"><label>Локальная модель<select class="metal" id="fv-voice-model"><option value="tiny">Tiny · 75 МБ</option><option value="base">Base · 145 МБ</option><option value="small">Small · 485 МБ</option></select></label>
      <label>Язык<select class="metal" id="fv-language"><option value="ru">Русский</option><option value="en">Английский</option><option value="auto">Автоопределение Whisper</option></select></label>
      <label>Пауза до конца записи<select class="metal" id="fv-silence"><option value="850">Короткая · 0,85 с</option><option value="1450">Обычная · 1,45 с</option><option value="2200">Длинная · 2,2 с</option></select></label></div>
      <div class="fv-install-row"><button class="metal" type="button" id="fv-install-voice">Скачать и настроить Whisper</button><small id="fv-setup-state" role="status"></small></div>
      <p class="fv-route fv-voice-engine"></p>
      <label><span><input type="checkbox" id="fv-voice-auto" checked> Отправлять после окончания диктовки</span></label></section>
      <details class="fv-diagnostics"><summary>Подключение и журнал</summary>
      <p class="fv-route" id="fv-model-route"></p><p class="fv-route" id="fv-voice-path"></p><p class="fv-route fv-journal"></p></details>`;
    shadow.append(dialog);
    let actionTimer=0,externalWork=false;
    document.addEventListener('testpilot:activity',e=>{
      clearTimeout(actionTimer);
      externalWork=true;dialog.dataset.working='true';
      if(e.detail?.state!=='running')actionTimer=setTimeout(()=>{externalWork=false},700);
    },{signal});
    button.onclick=()=>{if(dialog.open)dialog.close();else dialog.show()};
    dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();dialog.close();button.focus()}});
    for(const name of ['keydown','keypress','keyup','input','pointerdown','click'])
      dialog.addEventListener(name,e=>e.stopPropagation(),{signal});
    $('#fv-close').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>shadow.host.classList.remove('office-open'));
    $('form').hidden=false;$('#task').value='';$('#task').placeholder='Что сделать в 1С?';
    const model=$('#fv-model'),guides=$('#fv-guides'),submit=$('.send'),result=$('.result');
    const mic=$('#mic'),input=$('#task'),auto=$('#fv-voice-auto');
    const hint=document.createElement('small');hint.className='fv-voice-hint';hint.setAttribute('role','status');
    $('form').append(hint);
    let version='',ready=false,busy=false,outbox=null,settings=null;
    let recognition=null,revision=0,sentRevision=0,source='field';
    let localVoice=false,voiceClip=null;
    const method=$('#fv-voice-mode'),weights=$('#fv-voice-model'),language=$('#fv-language'),silence=$('#fv-silence');
    const install=$('#fv-install-voice'),setupState=$('#fv-setup-state');
    let installRequest=null;
    install.onclick=e=>{if(e.isTrusted&&!install.disabled){installRequest=weights.value;install.disabled=true}};
    const composer=input.form;
    const bases=document.createElement('section');bases.className='fv-bases';
    bases.innerHTML=`<div class="fv-basebar"><button type="button" class="metal" id="fv-base-menu" aria-expanded="false">Базы</button>
      <button type="button" class="metal" id="fv-log" title="Журнал поручений">Журнал</button></div>
      <div class="fv-base-editor" hidden><label>Подключение<select id="fv-bases" class="metal"></select></label>
      <button type="button" class="metal" id="fv-scan-bases">Обновить список публикаций</button>
      <label hidden>Название базы<input id="fv-base-name" maxlength="80" autocomplete="off"></label>
      <label hidden>Адрес веб-клиента<input id="fv-base-url" type="url" placeholder="https://server/erp/" autocomplete="off"></label>
      <button type="button" class="metal" id="fv-connect">Подключить</button></div>
      <div class="fv-base-error" role="status"></div>`;
    $('.panel').prepend(bases);
    const menu=$('#fv-base-menu'),editor=$('.fv-base-editor'),choices=$('#fv-bases'),go=$('#fv-connect');
    const baseName=$('#fv-base-name'),url=$('#fv-base-url'),notice=$('.fv-base-error');
    let showLog=false,showModels=false,scanBases=false,connection=null,parked=false,current='',baseVersion='',connecting=false;
    $('#fv-scan-bases').onclick=e=>{if(e.isTrusted)scanBases=true};
    $('#fv-model-settings').onclick=e=>{if(e.isTrusted)showModels=true};
    for(const event of ['keydown','keypress','keyup','input','beforeinput','paste','click','pointerdown'])
      bases.addEventListener(event,e=>e.stopPropagation(),{signal});
    function expand(open){editor.hidden=!open;menu.setAttribute('aria-expanded',String(open))}
    function fields(){baseName.parentElement.hidden=url.parentElement.hidden=choices.value!==''}
    choices.onchange=()=>{fields();notice.textContent=''};
    menu.onclick=e=>{
      if(!e.isTrusted)return;
      if(parked){connection={url:current};return}
      expand(editor.hidden);
    };
    $('#fv-log').onclick=e=>{if(e.isTrusted)showLog=true};
    go.onclick=e=>{
      if(!e.isTrusted||busy||recognition||outbox||connecting)return;
      if(!choices.value&&(!baseName.value.trim()||!url.value.trim())){notice.textContent='Введите название и адрес веб-клиента.';return}
      connection=choices.value?{url:choices.value}:{name:baseName.value.trim(),url:url.value.trim()};
      connecting=true;go.disabled=true;notice.textContent='Подключаю базу…';
    };
    const stop=document.createElement('button');
    stop.type='button';stop.id='fv-stop';stop.className='metal fv-stop';
    stop.textContent='Остановить поручение';stop.hidden=true;submit.after(stop);
    let activeJob='',stopRequest='';
    stop.addEventListener('pointerdown',e=>e.preventDefault(),{signal});
    stop.onclick=e=>{
      if(!e.isTrusted||!activeJob||stopRequest)return;
      returnToDraft=false;stopRequest=activeJob;overlay.dataset.stopJob=activeJob;
      stop.disabled=true;stop.textContent='Останавливаю…';result.textContent='Останавливаю поручение…';
    };
    let returnToDraft=false,formClick=null;
    // A real operator click in 1C hands the keyboard back to the form. A click
    // issued by this panel's MCP job only borrows focus until the job finishes.
    document.addEventListener('testpilot:activity',({detail:a})=>{
      if(!a || !['click','select'].includes(a.action))return;
      if(a.state==='running')formClick=a;
      else if(a.id===formClick?.id)formClick=null;
    },{signal});
    window.addEventListener('pointerdown',e=>{
      if(!e.isTrusted)return;
      const path=e.composedPath();
      if(path.includes(shadow.host)){returnToDraft=path.includes(composer);return}
      if(formClick?.ref && path.some(n=>n.dataset?.testpilotMcp===formClick.ref))return;
      const point=formClick?.position;
      if(point && Math.abs(e.clientX-point.x)<1 && Math.abs(e.clientY-point.y)<1)return;
      returnToDraft=false;
    },{capture:true,signal});
    input.addEventListener('focus',()=>{returnToDraft=true},{signal});
    composer.addEventListener('keydown',e=>{if(e.key==='Tab')returnToDraft=false},{signal});
    function restoreDraftFocus(){
      if(returnToDraft && !busy && !dialog.contains(shadow.activeElement) && document.hasFocus() && !document.hidden && shadow.activeElement!==input){
        input.focus({preventScroll:true});
      }
    }
    function buttons(){
      submit.disabled=!ready||busy||Boolean(outbox||recognition)||!input.value.trim();
      mic.disabled=Boolean(outbox);
    }
    const retry=document.createElement('button');retry.type='button';retry.className='metal';retry.textContent='Обновить модели';
    $('.fv-choices').append(retry);retry.hidden=true;let reload=false;retry.onclick=e=>{if(e.isTrusted)reload=true};
    submit.disabled=true;result.textContent='Подключаю пульт…';
    function changed(){
      settings={model:model.value,showGuides:guides.checked,voiceAuto:auto.checked,
        voiceMode:method.value,voiceModel:weights.value,voiceLanguage:language.value,voicePause:Number(silence.value)};
      const flag=guides.checked?'1':'0';
      if(overlay.dataset.showGuides!==flag)overlay.dataset.showGuides=flag;
    }
    for(const control of [model,guides,auto,method,weights,language,silence])control.onchange=changed;
    function queueDraft(){
      if(!ready||busy||outbox||recognition||connecting||parked)return;
      if(overlay.dataset.brigadePaused==='1'){hint.textContent='Пульт на паузе. Поручение осталось в поле.';return}
      const text=input.value.trim();
      if(!text||text.length>input.maxLength)return;
      outbox={id:crypto.randomUUID(),text,model:model.value,source};
      restoreDraftFocus();
      sentRevision=revision;hint.textContent='';buttons();result.textContent='Отправляю поручение…';
    }
    function submitTask(event){
      event.preventDefault();
      if(event.isTrusted)queueDraft();
    }
    mic.setAttribute('aria-label','Надиктовать поручение');mic.title='Надиктовать поручение';
    mic.setAttribute('aria-pressed','false');
    const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    const windowsHint='Для диктовки Windows нажмите Win + H. Текст можно проверить и отправить кнопкой.';
    mic.onclick=event=>{
      if(!event.isTrusted||outbox)return;
      input.focus();
      if(recognition){recognition.stop();return}
      if(method.value==='windows'){hint.textContent=windowsHint;return}
      if(method.value==='local'&&!localVoice){hint.textContent='Откройте настройки распознавания и установите выбранную модель Whisper. Для записи нужен доступ к микрофону.';return}
      const useLocal=localVoice && method.value!=='browser';
      if(!useLocal&&!Recognition){hint.textContent=windowsHint;return}
      const voiceModel=weights.value,voiceLanguage=language.value;
      const session=useLocal?globalThis.createFormovodLocalVoice(clip=>{voiceClip={...clip,model:voiceModel,language:voiceLanguage}},message=>{hint.textContent=message},Number(silence.value)):new Recognition();
      const voiceSource=useLocal?'local_whisper':'browser_speech';
      const accepted=new Set(),sendOnEnd=auto.checked&&!busy&&ready;
      let failed=false;
      recognition=session;session.lang=voiceLanguage==='auto'?navigator.language:voiceLanguage==='ru'?'ru-RU':'en-US';session.continuous=false;session.interimResults=false;
      session.onresult=e=>{
        if(recognition!==session||failed)return;
        for(let i=e.resultIndex;i<e.results.length;i++){
          const words=e.results[i][0]?.transcript?.trim();
          if(!e.results[i].isFinal||!words||accepted.has(i))continue;
          accepted.add(i);
          const left=input.value.slice(0,input.selectionStart),right=input.value.slice(input.selectionEnd);
          const prefix=/[\p{L}\p{N}.,!?]$/u.test(left)&&/^[\p{L}\p{N}]/u.test(words)?' ':'';
          const suffix=/^[\p{L}\p{N}]/u.test(right)?' ':'';
          const insert=prefix+words+suffix;
          if(left.length+insert.length+right.length>input.maxLength){
            failed=true;hint.textContent='Поручение слишком длинное. Сократите текст.';break;
          }
          source=(!left&&!right)||source===voiceSource?voiceSource:'mixed';
          input.setRangeText(insert,input.selectionStart,input.selectionEnd,'end');revision++;
        }
      };
      session.onerror=e=>{
        if(recognition!==session)return;
        failed=true;
        const reasons={'not-allowed':'Доступ к микрофону запрещён.','audio-capture':'Микрофон недоступен.',
          'network':'Служба распознавания браузера недоступна.','service-not-allowed':'Служба распознавания браузера недоступна.',
          'no-speech':'Речь не распознана.','local-error':'Локальный распознаватель недоступен.'};
        hint.textContent=(reasons[e.error]||'Диктовка прервана.')+' '+windowsHint;
      };
      session.onend=()=>{
        if(recognition!==session)return;
        recognition=null;mic.setAttribute('aria-pressed','false');buttons();
        restoreDraftFocus();
        if(failed)return;
        hint.textContent=accepted.size?'Проверьте текст и нажмите «Отправить».':'Речь не распознана. Попробуйте ещё раз.';
        if(accepted.size&&sendOnEnd&&auto.checked)queueDraft();
      };
      try{
        session.start();hint.textContent=useLocal?'Включаю микрофон…':'Говорите… Чтобы закончить, нажмите микрофон ещё раз.';
        mic.setAttribute('aria-pressed','true');buttons();
      }catch{recognition=null;hint.textContent=windowsHint;buttons()}
    };
    input.addEventListener('input',()=>{
      revision++;source=input.value&&source!=='field'?'mixed':'field';
      if(recognition){const active=recognition;recognition=null;voiceClip=null;active.abort();mic.setAttribute('aria-pressed','false')}
      hint.textContent='';buttons();
    }, {signal});
    submit.addEventListener('click',submitTask,{signal});
    input.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='Enter'&&!e.isComposing&&!e.repeat)submitTask(e)},{signal});
    $('#task').maxLength=12000;
    const api=state=>{
      const connect=connection,logRequest=showLog;connection=null;showLog=false;
      parked=Boolean(state.parked);
      const was=current;current=state.base||'';
      if(parked){
        ready=false;busy=state.busy;connecting=false;outbox=null;voiceClip=null;
        if(recognition){const active=recognition;recognition=null;active.abort();mic.setAttribute('aria-pressed','false')}
        activeJob='';stop.hidden=true;submit.hidden=false;submit.disabled=mic.disabled=true;
        expand(false);menu.textContent='Вернуть управление этой базе';menu.disabled=busy;notice.textContent='';
        result.textContent='Для поручений выбрана другая база.';return {connect,showLog:logRequest};
      }
      if(!connect)connecting=false;
      const optionsKey=JSON.stringify(state.bases||[]);
      if(baseVersion!==optionsKey||was!==current){
        const prior=choices.value;
        choices.replaceChildren(...(state.bases||[]).map(p=>new Option(p.name+(p.status==='offline'?' · нет ответа':''),p.url)),new Option('Добавить базу…',''));
        choices.value=was===current && !editor.hidden && [...choices.options].some(o=>o.value===prior)?prior:current;
        fields();baseVersion=optionsKey;
      }
      menu.textContent='База · '+((state.bases||[]).find(p=>p.url===current)?.name||current)+' ▾';menu.title=current;
      menu.disabled=false;go.disabled=Boolean(state.busy||outbox||recognition||connecting);
      if(!connecting)notice.textContent=state.baseError||'';
      $('#fv-scan-bases').disabled=Boolean(state.scanningBases);
      $('#fv-scan-bases').textContent=state.scanningBases?'Ищу публикации…':'Обновить список публикаций';
      const acceptedNow=Boolean(outbox && state.ack===outbox.id && state.accepted);
      if(outbox && state.ack===outbox.id){
        if(state.accepted && revision===sentRevision && input.value.trim()===outbox.text){
          input.value='';revision++;source='field';
        }
        outbox=null;
      }
      const options=JSON.stringify(state.models);
      if(version!==options){
        model.replaceChildren(...state.models.map(m=>new Option(m.label,m.id)));
        version=options;
      }
      const change=settings;settings=null;
      if(!change){
        model.value=state.model||'';guides.checked=Boolean(state.showGuides);auto.checked=Boolean(state.voiceAuto);
        method.value=state.voiceMode||'auto';weights.value=state.voiceModel||'small';language.value=state.voiceLanguage||'ru';silence.value=String(state.voicePause||1450);
      }
      const flag=guides.checked?'1':'0';
      if(overlay.dataset.showGuides!==flag)overlay.dataset.showGuides=flag;
      const deployed=Array.from(actors.values()).some(role=>role.card.dataset.deployed==='true');
      const jobFinished=busy&&!state.busy;
      ready=!state.routingError&&Boolean(state.assignedModel||model.value);busy=state.busy;dialog.dataset.working=String(busy||externalWork||deployed);
      activeJob=state.activeJob||'';
      if(stopRequest!==activeJob){stopRequest='';delete overlay.dataset.stopJob}
      const stopping=Boolean(stopRequest||state.stopping);
      submit.hidden=busy;stop.hidden=!busy;stop.disabled=!activeJob||stopping;
      stop.textContent=stopping?'Останавливаю…':'Остановить поручение';
      if(jobFinished || (acceptedNow && !busy))restoreDraftFocus();
      localVoice=Boolean(state.localVoice && navigator.mediaDevices?.getUserMedia &&
        globalThis.MediaRecorder?.isTypeSupported('audio/webm;codecs=opus') && globalThis.createFormovodLocalVoice);
      const engine=$('.fv-voice-engine');
      const usingWhisper=localVoice && ['local','auto'].includes(method.value);
      const engineName=usingWhisper?'Распознавание · Whisper '+weights.value+', на этом компьютере':
        method.value==='local'?(state.localVoice?'Whisper установлен. Для записи откройте веб-клиент по HTTPS или на localhost и разрешите микрофон.':'Установите выбранную локальную модель Whisper.'):
        method.value!=='windows'&&Recognition?'Распознавание · служба браузера':'Распознавание · диктовка Windows (Win + H)';
      const installing=Boolean(state.voiceInstalling||installRequest);
      install.disabled=installing||Boolean(recognition);weights.disabled=installing||Boolean(recognition);
      method.disabled=Boolean(recognition);
      language.disabled=auto.disabled=Boolean(recognition)||method.value==='windows';
      silence.disabled=Boolean(recognition)||!['local','auto'].includes(method.value);
      const caption=installing?'Установка…':state.localVoice?'Проверить локальный Whisper':'Скачать и настроить Whisper';
      if(install.textContent!==caption)install.textContent=caption;
      const setup=state.voiceSetup || (state.localVoice?'Модель установлена':'Движок и веса загружаются по кнопке.');
      if(setupState.textContent!==setup)setupState.textContent=setup;
      if(engine.textContent!==engineName)engine.textContent=engineName;
      if(voiceClip?.id===state.voiceAck)voiceClip=null;
      if(state.voiceResult && recognition?.id===state.voiceResult.id)recognition.receive(state.voiceResult);
      shadow.host.classList.toggle('office-open',dialog.open&&dialog.dataset.working!=='true');
      retry.hidden=state.models.length>0;
      buttons();model.disabled=busy||!state.models.length;
      const text=state.routingError || (stopping?'Останавливаю поручение…':outbox?'Отправляю поручение…':state.message);
      if(result.textContent!==text)result.textContent=text;
      const architect=$('.architect span');
      if(architect.textContent!==state.plan)architect.textContent=state.plan;
      const route=$('#fv-model-route');
      if(route.textContent!==state.route)route.textContent=state.route;
      const localPath=state.voicePath?'Локальный движок · '+state.voicePath:'';
      if($('#fv-voice-path').textContent!==localPath)$('#fv-voice-path').textContent=localPath;
      const log=$('.fv-journal'),path=state.journal?'Журнал поручений · '+state.journal:'';
      if(log.textContent!==path)log.textContent=path;
      const refresh=reload,installVoice=installRequest;reload=false;installRequest=null;
      const modelRequest=showModels;showModels=false;
      const scanRequest=scanBases;scanBases=false;
      return {connect,scanBases:scanRequest,showModels:modelRequest,showLog:logRequest,installVoice,job:outbox,stop:stopRequest,settings:change,refresh,voice:voiceClip,voiceRead:state.voiceResult?.id};
    };
    globalThis.__formovodPanel=api;
    signal.addEventListener('abort',()=>{clearTimeout(actionTimer);const active=recognition;recognition=null;active?.abort();
      if(globalThis.__formovodPanel===api)delete globalThis.__formovodPanel;},{once:true});
  };
})();
