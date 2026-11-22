// Used only in the private browser launched by the operator panel.
importScripts('background.js','managed-scripts.js');
chrome.tabs.onUpdated.addListener(async (id,change,tab)=>{
  if(change.status!=='complete'||!tab.url)return;
  const u=new URL(tab.url);
  const {publications=[]}=await chrome.storage.session.get('publications');
  if(!publications.some(p=>u.origin===p.origin && (u.pathname===p.path.slice(0,-1)||u.pathname.startsWith(p.path))))return;
  try{
    await chrome.scripting.executeScript({target:{tabId:id},files:formovodScripts});
  }catch{/* The operator may have closed the tab during navigation. */}
});
