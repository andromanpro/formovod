chrome.action.onClicked.addListener(async tab => {
  if (!tab.id || !tab.url || !/^https?:/.test(tab.url)) return;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      files: ['visible-rect.js', 'overlay.js'],
    });
    await chrome.action.setBadgeText({tabId: tab.id, text: injection?.result === true ? 'ON' : ''});
  } catch {
    await chrome.action.setBadgeText({tabId: tab.id, text: ''});
  }
});
