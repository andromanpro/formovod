({query, limit, offset = 0, kind = '', bounds = false, position = null, targetRef = null, read = null}) => {
  const state = window.__testpilotVisualMcp ??= {
    prefix: Math.random().toString(36).slice(2, 10), next: 0, nodes: new WeakMap(),
  };
  const wanted = query.trim().toLocaleLowerCase('ru-RU');
  const items = [];
  let total = 0;
  let focused, atPoint;
  const clean = value => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const viewport = {width: innerWidth, height: innerHeight};
  const hit = position && document.elementFromPoint(position.x, position.y);
  const labelOf = node => clean(node.getAttribute('aria-label') || node.title ||
    node.querySelector?.('.tabsItemTitle[data-content]')?.dataset.content || node.innerText);
  const boxes = new WeakMap();
  const visibleBox = node => {
    if (boxes.has(node)) return boxes.get(node);
    const result = formovodVisibleRect(node);
    boxes.set(node,result);
    return result;
  };
  const visible = node => Boolean(visibleBox(node));
  const rowLabel = row => clean([...row.querySelectorAll(':scope > [colindex]')]
    .map(cell => clean(cell.innerText)).filter(Boolean).slice(0,3).join(' · '));
  const rowAddress = node => {
    const row = node.parentElement;
    return row?.matches('.gridLine[rowindex]') ? JSON.stringify([
      row.closest('.gridContent')?.id, row.getAttribute('rowindex'),
      node.getAttribute('colindex'), rowLabel(row),
    ]) : null;
  };
  function menuGroup(node) {
    for (let sibling=node.closest('.functionItem')?.previousElementSibling; sibling; sibling=sibling.previousElementSibling) {
      if (sibling.matches('.eAccentColor,[role=heading]')) return clean(sibling.textContent);
    }
    return '';
  }
  function commandIdentity(node) {
    if(node.matches('.functionItemBox'))return JSON.stringify([menuGroup(node),labelOf(node)]);
    if(node.matches('.staticTextHyper,[role=link]'))return JSON.stringify([node.id,clean(node.innerText)||labelOf(node)]);
    return null;
  }
  if (targetRef) {
    const selector = '[data-testpilot-mcp="' + CSS.escape(targetRef) + '"]';
    const node = document.querySelector(selector);
    const recorded = node && state.nodes.get(node);
    const valid = Boolean(recorded?.ref === targetRef && formovodTargetIsExposed(node,visibleBox(node),true) &&
      (!recorded.row || recorded.row === rowAddress(node)) &&
      (!recorded.command || recorded.command === commandIdentity(node)));
    if (!read) return valid;
    if (!valid) return null;
    const {actor, expected} = read;
    const value = (node.matches('input[type=checkbox], input[type=radio]') ? String(node.checked) :
      node.matches('input, textarea, select') ? node.value : node.innerText || node.title || '').trim();
    const normalize = text => text.trim().replace(/\s+/gu, ' ');
    const matches = expected === null ? null : normalize(value) === normalize(expected);
    document.dispatchEvent(new CustomEvent('testpilot:overlay', {detail: {
      kind: 'mark', selector, actor, matches, checkedValue: value, done: matches !== false,
      note: matches === null ? 'прочитано' : matches ? 'совпало' : 'расхождение',
    }}));
    return {value: value.slice(0, 500), matches};
  }
  const dialogs = [...document.querySelectorAll('dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true],.cloud.panelsBorder[id^=ps][id$=win]')]
    .filter(visible);
  const activeTab = document.querySelector('.openedItem.select, .openedItem[aria-selected=true]');
  function add(node, data) {
    const box = visibleBox(node);
    if (!box) return;
    if (data.kind !== 'table' && !formovodTargetIsExposed(node,box,true) && !(hit && node.contains(hit))) return;
    const row = data.kind === 'cell' ? rowAddress(node) : null;
    const previous = state.nodes.get(node);
    const command = commandIdentity(node);
    const ref = previous?.row === row && previous.command === command ? previous.ref : state.prefix + '-' + ++state.next;
    state.nodes.set(node, {ref,row,command});
    node.dataset.testpilotMcp = ref;
    const item = {ref, ...data};
    if (bounds || position) {
      item.bounds = {x:box.left, y:box.top, width:box.right-box.left, height:box.bottom-box.top};
    }
    if (node === document.activeElement) focused = item;
    if (hit && node.contains(hit) && (!atPoint || atPoint.node.contains(node))) atPoint = {node, item};
    if (kind && item.kind !== kind) return;
    if (!Object.values(data).some(value => String(value).toLocaleLowerCase('ru-RU').includes(wanted))) return;
    total++;
    if (total > offset && items.length < limit) items.push(item);
  }
  const controls = '.openedItem,button,[role=button],[role=tab],[role=menuitem],[role=link],.staticTextHyper,.btn,.cmd,.themeBox,.navigationItem,a[href],a.pressCommand,.submenuBlock,.functionItem .functionItemBox';
  for (const node of document.querySelectorAll(controls)) {
    if (node.closest('[id^=authWindow]')) continue;
    const name = /^form\d+_(?:popup_)?(.+)$/u.exec(node.id)?.[1];
    const label = (node.matches('.staticTextHyper') && clean(node.innerText)) || labelOf(node) || name;
    const kind = node.matches('.openedItem,.navigationItem,[role=tab]') ? 'tab' :
      node.matches('.themeBox') ? 'section' : node.matches('a[href]:not(.pressCommand),.functionItemBox,.staticTextHyper,[role=link]') ? 'link' : 'button';
    const group = node.matches('.functionItemBox') ? menuGroup(node) : '';
    if (label) add(node, {kind, label, ...(group ? {group} : {}), ...(name ? {name} : {}),
      ...(node.matches(':disabled,[aria-disabled=true]') ? {disabled: true} : {})});
  }
  for (const title of document.querySelectorAll('.tabsItem .tabsItemTitle[data-content]')) {
    const label = clean(title.dataset.content);
    if (label) add(title.closest('.tabsItem'), {kind: 'tab', label});
  }
  for (const node of document.querySelectorAll('.eddList > li[listindex],[role=option]')) {
    const label = labelOf(node);
    if (label) add(node, {kind: 'option', label});
  }
  for (const node of document.querySelectorAll('input:not([type=hidden]):not([type=password]), textarea, select')) {
    if (node.closest('[id^=authWindow]')) continue;
    const field = node.closest('.field');
    const labelNode = field?.id ? document.getElementById(field.id + '#title_text') : null;
    const name = node.id.replace(/^form\d+_/, '').replace(/_i\d+$/, '');
    const label = clean(labelNode?.innerText || node.getAttribute('aria-label') ||
      node.labels?.[0]?.innerText || node.placeholder || name);
    const fieldType = node.type;
    const toggled = ['checkbox', 'radio'].includes(fieldType);
    const cell=node===document.activeElement || node.closest('.gridContent') ? formovodEditorCell(node) : null;
    const grid=cell?.closest('.gridContent');
    const column=grid?.querySelector('.gridHead [colindex="'+CSS.escape(cell.getAttribute('colindex'))+'"]');
    add(node, {kind: 'field', label, name, value: toggled ? String(node.checked) : clean(node.value), fieldType,
      ...(column ? {table:grid.id.replace(/^grid_form\d+_/,''),rowIndex:Number(cell.parentElement.getAttribute('rowindex')),
        column:clean(column.innerText)} : {}),
      ...(toggled ? {checked:node.checked} : {}),
      ...(node.disabled || node.getAttribute('aria-disabled') === 'true' ? {disabled:true} : {}),
      ...(node.readOnly || node.getAttribute('aria-readonly') === 'true' ? {readonly:true} : {}),
    });
  }
  for (const grid of document.querySelectorAll('.gridContent')) {
    if (!visible(grid)) continue;
    const name = grid.id.replace(/^grid_form\d+_/, '');
    const headings = [...grid.querySelectorAll('.gridHead [colindex]')];
    const titles = new Map(headings.map(node => [node.getAttribute('colindex'), clean(node.innerText)]));
    if (!titles.size) {
      const text = grid.querySelector('.gridHead')?.innerText?.split('\n') ?? [];
      text.forEach((title, index) => titles.set(String(index), clean(title)));
    }
    const rows = [...grid.querySelectorAll('.gridBody .gridLine[rowindex]')].filter(visible);
    add(grid, {kind: 'table', name, columns: [...titles.values()].filter(Boolean), visibleRows: rows.length,
      ...(rows.length ? {firstRow: Number(rows[0].getAttribute('rowindex')),
        lastRow: Number(rows.at(-1).getAttribute('rowindex')),
        firstVisibleRow: rowLabel(rows[0]), lastVisibleRow: rowLabel(rows.at(-1))} : {}),
    });
    for (const row of rows) {
      const rowIndex = Number(row.getAttribute('rowindex'));
      const label = rowLabel(row);
      for (const cell of row.querySelectorAll(':scope > [colindex]')) {
        const col = cell.getAttribute('colindex');
        const column = titles.get(col) || 'Колонка ' + col;
        const value = clean(cell.innerText);
        if (value || titles.get(col)) {
          add(cell, {kind: 'cell', table: name, row: label, rowIndex, column, value});
        }
      }
    }
  }
  return {
    title: document.title, activeTab: activeTab && labelOf(activeTab), viewport,
    dialogs: dialogs.map(dialog => ({
      title: labelOf(dialog.querySelector('h1,h2,h3,[role=heading]') || dialog),
      text: (dialog.innerText||'').trim().replace(/\s+/gu,' ').slice(0,600),
    })),
    focused, items, matches: total, more: total > offset + items.length,
    ...(position ? {atPoint: atPoint?.item ?? null} : {}),
  };
}
