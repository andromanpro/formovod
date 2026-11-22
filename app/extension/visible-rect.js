// CSS clipping for a form target. Both the MCP inspection and the painted gesture
// use the same viewport coordinates, including partially exposed grid columns.
function formovodVisibleRect(node) {
  if (!node?.isConnected || node.closest('[aria-hidden="true"], [inert]')) return null;
  const rect = node.getBoundingClientRect();
  let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
  let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
  if (left >= right || top >= bottom || getComputedStyle(node).visibility !== 'visible') return null;
  const clips = /^(auto|scroll|hidden|clip)$/u;
  for (let p=node.parentElement; p && p!==document.body; p=p.parentElement) {
    const style=getComputedStyle(p), horizontal=clips.test(style.overflowX), vertical=clips.test(style.overflowY);
    if (!horizontal && !vertical) continue;
    const edge=p.getBoundingClientRect();
    if (horizontal) {
      left=Math.max(left,edge.left+p.clientLeft);
      right=Math.min(right,edge.left+p.clientLeft+p.clientWidth);
    }
    if (vertical) {
      top=Math.max(top,edge.top+p.clientTop);
      bottom=Math.min(bottom,edge.top+p.clientTop+p.clientHeight);
    }
    if (left>=right || top>=bottom) return null;
  }
  return new DOMRect(left,top,right-left,bottom-top);
}

function formovodTargetIsExposed(node,rect,afterDock=false) {
  if (!rect) return false;
  const x=rect.left+rect.width/2,y=rect.top+rect.height/2;
  let hit=document.elementFromPoint(x,y);
  // The floating settings dialog docks beside the form as soon as an action starts.
  // Look past that dialog only, retaining 1C's own popups and the fixed control panel.
  if (afterDock && hit?.id==='formovod-brigade-dock' &&
      hit.shadowRoot?.elementFromPoint(x,y)?.closest('dialog[open]:not([data-working="true"])')) {
    hit=document.elementsFromPoint(x,y).find(element=>element!==hit);
  }
  return Boolean(hit && node.contains(hit));
}

function formovodEditorCell(input) {
  const inside = input.closest('.gridLine[rowindex] > [colindex]');
  if (inside?.closest('.gridContent[id]')) return inside;
  if (!input.closest('.gridContent') && input.closest('.field[id]')) return null;
  // 1C can position the editor as a sibling above the grid body.
  const editorRect = (input.closest('.field') ?? input).getBoundingClientRect();
  if (!editorRect.width || !editorRect.height) return null;
  const grid = input.closest('.gridContent');
  const y = editorRect.top + editorRect.height / 2;
  for (const x of [editorRect.left + 3, editorRect.left + editorRect.width / 2, editorRect.right - 3]) {
    if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) continue;
    for (const item of document.elementsFromPoint(x, y)) {
      const cell = item.closest('.gridLine[rowindex] > [colindex]');
      if (!cell?.closest('.gridContent[id]') || (grid && cell.closest('.gridContent') !== grid)) continue;
      const rect = cell.getBoundingClientRect();
      const overlap = Math.min(editorRect.right, rect.right) - Math.max(editorRect.left, rect.left);
      if (overlap >= Math.min(editorRect.width, rect.width) / 2) return cell;
    }
  }
  return null;
}
