(() => {
  // Audio stays between this isolated extension world and the local panel host.
  globalThis.createFormovodLocalVoice = (deliver, status, silenceMs=1450) => {
    const id=crypto.randomUUID();
    let stream,context,recorder,timer,closed=false,finishing=false,heard=false;
    function release(){
      clearInterval(timer);
      stream?.getTracks().forEach(track=>track.stop());
      if(context && context.state!=='closed')context.close().catch(()=>{});
    }
    function finish(error,text){
      if(closed)return;
      closed=true;release();
      if(error)session.onerror?.({error});
      if(text)session.onresult?.({resultIndex:0,results:[{isFinal:true,0:{transcript:text}}]});
      session.onend?.();
    }
    async function record(){
      try{
        stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true}});
        if(closed){stream.getTracks().forEach(track=>track.stop());return}
        context=new AudioContext();
        const meter=context.createAnalyser();
        meter.fftSize=2048;
        context.createMediaStreamSource(stream).connect(meter);
        await context.resume();
        if(closed)return;
        const samples=new Float32Array(meter.fftSize),chunks=[];
        recorder=new MediaRecorder(stream,{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:48000});
        recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
        recorder.onerror=()=>finish('audio-capture');
        recorder.onstop=()=>{
          release();
          if(closed)return;
          if(!heard){finish('no-speech');return}
          status('Распознаю речь на этом компьютере…');
          const read=new FileReader();
          read.onerror=()=>finish('audio-capture');
          read.onload=()=>{if(!closed)deliver({id,audio:read.result.split(',')[1]})};
          read.readAsDataURL(new Blob(chunks,{type:recorder.mimeType}));
        };
        recorder.start();status('Говорите… Чтобы закончить, сделайте паузу или нажмите микрофон.');
        const start=performance.now();
        let lastSound=start,loudFrames=0;
        timer=setInterval(()=>{
          meter.getFloatTimeDomainData(samples);
          let energy=0;for(const v of samples)energy+=v*v;
          const now=performance.now();
          if(Math.sqrt(energy/samples.length)>.009){
            lastSound=now;if(++loudFrames>=2)heard=true;
          }else loudFrames=0;
          if((heard && now-lastSound>silenceMs)||(!heard && now-start>9000)||now-start>45000)session.stop();
        },55);
      }catch(e){finish(e.name==='NotAllowedError'?'not-allowed':'audio-capture')}
    }
    const session={id,
      start(){record()},
      stop(){
        if(closed||finishing)return;
        finishing=true;clearInterval(timer);
        if(recorder?.state==='recording')recorder.stop();else finish('aborted');
      },
      abort(){if(closed)return;closed=true;if(recorder?.state==='recording')recorder.stop();release()},
      receive(reply){if(reply.id===id)finish(reply.error?'local-error':reply.text?null:'no-speech',reply.text)}
    };
    return session;
  };
})();
