# FormTaxi

A privacy-friendly Chrome extension that picks up form values in one tab and drops them off in another. Values stay inside Chrome extension storage and are never sent anywhere.

## Install

1. Unzip the download.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose the unzipped `form-clipboard` folder.
5. Pin **FormTaxi** from Chrome's Extensions menu.

## Use

Open the source form and choose **Copy Values**. Open the destination form—whether in another tab, another window, or Chrome Split View—and choose **Paste Values**.

When a Chrome Split View is active, the popup shows **Copy to other tab** and **Copy from other tab**. Both are relative to the focused pane, so you can push its values to the other form or pull the other form's values into it. Chrome asks for additional website access the first time you use these shortcuts because the extension must update tabs you did not directly invoke it on.

Split View transfers appear first in the popup. The standard Copy/Paste clipboard actions remain available underneath for workflows involving separate tabs or windows.

The buttons always retain their physical order: left/up transfer first and right/down transfer second. The **to/from** labels change with the focused pane. The layout is inferred from pane-to-window dimensions and tab order because Chrome exposes the shared Split View ID but not the panes' physical positions.

## What it handles

- Text, number, date, email and similar inputs
- Textareas and Redactor editors
- Selects and multi-selects
- Single and grouped checkboxes
- Radio groups
- Repeated controls sharing the same `name`
- JavaScript-heavy forms, by using native property setters and dispatching `input` and `change`

Fields are matched by their exact HTML `name`. Passwords, file inputs, disabled controls, hidden controls and recognised asset-reference widgets are skipped. The extension never submits a form.

## Permissions

- `activeTab`: access only the page where you invoke the extension
- `scripting`: read or apply that page's form state
- `storage`: retain copied values until you replace or clear them

There is deliberately no broad all-sites host permission.

The split-tab shortcuts use optional website access. It is requested only when you choose one of them; the normal Copy/Paste workflow continues to use `activeTab`.
