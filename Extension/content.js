(() => {
  'use strict';

  if (globalThis.__formClipboardLoaded) return;
  globalThis.__formClipboardLoaded = true;

  const CONTROL_SELECTOR = 'input[name], textarea[name], select[name]';
  const REDACTOR_EDITABLE_SELECTOR = '[contenteditable="true"].redactor-styles, [contenteditable="true"].redactor-editor, [contenteditable="true"]';

  function isAssetControl(element) {
    return Boolean(
      element.closest('.core-asset, .core-asset-field, [data-asset-field]') ||
      element.classList.contains('core-asset-input') ||
      element.classList.contains('core-asset-model-field') ||
      element.classList.contains('core-asset-model-class') ||
      element.classList.contains('core-asset-model-id')
    );
  }

  function skipReason(element) {
    if (element.disabled) return 'disabled';
    if (isAssetControl(element)) return 'asset';
    if (element instanceof HTMLInputElement) {
      if (element.type === 'password') return 'password';
      if (element.type === 'file') return 'file';
      if (element.type === 'hidden') return 'hidden';
      if (['submit', 'reset', 'button', 'image'].includes(element.type)) return 'button';
    }
    return null;
  }

  function allNamedControls() {
    return Array.from(document.querySelectorAll(CONTROL_SELECTOR));
  }

  function groupControls() {
    const groups = new Map();
    for (const element of allNamedControls()) {
      const name = element.name;
      if (!name) continue;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(element);
    }
    return groups;
  }

  function copyableControls(elements) {
    // A hidden default immediately alongside a checkbox/radio is deliberately
    // ignored; the visible control represents the logical field.
    return elements.filter((element) => !skipReason(element));
  }

  function redactorEditable(textarea) {
    const adjacentContainer = textarea.nextElementSibling?.matches?.('.rx-container') ? textarea.nextElementSibling : null;
    const container = adjacentContainer || textarea.parentElement?.querySelector('.rx-container');
    const currentEditor = container?.querySelector('.rx-editor[contenteditable="true"]');
    if (currentEditor) return currentEditor;

    const adjacentBox = textarea.nextElementSibling?.matches?.('.redactor-box') ? textarea.nextElementSibling : null;
    const box = textarea.closest('.redactor-box') || adjacentBox || textarea.parentElement?.querySelector('.redactor-box');
    return box?.querySelector(REDACTOR_EDITABLE_SELECTOR) || null;
  }

  function readTextValue(element) {
    if (element instanceof HTMLTextAreaElement) {
      const editor = redactorEditable(element);
      if (editor) return { value: element.value, html: editor.innerHTML, editor: 'redactor' };
    }
    return { value: element.value };
  }

  function serialiseGroup(name, elements) {
    const copyable = copyableControls(elements);
    if (!copyable.length) return null;

    const checkboxes = copyable.filter((el) => el instanceof HTMLInputElement && el.type === 'checkbox');
    if (checkboxes.length) {
      if (checkboxes.length === 1) {
        return { name, type: 'checkbox', checked: checkboxes[0].checked, value: checkboxes[0].value };
      }
      return {
        name,
        type: 'checkbox-group',
        values: checkboxes.filter((el) => el.checked).map((el) => el.value)
      };
    }

    const radios = copyable.filter((el) => el instanceof HTMLInputElement && el.type === 'radio');
    if (radios.length) {
      const selected = radios.find((el) => el.checked);
      return { name, type: 'radio', value: selected?.value ?? null };
    }

    const first = copyable[0];
    if (first instanceof HTMLSelectElement && first.multiple) {
      return {
        name,
        type: 'select-multiple',
        values: Array.from(first.selectedOptions, (option) => option.value)
      };
    }

    if (copyable.length > 1) {
      return { name, type: 'values', values: copyable.map(readTextValue) };
    }

    const data = readTextValue(first);
    return {
      name,
      type: data.editor || (first instanceof HTMLSelectElement ? 'select' : 'value'),
      ...data
    };
  }

  function extractState() {
    const groups = groupControls();
    const fields = {};
    const skipped = { asset: 0, password: 0, file: 0, disabled: 0, hidden: 0, button: 0 };

    for (const [name, elements] of groups) {
      const field = serialiseGroup(name, elements);
      if (field) fields[name] = field;
      for (const element of elements) {
        const reason = skipReason(element);
        if (reason) skipped[reason] += 1;
      }
    }

    return {
      version: 1,
      source: { url: location.href, title: document.title, hostname: location.hostname },
      copiedAt: Date.now(),
      fields,
      count: Object.keys(fields).length,
      skipped
    };
  }

  function nativeSet(element, property, value) {
    let prototype = Object.getPrototypeOf(element);
    while (prototype) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
      if (descriptor?.set) {
        descriptor.set.call(element, value);
        return;
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    element[property] = value;
  }

  function announceChange(element) {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setValue(element, value) {
    nativeSet(element, 'value', value ?? '');
    announceChange(element);
  }

  function setChecked(element, checked) {
    nativeSet(element, 'checked', Boolean(checked));
    announceChange(element);
  }

  function applyRedactor(textarea, field) {
    setValue(textarea, field.value ?? '');
    const editor = redactorEditable(textarea);
    if (editor && typeof field.html === 'string') {
      editor.innerHTML = field.html;
      announceChange(editor);
    }
  }

  function applyField(field, elements) {
    const targets = copyableControls(elements);
    if (!targets.length) return { status: 'skipped' };

    if (field.type === 'checkbox') {
      const checkbox = targets.find((el) => el instanceof HTMLInputElement && el.type === 'checkbox');
      if (!checkbox) return { status: 'incompatible' };
      setChecked(checkbox, field.checked);
      return { status: 'applied' };
    }

    if (field.type === 'checkbox-group') {
      const checkboxes = targets.filter((el) => el instanceof HTMLInputElement && el.type === 'checkbox');
      if (!checkboxes.length) return { status: 'incompatible' };
      const selected = new Set(field.values || []);
      checkboxes.forEach((checkbox) => setChecked(checkbox, selected.has(checkbox.value)));
      return { status: 'applied' };
    }

    if (field.type === 'radio') {
      const radios = targets.filter((el) => el instanceof HTMLInputElement && el.type === 'radio');
      if (!radios.length) return { status: 'incompatible' };
      radios.forEach((radio) => setChecked(radio, field.value !== null && radio.value === field.value));
      return { status: 'applied' };
    }

    if (field.type === 'select-multiple') {
      const select = targets.find((el) => el instanceof HTMLSelectElement && el.multiple);
      if (!select) return { status: 'incompatible' };
      const selected = new Set(field.values || []);
      Array.from(select.options).forEach((option) => { option.selected = selected.has(option.value); });
      announceChange(select);
      return { status: 'applied' };
    }

    if (field.type === 'values') {
      const values = field.values || [];
      targets.forEach((target, index) => {
        const item = values[index];
        if (!item) return;
        if (item.editor === 'redactor' && target instanceof HTMLTextAreaElement) applyRedactor(target, item);
        else setValue(target, item.value);
      });
      return { status: 'applied' };
    }

    const target = targets[0];
    if (field.type === 'redactor' && target instanceof HTMLTextAreaElement) applyRedactor(target, field);
    else setValue(target, field.value);
    return { status: 'applied' };
  }

  function applyState(payload) {
    if (!payload || payload.version !== 1 || !payload.fields) throw new Error('Copied data is not compatible.');

    const groups = groupControls();
    const result = { applied: 0, missing: 0, incompatible: 0, skipped: 0, total: Object.keys(payload.fields).length };

    for (const [name, field] of Object.entries(payload.fields)) {
      const elements = groups.get(name);
      if (!elements) {
        result.missing += 1;
        continue;
      }
      const outcome = applyField(field, elements);
      result[outcome.status] += 1;
    }
    return result;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message?.type === 'FORM_CLIPBOARD_COPY') sendResponse({ ok: true, payload: extractState() });
      else if (message?.type === 'FORM_CLIPBOARD_PASTE') sendResponse({ ok: true, result: applyState(message.payload) });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
})();
