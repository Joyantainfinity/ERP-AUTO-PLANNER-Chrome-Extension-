// ==============================
// Default starting list — used only the first time (before any customization
// is saved). After that, whatever the user edits is what's remembered.
// ==============================
const DEFAULT_SECTIONS = [
  { code: '93', name: 'Central Cutting' },
  { code: '10', name: 'Tie' },
  { code: '12', name: 'Screen Printing' },
  { code: '07', name: 'Field Receive and Distribution' },
  { code: '05', name: 'Washing' },
  { code: '34', name: 'Household-Sewing' },
  { code: '06', name: 'Ironing' }
];

let sections = [];

const listEl = document.getElementById('sectionList');
const addSectionBtn = document.getElementById('addSectionBtn');
const btn = document.getElementById('runBtn');
const statusEl = document.getElementById('status');

function saveSections() {
  chrome.storage.local.set({ customSections: sections });
}

function renderSections() {
  listEl.innerHTML = '';

  sections.forEach((sec, index) => {
    const row = document.createElement('div');
    row.className = 'section-row';

    const reorderDiv = document.createElement('div');
    reorderDiv.className = 'reorder-btns';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.textContent = '▲';
    upBtn.title = 'Move up';
    upBtn.disabled = index === 0;
    upBtn.addEventListener('click', () => {
      if (index === 0) return;
      [sections[index - 1], sections[index]] = [sections[index], sections[index - 1]];
      saveSections();
      renderSections();
    });

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.textContent = '▼';
    downBtn.title = 'Move down';
    downBtn.disabled = index === sections.length - 1;
    downBtn.addEventListener('click', () => {
      if (index === sections.length - 1) return;
      [sections[index + 1], sections[index]] = [sections[index], sections[index + 1]];
      saveSections();
      renderSections();
    });

    reorderDiv.appendChild(upBtn);
    reorderDiv.appendChild(downBtn);

    const codeInput = document.createElement('input');
    codeInput.className = 'code-input';
    codeInput.placeholder = 'Code';
    codeInput.value = sec.code;
    codeInput.addEventListener('input', () => {
      sections[index].code = codeInput.value.trim();
      saveSections();
    });

    const nameInput = document.createElement('input');
    nameInput.className = 'name-input';
    nameInput.placeholder = 'Section name';
    nameInput.value = sec.name;
    nameInput.addEventListener('input', () => {
      sections[index].name = nameInput.value.trim();
      saveSections();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remove this section';
    removeBtn.addEventListener('click', () => {
      sections.splice(index, 1);
      saveSections();
      renderSections();
    });

    row.appendChild(reorderDiv);
    row.appendChild(codeInput);
    row.appendChild(nameInput);
    row.appendChild(removeBtn);
    listEl.appendChild(row);
  });
}

addSectionBtn.addEventListener('click', () => {
  sections.push({ code: '', name: '' });
  saveSections();
  renderSections();
  const rows = listEl.querySelectorAll('.section-row');
  const lastRow = rows[rows.length - 1];
  const codeInput = lastRow && lastRow.querySelector('.code-input');
  if (codeInput) codeInput.focus();
});

// Load the saved section list (or fall back to the defaults) when the popup opens
chrome.storage.local.get(['customSections'], (data) => {
  if (data && Array.isArray(data.customSections) && data.customSections.length > 0) {
    sections = data.customSections;
  } else {
    sections = DEFAULT_SECTIONS.map((s) => ({ ...s }));
  }
  renderSections();
});

btn.addEventListener('click', async () => {
  // Only run rows that actually have both a code and a name filled in
  const activeSections = sections.filter((s) => s.code && s.name);
  if (activeSections.length === 0) {
    statusEl.innerHTML =
      '<div class="fail">Add at least one section (with both a code and a name) before running.</div>';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Running...';
  statusEl.textContent = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('No active tab found');

    // allFrames: true — because many ERP page grids can live inside an iframe
    const injection = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: runAutomationInPage,
      args: [activeSections]
    });

    // Multiple frames may have run the script — show the one with the most successes
    let result = null;
    let bestOkCount = -1;
    for (const frameResult of injection) {
      const r = frameResult && frameResult.result;
      if (!Array.isArray(r)) continue;
      const okCount = r.filter((x) => x.ok).length;
      if (okCount > bestOkCount) {
        bestOkCount = okCount;
        result = r;
      }
    }
    if (!Array.isArray(result)) throw new Error('No result returned from any frame');

    statusEl.innerHTML = result
      .map(
        (r) =>
          `<div class="${r.ok ? 'ok' : 'fail'}">${r.ok ? '✔' : '✘'} ${r.name} (${r.code})${
            r.error ? ' — ' + r.error : ''
          }</div>`
      )
      .join('');
  } catch (e) {
    statusEl.innerHTML = `<div class="fail">Something went wrong: ${(e && e.message) || e}</div>`;
  }

  btn.disabled = false;
  btn.textContent = 'Run on Planning Page ▶';
});

// ==============================
// Wages page — fill in Actual Wages, Payable Wages, Overhead Cost
// ==============================
const overheadInput = document.getElementById('overheadInput');
const runWagesBtn = document.getElementById('runWagesBtn');
const wagesStatusEl = document.getElementById('wagesStatus');

// Remember the last Overhead Cost value entered
chrome.storage.local.get(['lastOverheadCost'], (data) => {
  if (data && data.lastOverheadCost) {
    overheadInput.value = data.lastOverheadCost;
  }
});

runWagesBtn.addEventListener('click', async () => {
  const rawOverheadValue = overheadInput.value.trim();
  const parsedOverheadValue = parseFloat(rawOverheadValue);

  if (!rawOverheadValue || isNaN(parsedOverheadValue)) {
    wagesStatusEl.innerHTML = '<div class="fail">Please enter a valid number in the Overhead Cost box.</div>';
    return;
  }
  chrome.storage.local.set({ lastOverheadCost: rawOverheadValue });

  runWagesBtn.disabled = true;
  runWagesBtn.textContent = 'Running...';
  wagesStatusEl.textContent = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('No active tab found');

    // Send the RAW total — the injected function counts how many section rows
    // actually exist on the page and divides by that real count.
    const injection = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: runWagesAutomationInPage,
      args: [parsedOverheadValue]
    });

    let best = null;
    let bestCount = -1;
    for (const frameResult of injection) {
      const r = frameResult && frameResult.result;
      if (!r || !Array.isArray(r.results)) continue;
      if (r.results.length > bestCount) {
        bestCount = r.results.length;
        best = r;
      }
    }
    if (!best) throw new Error('No result returned from any frame');

    if (best.rowCount === 0) {
      wagesStatusEl.innerHTML =
        '<div class="fail">No wages rows found — are you on the right page?</div>';
    } else {
      const summaryLine = `<div class="hint" style="margin-top:0;margin-bottom:6px;">Overhead Cost per section: ${rawOverheadValue} ÷ ${best.rowCount} = <strong>${best.perSectionValue}</strong></div>`;
      wagesStatusEl.innerHTML =
        summaryLine +
        best.results
          .map(
            (r) =>
              `<div class="${r.ok ? 'ok' : 'fail'}">${r.ok ? '✔' : '✘'} ${r.section}${
                r.error ? ' — ' + r.error : ''
              }</div>`
          )
          .join('');
    }
  } catch (e) {
    wagesStatusEl.innerHTML = `<div class="fail">Something went wrong: ${(e && e.message) || e}</div>`;
  }

  runWagesBtn.disabled = false;
  runWagesBtn.textContent = 'Run on Wages Page ▶';
});

// ==========================================================================
// This function is injected into and runs inside the Wages page.
// Self-contained — cannot use variables from outside popup.js.
// totalOverheadValue is the RAW total the user typed in — this function counts
// the actual number of section rows found on the page and divides by THAT,
// so the split always matches reality (however many rows exist).
// ==========================================================================
async function runWagesAutomationInPage(totalOverheadValue) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none'
    );
  }

  // Mimic a real user: focus -> set value -> input/change events -> blur
  function setInputValue(input, value) {
    input.focus();
    const proto = window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    input.blur();
  }

  // Based on the HTML you sent, every section row follows this class pattern
  const candidateRows = document.querySelectorAll('.MuiListItem-button[role="button"]');
  const wageRows = [];

  for (const row of candidateRows) {
    if (!isVisible(row)) continue;
    // These 3 always appear in this order: Actual Wages, Payable Wages, Overhead Cost
    // (the Start Date box uses a different class — MuiInput-input, not MuiOutlinedInput-input)
    const outlinedInputs = row.querySelectorAll('input.MuiOutlinedInput-input');
    if (outlinedInputs.length < 3) continue; // not a wages row, skip
    wageRows.push({ row, outlinedInputs });
  }

  const rowCount = wageRows.length;
  if (rowCount === 0) {
    return { rowCount: 0, perSectionValue: '0.00', results: [] };
  }

  // Divide the total by however many rows were actually found, truncated
  // (not rounded) to 2 decimal places. Example: 25.32 / 7 = 3.6171... -> 3.61
  const perSectionValue = (Math.floor((totalOverheadValue / rowCount) * 100) / 100).toFixed(2);

  const results = [];
  for (const { row, outlinedInputs } of wageRows) {
    const sectionNameEl = row.querySelector('p.MuiTypography-body1');
    const sectionName = sectionNameEl ? sectionNameEl.textContent.trim() : '(unknown section)';

    const stepResult = { section: sectionName, ok: false, error: null };
    try {
      const actualWagesInput = outlinedInputs[0];
      const payableWagesInput = outlinedInputs[1];
      const overheadCostInput = outlinedInputs[2];

      setInputValue(actualWagesInput, '0.01');
      await sleep(200);
      setInputValue(payableWagesInput, '0.01');
      await sleep(200);
      setInputValue(overheadCostInput, perSectionValue);
      await sleep(200);

      stepResult.ok = true;
    } catch (e) {
      stepResult.error = (e && e.message) || String(e);
    }
    results.push(stepResult);
  }

  return { rowCount, perSectionValue, results };
}

// ==========================================================================
// This function is injected into and runs inside the target (ERP) page.
// Self-contained — cannot use variables from outside popup.js.
// ==========================================================================
async function runAutomationInPage(sections) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none'
    );
  }

  // Checks text nodes, placeholder, aria-label, title, and input value — all of them
  function findAllLeavesByExactText(text) {
    const all = document.querySelectorAll('body *');
    const found = [];
    for (const el of all) {
      if (!isVisible(el)) continue;

      if (el.children.length === 0 && el.textContent.trim() === text) {
        found.push(el);
        continue;
      }

      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        const ph = el.getAttribute('placeholder');
        if (ph && ph.trim() === text) {
          found.push(el);
          continue;
        }
        if (el.value && String(el.value).trim() === text) {
          found.push(el);
          continue;
        }
      }

      const ariaLabel = el.getAttribute && el.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.trim() === text) {
        found.push(el);
        continue;
      }
      const title = el.getAttribute && el.getAttribute('title');
      if (title && title.trim() === text && el.children.length === 0) {
        found.push(el);
      }
    }
    return found;
  }

  function findLeafByExactText(text) {
    const found = findAllLeavesByExactText(text);
    return found.length ? found[0] : null;
  }

  function realClick(el) {
    if (!el) return;
    if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !el.disabled) {
      el.focus();
    }
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  async function waitFor(fn, timeout = 5000, interval = 150) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const val = fn();
      if (val) return val;
      await sleep(interval);
    }
    return null;
  }

  // MUI's specific result-list-item pattern (confirmed from the real HTML you sent)
  function getResultListItems() {
    return document.querySelectorAll(
      '.MuiListItem-button[role="button"], .MuiButtonBase-root.MuiListItem-root[role="button"]'
    );
  }

  function isResultsPanelOpen() {
    for (const row of getResultListItems()) {
      if (isVisible(row)) return true;
    }
    return false;
  }

  // We don't know exactly which ancestor level holds the real click handler that
  // opens the dropdown panel — so click progressively higher ancestors, checking
  // after each click whether the panel actually opened
  async function openSectionPanel(triggerEl) {
    let el = triggerEl;
    for (let level = 0; level < 6 && el; level++) {
      realClick(el);
      const opened = await waitFor(isResultsPanelOpen, 900, 100);
      if (opened) return true;
      el = el.parentElement;
    }
    return false;
  }

  // Finds the real (editable) "Section Type" search box, excluding the disabled display input
  function findSectionTypeInput() {
    const label = findLeafByExactText('Section Type');
    if (label) {
      let container = label.parentElement;
      for (let i = 0; i < 4 && container; i++) {
        const input = container.querySelector(
          'input[type="text"]:not([disabled]), input:not([type]):not([disabled])'
        );
        if (input && isVisible(input)) return input;
        container = container.parentElement;
      }
    }
    const inputs = document.querySelectorAll(
      'input[type="text"]:not([disabled]), input:not([type]):not([disabled])'
    );
    for (const inp of inputs) {
      if (isVisible(inp)) return inp;
    }
    return null;
  }

  function setInputValue(input, value) {
    const proto = window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  // Important: placeholder="Select Section" stays on the input even after it's filled
  // (value is set, placeholder attribute is untouched). So matching placeholder alone
  // is not enough — we must also verify the value is genuinely empty, otherwise we'd
  // keep finding the same already-filled row and overwriting it repeatedly.
  function findEmptySectionTrigger() {
    const inputs = document.querySelectorAll('input[placeholder="Select Section"]');
    for (const el of inputs) {
      if (isVisible(el) && (!el.value || el.value.trim() === '')) {
        return el;
      }
    }
    return null;
  }

  // Finds the result row by code — first via MUI's specific classes (most accurate),
  // then falls back to plain text matching + nearest button-like ancestor
  function findResultRowByCode(code, name) {
    // Step 1: match BOTH code and name (avoids clicking the wrong row if a code repeats)
    if (name) {
      for (const row of getResultListItems()) {
        if (!isVisible(row)) continue;
        const boxes = row.querySelectorAll('.MuiBox-root');
        if (boxes.length >= 2) {
          const rowCode = boxes[0].textContent.trim();
          const rowName = boxes[1].textContent.trim();
          if (rowCode === code && rowName === name) return row;
        }
      }
    }
    // Step 2: match code only (fallback)
    for (const row of getResultListItems()) {
      if (!isVisible(row)) continue;
      const boxes = row.querySelectorAll('.MuiBox-root');
      if (boxes.length && boxes[0].textContent.trim() === code) {
        return row;
      }
      if (row.textContent && row.textContent.trim().startsWith(code)) {
        return row;
      }
    }
    // Step 3: plain text match + nearest button-like ancestor
    const leaves = findAllLeavesByExactText(code);
    for (const leaf of leaves) {
      if (leaf.closest('input, textarea')) continue;
      const btnAncestor = leaf.closest('[role="button"], .MuiListItem-button, .MuiButtonBase-root');
      if (btnAncestor) return btnAncestor;
    }
    return null;
  }

  // The results panel is scrollable (id="scrollableDiv") — an item further down the
  // list (like "Ironing") may not be rendered at first, so scroll step by step and
  // keep checking
  async function scrollAndFindRow(code, name) {
    let row = findResultRowByCode(code, name);
    if (row) return row;

    let container =
      document.getElementById('scrollableDiv') ||
      (getResultListItems()[0] && getResultListItems()[0].closest('[style*="overflow"]'));

    if (!container) return null;

    for (let i = 0; i < 20; i++) {
      const before = container.scrollTop;
      container.scrollTop = before + Math.max(container.clientHeight, 200);
      container.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(250);

      row = findResultRowByCode(code, name);
      if (row) return row;

      if (container.scrollTop === before) break; // reached the end of the list
    }
    return null;
  }

  // Verifies the selection actually took effect — checks only the value of inputs
  // with placeholder="Select Section", not the whole page's text (otherwise the
  // full master list on the right, which lists every section name, would cause
  // false "confirmed" results)
  function isSelectionConfirmed(sectionName) {
    const inputs = document.querySelectorAll('input[placeholder="Select Section"]');
    for (const inp of inputs) {
      if (inp.value && inp.value.trim() === sectionName) return true;
    }
    return false;
  }

  const results = [];

  for (const sec of sections) {
    const stepResult = { code: sec.code, name: sec.name, ok: false, error: null };
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        let trigger = await waitFor(findEmptySectionTrigger, 3000);

        if (!trigger) {
          const addBtn =
            findLeafByExactText('+') ||
            findLeafByExactText('Add') ||
            findLeafByExactText('Add Section') ||
            findLeafByExactText('Insert above') ||
            findLeafByExactText('Insert Above');
          if (addBtn) {
            realClick(addBtn);
            await sleep(500);
            trigger = await waitFor(findEmptySectionTrigger, 3000);
          }
        }

        if (!trigger) throw new Error('Could not find an empty "Select Section" row');

        const opened = await openSectionPanel(trigger);
        if (!opened) throw new Error('Clicked the dropdown but the search panel did not open');

        const input = await waitFor(findSectionTypeInput, 4000);
        if (!input) throw new Error('Could not find the real "Section Type" search box');
        setInputValue(input, sec.code);

        await sleep(900); // wait for results to filter

        const row = await scrollAndFindRow(sec.code, sec.name);
        if (!row) throw new Error(`Could not find a result row for code ${sec.code} ("${sec.name}")`);
        realClick(row);

        const confirmed = await waitFor(() => isSelectionConfirmed(sec.name), 3000);
        if (!confirmed) {
          throw new Error(`Clicked, but could not confirm "${sec.name}" was actually selected`);
        }

        await sleep(500); // wait for the next row to appear
        stepResult.ok = true;
        stepResult.error = null;
        break; // success, no retry needed
      } catch (e) {
        stepResult.error = (e && e.message) || String(e);
        if (attempt < maxAttempts) {
          await sleep(800); // wait a bit and try again
        }
      }
    }

    results.push(stepResult);
    await sleep(400);
  }

  return results;
}
