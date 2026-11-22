(() => {
  const lens = {x:149, y:209, r:95, height:598};
  const pressAt = 290;
  const releaseAt = 430;
  const finishAt = 820;
  const clamp = p => Math.max(0, Math.min(1, p));
  const ease = p => p * p * (3 - 2 * p);

  globalThis.createFormovodInspection = ({asset, redraw, shadow, signal}) => {
    const lensImage = new Image();
    lensImage.addEventListener('load', redraw, {signal});
    lensImage.src = asset('inspection-lens');

    const style = document.createElement('style');
    style.textContent = `
      .fv-inspection[hidden] { display:none }
      .fv-inspection {
        position:relative; display:grid; grid-template-columns:minmax(0,1fr) 87px;
        padding:10px 7px 8px 12px; margin:9px 0 0; gap:4px; overflow:hidden;
        border:1px solid #ad9066; border-radius:7px; color:#27271e;
        background:linear-gradient(152deg,#faf0d9,#e4d4ad);
        font:12px/1.3 'Segoe UI',sans-serif; box-shadow:0 2px 5px #0006;
      }
      @media (max-height:960px) {
        .panel:has(> .fv-inspection:not([hidden])) .actor { grid-template-columns:56px minmax(0,1fr) }
        .panel:has(> .fv-inspection:not([hidden])) .house { width:56px }
      }
      .fv-inspection strong { display:block; font-size:13px }
      .fv-inspection p { margin:3px 0; overflow-wrap:anywhere }
      .fv-inspection dl { margin:4px 0 0; font-variant-numeric:tabular-nums }
      .fv-inspection dl div { display:flex; flex-wrap:wrap; column-gap:6px; justify-content:space-between }
      .fv-inspection dd { margin:0; font-weight:700; max-width:100%; overflow-wrap:anywhere }
      .fv-inspection-status { font-weight:700 }
      .fv-inspection[data-state=match] .fv-inspection-status { color:#12654f }
      .fv-inspection[data-state=mismatch] .fv-inspection-status { color:#8d3927 }
      .fv-inspection-stage { position:relative; align-self:end; height:110px; isolation:isolate; pointer-events:none }
      .fv-inspection-actor {
        position:absolute; display:block; width:84.6px; height:99.6px; left:0; bottom:0;
      }
      .fv-inspection-stage[data-printed=true]::before {
        content:'✓'; box-sizing:border-box; position:absolute; top:73px; left:2px;
        width:15px; height:10px; display:grid; place-items:center;
        color:#18694e; background:#1f8a6b18; border:1px solid #2c835e; border-radius:1px;
        font:700 9px/8px 'Segoe UI',sans-serif; transform:rotate(-5deg);
      }
      .fv-inspection-stage::after {
        content:''; position:absolute; bottom:0; left:20px; width:62px; height:5px;
        background:radial-gradient(ellipse,#4d3e2870,transparent 72%); z-index:-1;
      }
      .fv-inspection[data-state=mismatch] .fv-inspection-stage { visibility:hidden }
    `;
    const receipt = document.createElement('section');
    receipt.className = 'fv-inspection fv-receipt';
    receipt.hidden = true;
    receipt.setAttribute('aria-label', 'Наряд на сверку');
    receipt.innerHTML = `
      <div>
        <strong>Наряд на сверку</strong>
        <p data-inspection-label></p>
        <dl>
          <div><dt>Ожидалось</dt><dd data-inspection-expected></dd></div>
          <div><dt>Перечитано</dt><dd data-inspection-value></dd></div>
        </dl>
        <p class="fv-inspection-status" role="status"></p>
      </div>
      <div class="fv-inspection-stage" aria-hidden="true"><canvas class="fv-inspection-actor" width="564" height="664"></canvas></div>
    `;
    const panel = shadow.querySelector('.panel');
    panel.insertBefore(receipt, panel.querySelector('.result'));
    shadow.append(style);
    const stage = receipt.querySelector('.fv-inspection-stage');
    const actor = receipt.querySelector('.fv-inspection-actor');
    const actorCtx = actor.getContext('2d');
    const stampImage = new Image();
    stampImage.crossOrigin = 'anonymous';
    let stampPixels;
    const stampFrame = actorCtx.createImageData(actor.width, actor.height);
    const status = receipt.querySelector('.fv-inspection-status');
    const labelField = receipt.querySelector('[data-inspection-label]');
    const expectedField = receipt.querySelector('[data-inspection-expected]');
    const valueField = receipt.querySelector('[data-inspection-value]');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    stampImage.addEventListener('load', () => {
      actorCtx.drawImage(stampImage, 0, 0);
      stampPixels = actorCtx.getImageData(0, 0, actor.width, actor.height);
      if (receipt.dataset.state === 'match' && !receipt.hidden) renderStamp();
      redraw();
    }, {signal});
    stampImage.src = asset('inspection-stamp');
    let elapsed = finishAt;

    function draw(ctx, {x, y, rect, value, scale, p, flip}) {
      if (!lensImage.naturalWidth || !rect?.width || !rect.height ||
          !Number.isFinite(x) || !Number.isFinite(y) || !(scale > 0)) return false;
      const progress = clamp(p ?? 1);
      if (progress === 0) return false;
      const direction = flip ? -1 : 1;
      const settle = ease(progress);
      const factor = scale / lens.height;
      const cx = x + direction * (1 - settle) * scale * .18;
      const cy = y - (1 - settle) * scale * .1;
      const radius = lens.r * factor;
      const sample = [...String(value ?? '').trim()].slice(0, 2).join('');
      ctx.save();
      ctx.globalAlpha *= Math.min(1, progress * 4);
      if (sample && radius > 2) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#fbf2dc';
        ctx.fill();
        ctx.fillStyle = '#252820';
        ctx.font = `600 ${radius * 1.38}px "Segoe UI",sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(sample, cx, cy, radius * 1.76);
        ctx.restore();
      }
      ctx.translate(cx, cy);
      ctx.scale(direction * factor, factor);
      ctx.drawImage(lensImage, -lens.x, -lens.y);
      ctx.restore();
      return true;
    }

    function renderStamp() {
      const down = clamp(elapsed / pressAt);
      const up = clamp((elapsed - releaseAt) / (finishAt - releaseAt));
      const lift = (1 - down * down) * 43 + ease(up) * 36;
      if (stampPixels) {
        const original = stampPixels.data;
        const frame = stampFrame.data;
        frame.set(original);
        // Only the arm left of the shoulder moves. A tapered vertical offset
        // keeps the sleeve attached and the stamp base level as it descends.
        if (lift > 0) {
          for (let column = 0; column < 195; column++) {
            const amount = Math.round(lift * (1 - ease(clamp((column - 108) / 87))));
            if (amount === 0) continue;
            const top = column < 146 ? 249 : 254;
            const bottom = 420;
            // The area above the cut belongs to the head. Shift the arm beneath
            // those original pixels so the edge of the face stays fixed.
            for (let row = top; row < bottom; row++) {
              const offset = (row * actor.width + column) * 4;
              frame.fill(0, offset, offset + 4);
            }
            for (let row = top; row < bottom; row++) {
              const source = (row * actor.width + column) * 4;
              const dest = source - amount * actor.width * 4;
              if (frame[dest + 3]) continue;
              frame[dest] = original[source];
              frame[dest + 1] = original[source + 1];
              frame[dest + 2] = original[source + 2];
              frame[dest + 3] = original[source + 3];
            }
          }
        }
        actorCtx.putImageData(stampFrame, 0, 0);
      }
      const contacted = elapsed >= pressAt;
      receipt.dataset.phase = elapsed >= finishAt ? 'done' :
        elapsed >= releaseAt ? 'release' : contacted ? 'contact' : 'press';
      stage.dataset.printed = String(contacted && stampImage.naturalWidth > 0);
      if (contacted && status.textContent !== 'Совпало') status.textContent = 'Совпало';
    }

    function setReceipt({label, expected, value, match, context}) {
      labelField.textContent = [typeof context === 'string' ? context : '', label].filter(Boolean).join(' · ');
      expectedField.textContent = String(expected ?? '—');
      valueField.textContent = String(value ?? '—');
      receipt.hidden = false;
      receipt.dataset.state = match === true ? 'match' : 'mismatch';
      if (match === true) {
        status.textContent = 'Сверено';
        elapsed = reducedMotion.matches ? finishAt : 0;
        renderStamp();
      } else {
        elapsed = finishAt;
        receipt.dataset.phase = 'done';
        stage.dataset.printed = 'false';
        status.textContent = 'Расхождение';
      }
      redraw();
    }

    function tick(dt) {
      if (elapsed >= finishAt || receipt.hidden) return false;
      if ((!Number.isFinite(dt) || dt <= 0) && !reducedMotion.matches) return false;
      elapsed = reducedMotion.matches ? finishAt : Math.min(finishAt, elapsed + dt);
      renderStamp();
      return elapsed < finishAt;
    }

    function reset() {
      elapsed = finishAt;
      stage.dataset.printed = 'false';
      receipt.hidden = true;
      receipt.dataset.phase = 'idle';
      delete receipt.dataset.state;
    }

    signal.addEventListener('abort', () => {
      style.remove();
      receipt.remove();
    }, {once:true});
    return {draw, setReceipt, tick, reset};
  };
})();
