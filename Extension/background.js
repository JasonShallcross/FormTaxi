'use strict';

const STORAGE_KEY = 'formClipboard';

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

async function showBadge(tabId, text, color) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 1800);
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab?.id) return;
  try {
    await ensureContentScript(tab.id);
    if (command === 'copy-form-values') {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'FORM_CLIPBOARD_COPY' });
      if (!response?.ok || !response.payload?.count) throw new Error('No form fields');
      await chrome.storage.local.set({ [STORAGE_KEY]: response.payload });
      await showBadge(tab.id, String(Math.min(response.payload.count, 99)), '#1e5b3b');
    }
    if (command === 'paste-form-values') {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      if (!stored[STORAGE_KEY]) throw new Error('Nothing copied');
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'FORM_CLIPBOARD_PASTE', payload: stored[STORAGE_KEY] });
      if (!response?.ok) throw new Error(response?.error || 'Paste failed');
      await showBadge(tab.id, '✓', '#1e5b3b');
    }
  } catch (_error) {
    await showBadge(tab.id, '!', '#a43b2a').catch(() => {});
  }
});
