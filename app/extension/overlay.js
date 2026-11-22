(() => {
  const isOneC = () => /^(?:1С:Предприятие|1C:Enterprise)$/iu.test(document.querySelector('meta[name="application-name"]')?.content||'');
  if (!isOneC()) return false;
  if (globalThis.__testpilotLiveWatch) return true;

  let installation;
  function keepOverlay() {
    if (installation?.host.isConnected || !isOneC()) return;
    installation?.events.abort();
    installation = mount();
  }
  // 1C replaces the document contents during authentication and startup.
  // The isolated content-script world remains attached to the tab.
  globalThis.__testpilotLiveWatch = setInterval(keepOverlay, 250);
  keepOverlay();
  return true;
})();

function mount() {
  const events = new AbortController();
  const roles = new Map([
    ['entry', {label: 'Ввод', color: '#2877ee'}],
    ['contract', {label: 'Договор', color: '#964de6'}],
    ['check', {label: 'Сверка', color: '#b86c16'}],
    ['price', {label: 'Цена', color: '#1769e6', tableRole: true}],
    ['quote', {label: 'Расценка', color: '#dc405e', tableRole: true}],
    ['counterparty', {label: 'Контрагент', color: '#167870'}],
    ['quantity', {label: 'Количество', color: '#087d91', tableRole: true}],
    ['product', {label: 'Номенклатура', color: '#8429d9', tableRole: true}],
    ['gtd', {label: 'ГТД', color: '#d72a61', tableRole: true}],
  ]);
  const host = document.createElement('div');
  host.id = 'testpilot-live-overlay';
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none',
  });
  const shadow = host.attachShadow({mode: 'closed'});
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, {width: '100%', height: '100%', display: 'block'});
  shadow.append(canvas);
  document.documentElement.append(host);
  const ctx = canvas.getContext('2d');
  const brigade = globalThis.mountFormovodBrigade?.(host, ctx, request, events.signal);
  const marks = new Map();
  const checks = new Map();
  const pending = new WeakMap();
  const typists = new WeakMap();
  const edits = new Map();
  const typeCalls = new Map();
  const sparks = [];
  const clicks = [];
  const duration = 480;
  let scheduled = false;
  let last = performance.now();
  let shakeAnimation;
  let shakingGrid;

  const visibleRect = target => {
    const rect = formovodVisibleRect(target);
    if (!rect) return null;
    const grid = target.closest('.gridContent');
    // During the compositor's translate animation the grid can briefly miss its own hit test.
    const animating = grid && grid === shakingGrid && shakeAnimation?.playState === 'running';
    return animating || formovodTargetIsExposed(target,rect) ? rect : null;
  };

  const identityColumns = new WeakMap();

  function displayValue(element) {
    if (element.matches('input[type=checkbox], input[type=radio]')) return String(element.checked);
    return (element.matches('input, textarea, select') ? element.value :
      element.innerText || element.title || '').trim();
  }

  function rowIdentity(grid, row, ignoreColumn) {
    const head = grid.querySelector('.gridHead');
    if (!head) return '';
    let columns = identityColumns.get(head);
    if (!columns) {
      columns = Array.from(head.querySelectorAll('[colindex]'))
        .filter(node => /^(номенклатура|артикул|код|наименование|характеристика)$/iu.test(node.textContent.trim()))
        .map(node => node.getAttribute('colindex'));
      identityColumns.set(head, columns);
    }
    const values = columns.filter(col => col !== ignoreColumn).map(col => {
      const cell = row.querySelector(':scope > [colindex="' + CSS.escape(col) + '"]');
      return cell?.getAttribute('title') || cell?.textContent.trim() || '';
    });
    return values.some(Boolean) ? JSON.stringify(values) : '';
  }

  function anchor(target, excludeEditedColumn = false) {
    const cell = target.closest('[colindex]');
    const row = cell?.closest('.gridLine[rowindex]');
    const grid = row?.closest('.gridContent[id]');
    if (!grid) return null;
    return {
      grid: grid.id, row: row.getAttribute('rowindex'), col: cell.getAttribute('colindex'),
      identity: rowIdentity(grid, row, excludeEditedColumn ? cell.getAttribute('colindex') : undefined),
      ...(excludeEditedColumn ? {excludeEditedColumn: true} : {}),
    };
  }

  function resolve(item) {
    if (!item.anchor) return item.element?.isConnected ? item.element : undefined;
    const {grid, row, col, identity, excludeEditedColumn} = item.anchor;
    const root = document.getElementById(grid);
    if (!root) return undefined;
    const original = item.element?.closest('[colindex]');
    const originalRow = original?.closest('.gridLine[rowindex]');
    const samePosition = original?.isConnected && originalRow?.closest('.gridContent') === root &&
      originalRow.getAttribute('rowindex') === row && original.getAttribute('colindex') === col;
    const cell = samePosition ? original : root.querySelector(
      `.gridLine[rowindex="${CSS.escape(row)}"] > [colindex="${CSS.escape(col)}"]`);
    if (!cell) return undefined;
    // Undefined means off screen or being rebuilt. Null means the address now identifies another row.
    if (identity) {
      const currentIdentity = rowIdentity(root, cell.parentElement, excludeEditedColumn ? col : undefined);
      if (!currentIdentity) return undefined;
      if (currentIdentity !== identity) return null;
    } else if (!samePosition) {
      return null;
    }
    if (item.element?.isConnected && cell.contains(item.element)) return item.element;
    return cell;
  }

  function editValue(value, numeric) {
    const plain = value.replace(/[\s\u00a0\u202f]+/gu, ' ').trim();
    const number = /^[+-]?(?:\d+|\d{1,3}(?: \d{3})+)(?:[.,]\d+)?$/u;
    if (!numeric || !number.test(plain.replace(/^−/u, '-'))) return plain;
    const clean = plain.replace(/^−/u, '-').replace(/ /gu, '');
    const [integer, decimal = ''] = clean.replace(/^[+-]/u, '').split(/[,.]/u);
    const whole = integer.replace(/^0+(?=\d)/u, '');
    const fraction = decimal.replace(/0+$/u, '');
    const sign = clean.startsWith('-') && (whole !== '0' || fraction) ? '-' : '';
    return sign + whole + (fraction ? '.' + fraction : '');
  }

  function rememberEdit(actor, input, ref) {
    if (!brigade || actor === 'check' || !ref || !input.matches('input, textarea')) return null;
    const previous = edits.get(actor);
    if (previous?.editor === input && previous.ref === ref && !previous.observation) return previous;
    const namedField = input.closest('.field[id]');
    const direct = formovodEditorCell(input);
    if (!direct && !namedField && !input.id) return null;
    if (!direct && input.closest('.gridContent')) return null;
    const address = direct ? anchor(direct, true) : null;
    const original = direct && !direct.contains(input) ? displayValue(direct) : displayValue(input);
    const column = address && document.getElementById(address.grid)
      ?.querySelector('.gridHead [colindex="' + CSS.escape(address.col) + '"]')?.textContent;
    const numeric = /^(decimal|numeric)$/u.test(input.inputMode) || input.type === 'number' ||
      /цен[аыуе]|стоимость|сумм[аыуе]|количество|расценк|ставк|тариф/iu.test(
        [input.id, namedField?.id, column].join(' ')) ||
      /^[+-]?(?:\d{1,3}(?:[\s\u00a0\u202f]+\d{3})+|\d+[.,]\d+)$/u.test(original);
    const edit = {actor, ref, editor: input, element: direct, anchor: address,
      fieldId: namedField?.id, editorId: input.id, numeric,
      original: editValue(original, numeric), waitingForType: typeCalls.get(actor) === ref};
    edits.set(actor, edit);
    if(address)brigade.observeGridEdit?.(actor, () => {
      const cell=editTarget(edit);
      if(!cell)return null;
      // The native editor can cover the cell until Enter closes it.
      if(input.isConnected && visibleRect(input) && formovodEditorCell(input)===cell)
        return formovodVisibleRect(cell);
      return visibleRect(cell);
    });
    return edit;
  }

  function editTarget(edit) {
    if (edit.anchor) return resolve(edit);
    if (edit.fieldId) {
      const field = document.getElementById(edit.fieldId);
      return field?.querySelector('input:not([type=hidden]), textarea, select') ?? field;
    }
    return document.getElementById(edit.editorId);
  }

  function invalidValue(target) {
    return Boolean(target?.closest('[aria-invalid="true"]') ||
      target?.querySelector?.('[aria-invalid="true"]') ||
      (target?.willValidate && !target.validity.valid));
  }

  function readAcceptedEdit(edit) {
    const target = editTarget(edit);
    if (!target || invalidValue(target) || (edit.editor.isConnected && invalidValue(edit.editor))) return null;
    if (edit.anchor && target.querySelector('input:not([type=hidden]), textarea')) {
      // An in-cell editor still supplies a draft, even after a transient focus change.
      if (Array.from(target.querySelectorAll('input:not([type=hidden]), textarea')).some(visibleRect)) return null;
    }
    const rect = visibleRect(target);
    return rect && editValue(displayValue(target), edit.numeric) === edit.expected ? rect : null;
  }

  function finishEdit(edit, now) {
    if (edit.observation) return;
    edit.expected = editValue(displayValue(edit.editor), edit.numeric);
    edit.observation = {lastPoll:now, elapsed:0, stable:0, matched:false};
    brigade.awaitingEdit?.(edit.actor, edit.ref);
    request();
  }

  function confirmEdits(now) {
    let waiting = false;
    for (const [actor, edit] of edits) {
      const observation = edit.observation;
      if (!observation) continue;
      // A synchronous ERP handler can occupy this thread for seconds. Only count
      // time in which the client could actually observe the committed field.
      const dt = Math.max(0, Math.min(80, now - observation.lastPoll));
      observation.lastPoll = now;
      waiting = true;
      if (edit.waitingForType) continue;
      observation.elapsed += dt;
      const editing = edit.editor === document.activeElement;
      if (!editing && edit.expected === edit.original) {
        forgetEdit(edit);
        continue;
      }
      const rect = editing ? null : readAcceptedEdit(edit);
      if (!rect) {
        observation.stable = 0;
        observation.matched = false;
        if (observation.elapsed >= 2000) {
          if (editing) {
            edit.observation = null;
            brigade.cancelEdit?.(actor, edit.ref);
          } else forgetEdit(edit);
        }
        continue;
      }
      if (observation.matched) observation.stable += dt;
      observation.matched = true;
      if (observation.stable < 160) continue;
      forgetEdit(edit, true);
      let valid = true;
      brigade.acceptEdit?.(actor, edit.ref, () => {
        if (!valid) return null;
        const current = readAcceptedEdit(edit);
        // A strike belongs to the visible location where this value was accepted.
        valid = Boolean(current && Math.abs(current.left - rect.left) < 1 &&
          Math.abs(current.top - rect.top) < 1 && Math.abs(current.right - rect.right) < 1 &&
          Math.abs(current.bottom - rect.bottom) < 1);
        return valid ? current : null;
      });
    }
    return waiting;
  }

  function forgetEdit(edit, accepted = false) {
    edits.delete(edit.actor);
    if (!accepted) brigade.cancelEdit?.(edit.actor, edit.ref);
    const mark = marks.get(edit.actor);
    if (mark?.ref === edit.ref) mark.typing = false;
  }

  function editForInput(input) {
    for (const edit of edits.values()) {
      if (edit.editor === input) return edit;
    }
    return null;
  }

  function request() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(paint);
  }

  function paint(now) {
    scheduled = false;
    if (!host.isConnected) return;
    const scale = devicePixelRatio || 1;
    const width = Math.round(innerWidth * scale);
    const height = Math.round(innerHeight * scale);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    brigade?.begin(now);
    const ease = 1 - Math.exp(-Math.max(0, Math.min(now - last, 50)) / 88);
    last = now;
    const workspaceTargets = host.dataset.workspace ? {} : null;
    for (const [key, check] of checks) {
      const target = resolve(check);
      if (target === undefined) {
        if (!check.anchor) checks.delete(key);
        continue;
      }
      if (target?.querySelector('input, textarea')) continue;
      if (!target || check.value !== displayValue(target)) {
        checks.delete(key);
        continue;
      }
      check.element = target;
      const rect = visibleRect(target);
      if (rect) checkBadge(rect, check.matches);
    }
    for (const [actor, mark] of marks) {
      const {color} = roles.get(actor);
      const active = resolve(mark);
      for (const item of mark.related) {
        const target = resolve(item);
        if (!target || target === active) continue;
        const rect = visibleRect(target);
        if (rect) frame(rect, 0, color, true);
      }
    }
    for (const [actor, mark] of marks) {
      const editor = mark.typing && edits.get(actor)?.editor === mark.element && visibleRect(mark.element);
      const target = editor ? mark.element : resolve(mark);
      if (target === null) {
        marks.delete(actor);
        continue;
      }
      const rect = editor || visibleRect(target);
      if (!rect) continue;
      const {label, color, tableRole} = roles.get(actor);
      const x = actor === 'entry' || tableRole ? Math.max(7, rect.x + Math.min(26, rect.width * .2)) :
        Math.min(innerWidth - 8, Math.max(7, rect.right - 11));
      const y = Math.max(7, rect.y + rect.height * .63);
      mark.x ??= Math.max(7, x + (actor === 'gtd' ? 80 : -80));
      mark.y ??= Math.max(7, y + (actor === 'product' ? 38 : -38));
      const dx = (x - mark.x) * ease;
      const dy = (y - mark.y) * ease;
      mark.x += dx;
      mark.y += dy;
      const age = now - (mark.glyphAt ?? -Infinity);
      const shake = age < 120 ? Math.sin(age * .13) * (1 - age / 120) * 3 : 0;
      if (mark.checkKey && !checks.has(mark.checkKey)) {
        marks.delete(actor);
        continue;
      }
      if (workspaceTargets && mark.ref) {
        workspaceTargets[actor] = {
          ref: mark.ref, x: Math.min(1, rect.right / innerWidth),
          y: Math.min(1, rect.bottom / innerHeight),
        };
      }
      const inBrigade = brigade?.target(actor, rect, mark, target);
      frame(rect, shake, mark.done ? '#139464' : mark.mismatch ? '#c23436' :
        inBrigade ? brigade.color(actor) : color, inBrigade && !mark.done && !mark.mismatch);
      if (inBrigade) continue;
      if (Math.hypot(mark.x - x, mark.y - y) > 10) {
        ctx.save();
        ctx.strokeStyle = color + 'bb';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(mark.x, mark.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.restore();
      }
      if (tableRole) trail(mark.x, mark.y, dx, dy, color);
      cursor(mark.x, mark.y, color, mark.note ? label + ' · ' + mark.note : label, tableRole);
    }
    const waitingForEdit = confirmEdits(now);
    const drawingBrigade = brigade?.draw(now);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const spark = sparks[i];
      const t = Math.max(0, now - spark.time) / duration * (brigade?.speed() ?? 1);
      if (t >= 1) sparks.splice(i, 1);
      else burst(spark, t);
    }
    for (let i = clicks.length - 1; i >= 0; i--) {
      const hit = clicks[i], t = Math.max(0, now - hit.time) / 370;
      if (t >= 1) clicks.splice(i, 1);
      else ripple(hit.x, hit.y, t, '#2877ee');
    }
    if (workspaceTargets) {
      const geometry = JSON.stringify(workspaceTargets);
      if (host.dataset.workspaceTargets !== geometry) host.dataset.workspaceTargets = geometry;
    }
    if (marks.size || checks.size || sparks.length || clicks.length || drawingBrigade || waitingForEdit) request();
  }

  function frame(rect, shake, color, queued = false) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(rect.x + shake, rect.y, rect.width, rect.height, 4);
    ctx.fillStyle = color + (queued ? '0e' : '21');
    ctx.fill();
    ctx.strokeStyle = color + (queued ? '96' : 'ff');
    ctx.lineWidth = queued ? 1.5 : 2.4;
    if (queued) ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.restore();
  }

  function checkBadge(rect, matches) {
    const x = Math.max(7, rect.left + 3);
    const y = Math.max(7, rect.top + 2);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = matches ? '#139464' : '#c23436';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.35;
    ctx.stroke();
    ctx.beginPath();
    if (matches) {
      ctx.moveTo(x - 3, y); ctx.lineTo(x - 1, y + 2); ctx.lineTo(x + 3, y - 2);
    } else {
      ctx.moveTo(x - 2, y - 2); ctx.lineTo(x + 2, y + 2);
      ctx.moveTo(x + 2, y - 2); ctx.lineTo(x - 2, y + 2);
    }
    ctx.stroke();
    ctx.restore();
  }

  function trail(x, y, dx, dy, color) {
    const speed = Math.hypot(dx, dy);
    if (speed < .9) return;
    const length = Math.min(72, speed * 5);
    const endX = x - dx / speed * length, endY = y - dy / speed * length;
    const gradient = ctx.createLinearGradient(endX, endY, x, y);
    gradient.addColorStop(0, color + '00');
    gradient.addColorStop(1, color + 'a0');
    ctx.save();
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.restore();
  }

  function cursor(x, y, color, label, tableRole) {
    ctx.save();
    ctx.translate(x, y);
    if (tableRole) ctx.scale(1.19, 1.19);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(21, 15);
    ctx.lineTo(13, 16);
    ctx.lineTo(18, 25);
    ctx.lineTo(13, 28);
    ctx.lineTo(8, 19);
    ctx.lineTo(2, 25);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1.6;
    ctx.fill();
    ctx.stroke();
    ctx.font = '600 13px system-ui, sans-serif';
    const width = ctx.measureText(label).width + 14;
    const tagX = x + (width + 25) * (tableRole ? 1.19 : 1) > innerWidth ? -width : 18;
    const tagY = y + 42 > innerHeight ? -29 : 20;
    ctx.beginPath();
    ctx.roundRect(tagX, tagY, width, 23, 5);
    ctx.fillStyle = '#13233d';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = 'white';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, tagX + 7, tagY + 12);
    ctx.restore();
  }

  function burst(spark, t) {
    ctx.save();
    ctx.globalAlpha = (1 - t) ** 1.1;
    if (t < .3) ripple(spark.x, spark.y, t / .3, '#ff9a2e', 14);
    for (const dot of spark.dots) {
      ctx.fillStyle = dot.color;
      const x = spark.x + dot.x * t, y = spark.y + dot.y * t + 22 * t * t;
      ctx.strokeStyle = dot.color;
      ctx.lineWidth = dot.r / 2;
      ctx.beginPath();
      ctx.moveTo(x - dot.x * .065, y - dot.y * .065);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, dot.r * (1 - .5 * t), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = '800 31px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#193b83';
    ctx.fillStyle = '#fff1ab';
    ctx.strokeText(spark.glyph, spark.x, spark.y - 64 * t);
    ctx.fillText(spark.glyph, spark.x, spark.y - 64 * t);
    ctx.restore();
  }

  function ripple(x, y, t, color, range = 32) {
    ctx.save();
    ctx.globalAlpha *= (1 - t) * .9;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3 - 1.5 * t;
    ctx.beginPath();
    ctx.arc(x, y, 4 + range * (1 - (1 - t) ** 2), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function point(input, glyph) {
    const caret = input.selectionStart;
    if (caret === null || caret < glyph.length) return null;
    const css = getComputedStyle(input);
    const rect = input.getBoundingClientRect();
    const left = parseFloat(css.paddingLeft) + parseFloat(css.borderLeftWidth);
    const right = parseFloat(css.paddingRight) + parseFloat(css.borderRightWidth);
    ctx.save();
    ctx.font = [css.fontStyle, css.fontWeight, css.fontSize, css.fontFamily].join(' ');
    const width = ctx.measureText(input.value).width;
    const prefix = ctx.measureText(input.value.slice(0, caret)).width;
    const glyphWidth = ctx.measureText(input.value.slice(caret - glyph.length, caret)).width;
    ctx.restore();
    const free = Math.max(0, rect.width - left - right - width);
    const align = css.textAlign === 'right' || css.textAlign === 'end' ? free :
      css.textAlign === 'center' ? free / 2 : 0;
    return {
      x: Math.min(rect.right - right, Math.max(rect.left + left,
        rect.left + left + align + prefix - glyphWidth / 2 - input.scrollLeft)),
      y: rect.top + rect.height / 2,
    };
  }

  function isEditable(input) {
    return (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) &&
      ['text', 'textarea', 'search'].includes(input.type) &&
      !input.closest('form[id^="authWindow"]') && !input.id.startsWith('authWindow') &&
      !input.autocomplete.startsWith('current-password') && !input.autocomplete.startsWith('new-password');
  }

  function flash(input, glyph) {
    const origin = point(input, glyph);
    if (!origin) return;
    const actor = typists.get(input) ?? 'entry';
    const previous = marks.get(actor);
    const glyphAt = performance.now();
    marks.set(actor, {...previous, element: input, related: previous?.related ?? [], done: false,
      glyphAt, markedAt: glyphAt});
    const roleColor = brigade?.color(actor);
    const colors = roleColor ? [roleColor, '#ffd089', '#fff1cc'] : ['#477deb', '#9744e7', '#ff8e2b', '#efb500'];
    const dots = Array.from({length: brigade ? 30 : 19}, (_, i) => {
      const angle = Math.random() * Math.PI;
      const speed = 30 + Math.random() * 66;
      return {x: Math.cos(angle) * speed, y: -Math.sin(angle) * speed,
        r: 1.4 + Math.random() * 2, color: colors[i % colors.length]};
    });
    if (sparks.length >= 12) sparks.shift();
    sparks.push({...origin, glyph, dots, time: glyphAt});
    const grid = input.closest('.gridContent');
    if (grid && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shakeAnimation?.cancel();
      shakingGrid = grid;
      shakeAnimation = grid.animate([
        {translate: '0 0'}, {translate: '-3px 1px'}, {translate: '3px -1px'},
        {translate: '-1px 0'}, {translate: '0 0'},
      ], {duration: 134, easing: 'ease-out'});
    }
    host.dataset.glyphs = String(Number(host.dataset.glyphs || 0) + 1);
    request();
  }

  document.addEventListener('input', event => {
    if (event.isTrusted && event.inputType === 'insertText' && event.data && isEditable(event.target)) {
      pending.delete(event.target);
      flash(event.target, [...event.data].at(-1));
    }
  }, {capture: true, signal: events.signal});

  document.addEventListener('focusout', event => typists.delete(event.target),
    {capture: true, signal: events.signal});

  document.addEventListener('blur', event => {
    // Capture before the grid's own blur handler can detach the input.
    const edit = editForInput(event.target);
    if (event.isTrusted && edit) finishEdit(edit, performance.now());
  }, {capture: true, signal: events.signal});

  document.addEventListener('testpilot:activity', event => {
    const activity = event.detail;
    if (!activity?.ref) return;
    const {actor, ref, action, state} = activity;
    if (action === 'type') {
      if (state === 'running') typeCalls.set(actor, ref);
      else if (typeCalls.get(actor) === ref) typeCalls.delete(actor);
    }
    const edit = edits.get(actor);
    if (!edit || edit.ref !== ref || (action !== 'type' && action !== 'key')) return;
    if (state === 'error') {
      forgetEdit(edit);
    } else if (action === 'type' && state === 'done') {
      edit.waitingForType = false;
      if (edit.editor !== document.activeElement) finishEdit(edit, performance.now());
    }
  }, {signal: events.signal});

  // The 1C decimal editor handles keys itself and updates its input's value
  // without emitting an input event. Confirm the changed value on keyup.
  document.addEventListener('keydown', event => {
    const input = event.target;
    const edit = editForInput(input);
    if (event.isTrusted && !event.isComposing && edit) {
      if (event.key === 'Escape') {
        forgetEdit(edit);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        finishEdit(edit, performance.now());
      }
    }
    if (event.isTrusted && !event.isComposing && !event.ctrlKey && !event.altKey && !event.metaKey &&
        [...event.key].length === 1 && isEditable(input)) {
      pending.set(input, {key: event.key, before: input.value});
    }
  }, {capture: true, signal: events.signal});

  document.addEventListener('keyup', event => {
    const input = event.target;
    const before = pending.get(input);
    if (!event.isTrusted || !before || before.key !== event.key) return;
    pending.delete(input);
    if (input.value !== before.before && input.value.slice(0, input.selectionStart).endsWith(event.key)) {
      flash(input, event.key);
    }
  }, {capture: true, signal: events.signal});

  document.addEventListener('pointerdown', event => {
    if (!event.isTrusted || event.button !== 0 ||
        !event.target.closest('.gridBox, .field, .btn, .openedItem, .eddList, .staticTextHyper, .functionItemBox, .themeBox, [role=link], a[href]') ||
        event.target.closest('form[id^="authWindow"]')) return;
    if (clicks.length >= 8) clicks.shift();
    clicks.push({x: event.clientX, y: event.clientY, time: performance.now()});
    request();
  }, {capture: true, signal: events.signal});

  document.addEventListener('testpilot:overlay', event => {
    const update = event.detail;
    if (!update || !roles.has(update.actor)) return;
    if (update.kind === 'clear') {
      marks.delete(update.actor);
      const edit = edits.get(update.actor);
      if (edit) forgetEdit(edit);
      typeCalls.delete(update.actor);
      if (update.actor === 'check') checks.clear();
      request();
      return;
    }
    if (update.kind !== 'mark' || typeof update.selector !== 'string' || update.selector.length > 240) return;
    let target;
    try {
      target = document.querySelector(update.selector);
      if (!target) return;
    } catch {
      return;
    }
    const mark = marks.get(update.actor);
    const typing = update.typing === true;
    const observed = typing ? rememberEdit(update.actor, target, target.dataset.testpilotMcp) : null;
    if (typing) typists.set(target, update.actor);
    const related = Array.isArray(update.related) ? update.related.slice(0, 8).flatMap(selector => {
      try {
        const element = document.querySelector(selector);
        return element ? [{element, anchor: anchor(element)}] : [];
      } catch {
        return [];
      }
    }) : mark?.related ?? [];
    const checked = update.actor === 'check' && typeof update.matches === 'boolean' &&
      typeof update.checkedValue === 'string';
    const address = anchor(target) ?? (typing ? observed?.anchor ?? mark?.anchor : null);
    const checkKey = checked && address?.identity ? JSON.stringify(address) : target;
    if (checked) {
      checks.set(checkKey, {element: target, anchor: address, matches: update.matches, value: update.checkedValue});
      if (checks.size > 100) checks.delete(checks.keys().next().value);
    }
    marks.set(update.actor, {
      x: mark?.x, y: mark?.y, element: target, related,
      ref: target.dataset.testpilotMcp,
      anchor: address,
      markedAt: performance.now(),
      note: typeof update.note === 'string' ? update.note.slice(0, 40) : '',
      typing: typing || Boolean(edits.get(update.actor)?.editor === target),
      done: update.done === true,
      mismatch: update.matches === false,
      checkKey: checked ? checkKey : null,
    });
    request();
  }, {signal: events.signal});
  return {host, events};
}
