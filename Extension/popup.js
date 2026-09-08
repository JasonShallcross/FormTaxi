'use strict';

const STORAGE_KEY = 'formClipboard';
const copyButton = document.querySelector('#copy');
const pasteButton = document.querySelector('#paste');
const clearButton = document.querySelector('#clear');
const splitActions = document.querySelector('#split-actions');
const copyBackwardButton = document.querySelector('#copy-backward');
const copyForwardButton = document.querySelector('#copy-forward');
const backwardArrow = document.querySelector('#backward-arrow');
const forwardArrow = document.querySelector('#forward-arrow');
const backwardAction = document.querySelector('#backward-action');
const forwardAction = document.querySelector('#forward-action');
const clipboard = document.querySelector('#clipboard');
const clipboardTitle = document.querySelector('#clipboard-title');
const clipboardDetail = document.querySelector('#clipboard-detail');
const status = document.querySelector('#status');

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

function renderClipboard(payload) {
  const populated = Boolean(payload?.count);
  pasteButton.disabled = !populated;
  clearButton.hidden = !populated;
  clipboard.classList.toggle('empty', !populated);
  if (!populated) {
    clipboardTitle.textContent = 'Nothing copied yet';
    clipboardDetail.textContent = 'Copy values from any web form.';
    return;
  }
  clipboardTitle.textContent = payload.source?.hostname || 'Copied form';
  clipboardDetail.textContent = `${payload.count} ${payload.count === 1 ? 'field' : 'fields'} · ${formatTime(payload.copiedAt)}`;
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found.');
  return tab;
}

async function messageTab(tabId, message) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    throw new Error('This page cannot be accessed. Try a normal website tab.');
  }
}

async function messageCurrentTab(message) {
  const tab = await currentTab();
  return messageTab(tab.id, message);
}

async function splitContext() {
  const active = await currentTab();
  if (typeof active.splitViewId !== 'number' || active.splitViewId === -1) return null;
  const splitTabs = await chrome.tabs.query({ currentWindow: true, splitViewId: active.splitViewId });
  const ordered = splitTabs.filter((tab) => tab.id).sort((a, b) => a.index - b.index);
  return ordered.length === 2 ? { active, first: ordered[0], second: ordered[1] } : null;
}

async function inferSplitOrientation(context) {
  const { first } = context;
  if (!first.width || !first.height) return 'unknown';

  try {
    const window = await chrome.windows.get(first.windowId);
    if (!window.width || !window.height) return 'unknown';

    const widthFraction = first.width / window.width;
    const heightFraction = first.height / window.height;
    const difference = widthFraction - heightFraction;

    // Browser chrome makes the content height smaller than the outer window.
    // A generous dead zone avoids inventing a direction in unusual layouts.
    if (difference < -0.15) return 'horizontal';
    if (difference > 0.15) return 'vertical';
  } catch (_error) {
    // Orientation is cosmetic; both explicit directions still remain available.
  }

  return 'unknown';
}

function renderSplitOrientation(context, orientation) {
  const activeIsFirst = context.active.id === context.first.id;
  const arrows = orientation === 'vertical' ? ['↑', '↓'] : ['←', '→'];
  backwardArrow.textContent = arrows[0];
  forwardArrow.textContent = arrows[1];
  backwardAction.textContent = activeIsFirst ? 'Copy from other tab' : 'Copy to other tab';
  forwardAction.textContent = activeIsFirst ? 'Copy to other tab' : 'Copy from other tab';
}

async function performCopy() {
  setStatus('Reading form…');
  const response = await messageCurrentTab({ type: 'FORM_CLIPBOARD_COPY' });
  if (!response?.ok) throw new Error(response?.error || 'Could not read this form.');
  if (!response.payload.count) throw new Error('No copyable form fields found.');
  await chrome.storage.local.set({ [STORAGE_KEY]: response.payload });
  renderClipboard(response.payload);
  const assets = response.payload.skipped?.asset || 0;
  setStatus(`Copied ${response.payload.count} fields${assets ? ` · skipped ${assets} asset fields` : ''}.`);
}

async function performPaste() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const payload = stored[STORAGE_KEY];
  if (!payload) throw new Error('Copy some form values first.');
  setStatus('Applying values…');
  const response = await messageCurrentTab({ type: 'FORM_CLIPBOARD_PASTE', payload });
  if (!response?.ok) throw new Error(response?.error || 'Could not paste these values.');
  const { applied, missing, incompatible } = response.result;
  setStatus(`Pasted ${applied} fields${missing ? ` · ${missing} not found` : ''}${incompatible ? ` · ${incompatible} incompatible` : ''}.`);
}

async function performCopyBetween(source, target, destinationLabel) {
  const permitted = await chrome.permissions.request({
    origins: ['http://*/*', 'https://*/*']
  });
  if (!permitted) throw new Error('Chrome needs page access to update the other tab.');

  setStatus(`Copying ${destinationLabel}…`);
  const copied = await messageTab(source.id, { type: 'FORM_CLIPBOARD_COPY' });
  if (!copied?.ok || !copied.payload?.count) throw new Error(copied?.error || 'No copyable form fields found.');

  await chrome.storage.local.set({ [STORAGE_KEY]: copied.payload });
  renderClipboard(copied.payload);

  const pasted = await messageTab(target.id, { type: 'FORM_CLIPBOARD_PASTE', payload: copied.payload });
  if (!pasted?.ok) throw new Error(pasted?.error || 'Could not update the other tab.');
  const { applied, missing } = pasted.result;
  setStatus(`Copied ${applied} fields ${destinationLabel}${missing ? ` · ${missing} not found` : ''}.`);
}

async function run(action) {
  copyButton.disabled = true;
  copyBackwardButton.disabled = true;
  copyForwardButton.disabled = true;
  if (action === performPaste) pasteButton.disabled = true;
  try {
    await action();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    copyButton.disabled = false;
    copyBackwardButton.disabled = false;
    copyForwardButton.disabled = false;
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    pasteButton.disabled = !stored[STORAGE_KEY]?.count;
  }
}

copyButton.addEventListener('click', () => run(performCopy));
pasteButton.addEventListener('click', () => run(performPaste));
let currentSplitContext = null;
copyBackwardButton.addEventListener('click', () => {
  if (currentSplitContext) {
    run(() => performCopyBetween(currentSplitContext.second, currentSplitContext.first, 'towards the first tab'));
  }
});
copyForwardButton.addEventListener('click', () => {
  if (currentSplitContext) {
    run(() => performCopyBetween(currentSplitContext.first, currentSplitContext.second, 'towards the second tab'));
  }
});
clearButton.addEventListener('click', async () => {
  await chrome.storage.local.remove(STORAGE_KEY);
  renderClipboard(null);
  setStatus('Copied values cleared.');
});

(async () => {
  const [tab, stored, context] = await Promise.all([currentTab(), chrome.storage.local.get(STORAGE_KEY), splitContext()]);
  renderClipboard(stored[STORAGE_KEY]);
  currentSplitContext = context;
  splitActions.hidden = !context;
  if (context) renderSplitOrientation(context, await inferSplitOrientation(context));
})();
