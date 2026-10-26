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
  updateProfileUI();
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
// Planning profiles — save a whole section list under a name, switch
// between them, and import / export them as JSON.
// ==============================
let profiles = [];            // [{ id, name, sections: [{code, name}] }]
let activeProfileId = '';

const profileSelect = document.getElementById('profileSelect');
const profileNameInput = document.getElementById('profileNameInput');
const profileSaveBtn = document.getElementById('profileSaveBtn');
const profileDeleteBtn = document.getElementById('profileDeleteBtn');
const profileMsg = document.getElementById('profileMsg');
const profileExportBtn = document.getElementById('profileExportBtn');
const profileImportBtn = document.getElementById('profileImportBtn');
const IN_TAB = !!new URLSearchParams(location.search).get('tab');
let pendingNote = '';
const profileImportFile = document.getElementById('profileImportFile');

const cloneSections = (list) => list.map((s) => ({ code: String(s.code), name: String(s.name) }));
const sectionsKey = (list) => JSON.stringify(list.map((s) => [String(s.code).trim(), String(s.name).trim()]));
const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const getActiveProfile = () => profiles.find((p) => p.id === activeProfileId) || null;

function persistProfiles() {
  chrome.storage.local.set({ planningProfiles: profiles, activeProfileId });
}

function setMsg(el, text, kind) {
  el.textContent = text || '';
  el.className = 'profile-msg' + (kind ? ' ' + kind : '');
}

function renderProfileSelect() {
  profileSelect.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = profiles.length ? 'Current list (no profile)' : 'No saved profiles yet';
  profileSelect.appendChild(none);
  profiles.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = `${p.name} (${p.sections.length})`;
    profileSelect.appendChild(o);
  });
  profileSelect.value = getActiveProfile() ? activeProfileId : '';
}

function updateProfileUI(keepMessage) {
  const active = getActiveProfile();
  profileDeleteBtn.disabled = !active;
  profileExportBtn.disabled = !active;
  if (pendingNote) {
    setMsg(profileMsg, pendingNote, '');
    pendingNote = '';
    return;
  }
  if (keepMessage) return;
  if (active) {
    const dirty = sectionsKey(active.sections) !== sectionsKey(sections);
    setMsg(profileMsg, dirty ? 'Unsaved changes. Save profile to keep them.' : '', dirty ? 'dirty' : '');
  } else {
    setMsg(profileMsg, '', '');
  }
}

function loadProfiles() {
  chrome.storage.local.get(['planningProfiles', 'activeProfileId'], (data) => {
    profiles = data && Array.isArray(data.planningProfiles)
      ? data.planningProfiles.filter((p) => p && p.id && p.name && Array.isArray(p.sections))
      : [];
    activeProfileId = (data && data.activeProfileId) || '';
    if (!getActiveProfile()) activeProfileId = '';
    renderProfileSelect();
    const active = getActiveProfile();
    profileNameInput.value = active ? active.name : '';
    updateProfileUI();
  });
}

profileSelect.addEventListener('change', () => {
  activeProfileId = profileSelect.value;
  const active = getActiveProfile();
  if (active) {
    sections = cloneSections(active.sections);
    chrome.storage.local.set({ customSections: sections });
    renderSections();
    profileNameInput.value = active.name;
    setMsg(profileMsg, `Loaded "${active.name}".`, 'good');
  } else {
    profileNameInput.value = '';
    setMsg(profileMsg, '', '');
  }
  persistProfiles();
  updateProfileUI(!!active);
});

function saveProfile() {
  const name = profileNameInput.value.trim();
  const valid = sections.filter((s) => String(s.code).trim() && String(s.name).trim());
  if (!name) {
    setMsg(profileMsg, 'Type a name for this profile first.', 'bad');
    profileNameInput.focus();
    return;
  }
  if (valid.length === 0) {
    setMsg(profileMsg, 'Add at least one section with a code and a name before saving.', 'bad');
    return;
  }
  const snapshot = cloneSections(valid);
  const sameName = profiles.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (sameName) {
    if (sameName.id !== activeProfileId && !confirm(`A profile named "${sameName.name}" already exists. Replace it?`)) return;
    sameName.name = name;
    sameName.sections = snapshot;
    activeProfileId = sameName.id;
    setMsg(profileMsg, `Updated "${name}".`, 'good');
  } else {
    const p = { id: newId(), name, sections: snapshot };
    profiles.push(p);
    activeProfileId = p.id;
    setMsg(profileMsg, `Saved "${name}".`, 'good');
  }
  sections = cloneSections(sections);
  persistProfiles();
  renderProfileSelect();
  updateProfileUI(true);
}
profileSaveBtn.addEventListener('click', saveProfile);
profileNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveProfile();
});

profileDeleteBtn.addEventListener('click', () => {
  const active = getActiveProfile();
  if (!active) return;
  if (!confirm(`Delete the profile "${active.name}"? Your current section list stays as it is.`)) return;
  profiles = profiles.filter((p) => p.id !== active.id);
  activeProfileId = '';
  profileNameInput.value = '';
  persistProfiles();
  renderProfileSelect();
  setMsg(profileMsg, `Deleted "${active.name}".`, 'good');
  updateProfileUI(true);
});

// ---------- Export ----------
function buildExport(profile) {
  return JSON.stringify(
    {
      app: 'erp-auto-planner',
      kind: 'planning-profiles',
      version: 1,
      exportedAt: new Date().toISOString(),
      profiles: [{ name: profile.name, sections: cloneSections(profile.sections) }]
    },
    null,
    2
  );
}

// The file is named after the profile (characters Windows does not allow become "-")
function fileNameFor(name) {
  const clean = String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return (clean || 'profile').slice(0, 80) + '.json';
}

profileExportBtn.addEventListener('click', () => {
  const active = getActiveProfile();
  if (!active) {
    setMsg(profileMsg, 'Select a profile to export.', 'bad');
    return;
  }
  const blob = new Blob([buildExport(active)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileNameFor(active.name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setMsg(profileMsg, `Exported "${active.name}".`, 'good');
});

// ---------- Import ----------
function cleanSections(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((s) => ({ code: String((s && s.code) == null ? '' : s.code).trim(), name: String((s && s.name) == null ? '' : s.name).trim() }))
    .filter((s) => s.code && s.name)
    .slice(0, 100);
}

function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('That file is not a valid profile export (.json).');
  }
  let found = [];
  if (data && Array.isArray(data.profiles)) found = data.profiles;
  else if (Array.isArray(data) && data.length && data.every((x) => x && Array.isArray(x.sections))) found = data;
  else if (data && Array.isArray(data.sections)) found = [data];
  else if (Array.isArray(data) && data.every((x) => x && 'code' in x)) found = [{ name: 'Imported list', sections: data }];
  const out = found
    .map((p) => ({ name: String((p && p.name) || '').trim() || 'Imported profile', sections: cleanSections(p && p.sections) }))
    .filter((p) => p.sections.length > 0);
  if (out.length === 0) throw new Error('No profiles with sections were found in that text.');
  return out;
}

function importProfiles(text) {
  try {
    const incoming = parseImport(text);
    let added = 0;
    let skipped = 0;
    for (const p of incoming) {
      const key = sectionsKey(p.sections);
      if (profiles.some((x) => x.name.toLowerCase() === p.name.toLowerCase() && sectionsKey(x.sections) === key)) {
        skipped++;
        continue;
      }
      let name = p.name.slice(0, 60);
      let n = 2;
      while (profiles.some((x) => x.name.toLowerCase() === name.toLowerCase())) name = `${p.name.slice(0, 54)} (${n++})`;
      profiles.push({ id: newId(), name, sections: p.sections });
      added++;
    }
    persistProfiles();
    renderProfileSelect();
    updateProfileUI();
    setMsg(
      profileMsg,
      `Imported ${added} profile(s)${skipped ? `, ${skipped} already saved` : ''}. Pick one from the list.`,
      'good'
    );
  } catch (e) {
    setMsg(profileMsg, e.message, 'bad');
  }
}

// A toolbar popup closes when the file chooser opens, so importing happens in a full tab
profileImportBtn.addEventListener('click', () => {
  if (IN_TAB) {
    profileImportFile.click();
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1&import=1') });
  }
});
profileImportFile.addEventListener('change', () => {
  const file = profileImportFile.files && profileImportFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => importProfiles(String(reader.result || ''));
  reader.onerror = () => setMsg(profileMsg, 'Could not read that file.', 'bad');
  reader.readAsText(file);
  profileImportFile.value = '';
});

if (IN_TAB) {
  document.body.classList.add('as-tab');
  if (new URLSearchParams(location.search).get('import')) {
    pendingNote = 'Click Import and choose your .json profile file.';
  }
}

// Load saved profiles (runs after the section list above has been requested)
loadProfiles();

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
              `<div class="${r.ok ? 'ok' : 'fail'}">${r.ok ? '✔' : '✘'} ${escapeHtml(r.section)}${
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

// ==============================
// Tabs (Planning / Wages / Accessories)
// ==============================
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

function showTab(name, persist) {
  tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  tabPanels.forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  if (persist) chrome.storage.local.set({ lastTab: name });
}
tabButtons.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab, true)));

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ==============================
// Accessories — saved accessory codes + "Add Accessories" on the
// Material Requirement Planning (MRP) page
// ==============================
let savedAccessories = [];

const accListEl = document.getElementById('accList');
const accCountEl = document.getElementById('accCount');
const accSectionCodeInput = document.getElementById('accSectionCode');
const accSectionNameInput = document.getElementById('accSectionName');
const accSaveCheckedBtn = document.getElementById('accSaveCheckedBtn');
const accReplaceInput = document.getElementById('accReplace');
const accClearBtn = document.getElementById('accClearBtn');
const accSaveStatusEl = document.getElementById('accSaveStatus');
const runAccBtn = document.getElementById('runAccBtn');
const accStatusEl = document.getElementById('accStatus');

function saveAccessories() {
  chrome.storage.local.set({ savedAccessories });
}

function renderAccessories() {
  accListEl.innerHTML = '';
  accCountEl.textContent = String(savedAccessories.length);

  if (savedAccessories.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.style.margin = '0';
    empty.textContent = 'No accessory codes saved yet.';
    accListEl.appendChild(empty);
    return;
  }

  savedAccessories.forEach((code, index) => {
    const item = document.createElement('div');
    item.className = 'acc-item';

    const label = document.createElement('span');
    label.textContent = code;
    label.title = code;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remove this code';
    removeBtn.addEventListener('click', () => {
      savedAccessories.splice(index, 1);
      saveAccessories();
      renderAccessories();
    });

    item.appendChild(label);
    item.appendChild(removeBtn);
    accListEl.appendChild(item);
  });
}

// Adds codes that are not saved yet; returns how many were new
function addAccessoryCodes(rawText) {
  const known = new Set(savedAccessories);
  let added = 0;
  for (const piece of String(rawText || '').split(/[\s,;]+/)) {
    const code = piece.trim();
    if (!code || known.has(code)) continue;
    known.add(code);
    savedAccessories.push(code);
    added++;
  }
  if (added > 0) {
    saveAccessories();
    renderAccessories();
  }
  return added;
}

// The section changes from order to order, so it is typed by hand (and remembered)
function saveSectionInputs() {
  chrome.storage.local.set({
    accessorySectionCode: accSectionCodeInput.value.trim(),
    accessorySectionName: accSectionNameInput.value.trim()
  });
}
accSectionCodeInput.addEventListener('input', saveSectionInputs);
accSectionNameInput.addEventListener('input', saveSectionInputs);

accClearBtn.addEventListener('click', () => {
  if (savedAccessories.length === 0) return;
  if (!confirm('Remove all saved accessory codes?')) return;
  savedAccessories = [];
  saveAccessories();
  renderAccessories();
  accSaveStatusEl.textContent = '';
});

accReplaceInput.addEventListener('change', () => {
  chrome.storage.local.set({ accReplace: accReplaceInput.checked });
});

// Step 1: read the ticked rows on the Bill of Materials page and save their codes
accSaveCheckedBtn.addEventListener('click', async () => {
  accSaveStatusEl.textContent = '';
  accSaveCheckedBtn.disabled = true;
  accSaveCheckedBtn.textContent = 'Reading...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('No active tab found');

    const injection = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: readCheckedAccessoryCodesInPage
    });

    let best = null;
    for (const frameResult of injection) {
      const r = frameResult && frameResult.result;
      if (!r || !Array.isArray(r.codes)) continue;
      if (!best || r.codes.length > best.codes.length || r.checkedBoxes > best.checkedBoxes) {
        if (!best || r.codes.length >= best.codes.length) best = r;
      }
    }
    if (!best) throw new Error('No result returned from any frame');

    const lines = [];
    if (best.codes.length === 0) {
      lines.push(
        `<div class="fail">No ticked rows with an accessory code were found (ticked boxes seen: ${best.checkedBoxes}). Tick the rows you want on the Bill of Materials page first. Your saved list was not changed.</div>`
      );
    } else if (accReplaceInput.checked) {
      savedAccessories = best.codes.slice();
      saveAccessories();
      renderAccessories();
      lines.push(`<div class="ok">✔ Saved ${best.codes.length} code(s), replacing the previous list.</div>`);
    } else {
      const added = addAccessoryCodes(best.codes.join(' '));
      lines.push(
        `<div class="ok">✔ Read ${best.codes.length} code(s): ${added} new, ${best.codes.length - added} already saved.</div>`
      );
    }
    for (const note of best.notes) {
      lines.push(`<div class="hint" style="margin-top:4px;">${escapeHtml(note)}</div>`);
    }
    accSaveStatusEl.innerHTML = lines.join('');
  } catch (e) {
    accSaveStatusEl.innerHTML = `<div class="fail">Something went wrong: ${escapeHtml(
      (e && e.message) || e
    )}</div>`;
  }

  accSaveCheckedBtn.disabled = false;
  accSaveCheckedBtn.textContent = 'Save ticked codes from this page';
});

chrome.storage.local.get(
  [
    'savedAccessories',
    'accessorySectionCode',
    'accessorySectionName',
    'accReplace',
    'lastTab'
  ],
  (data) => {
    if (data && Array.isArray(data.savedAccessories)) savedAccessories = data.savedAccessories;
    if (data && data.accessorySectionCode) accSectionCodeInput.value = data.accessorySectionCode;
    if (data && data.accessorySectionName) accSectionNameInput.value = data.accessorySectionName;
    if (data && typeof data.accReplace === 'boolean') accReplaceInput.checked = data.accReplace;
    if (data && data.lastTab && document.getElementById(`tab-${data.lastTab}`)) {
      showTab(data.lastTab, false);
    }
    renderAccessories();
  }
);

function renderAccessoryReport(report, sectionName) {
  const parts = [];
  if (report.dryRun) {
    parts.push(
      '<div class="hint" style="margin-top:0;margin-bottom:6px;"><strong>DRY RUN</strong> — nothing was changed on the page.</div>'
    );
  }
  parts.push(
    `<div class="hint" style="margin-top:0;margin-bottom:6px;">Rows found on page: ${report.rowCount} · already on "${escapeHtml(
      sectionName
    )}": ${report.existing.length}</div>`
  );

  const labels = {
    added: 'added',
    skipped: 'already on this section — skipped',
    'would-add': 'would be added'
  };
  for (const r of report.results) {
    const failed = r.status === 'failed';
    const icon = r.status === 'added' || r.status === 'would-add' ? '✔' : failed ? '✘' : '•';
    const text = failed ? r.error : labels[r.status] || r.status;
    parts.push(
      `<div class="${failed ? 'fail' : 'ok'}">${icon} ${escapeHtml(r.code)} — ${escapeHtml(text)}</div>`
    );
  }
  for (const note of report.notes) {
    parts.push(`<div class="hint" style="margin-top:4px;">${escapeHtml(note)}</div>`);
  }
  return parts.join('');
}

runAccBtn.addEventListener('click', async () => {
  const sectionCode = accSectionCodeInput.value.trim();
  const sectionName = accSectionNameInput.value.trim();
  if (!sectionCode || !sectionName) {
    accStatusEl.innerHTML =
      '<div class="fail">Type both the section code and the section name first.</div>';
    return;
  }
  if (savedAccessories.length === 0) {
    accStatusEl.innerHTML = '<div class="fail">Save at least one accessory code first.</div>';
    return;
  }

  const dryRun = false;
  runAccBtn.disabled = true;
  runAccBtn.textContent = 'Running...';
  accStatusEl.textContent = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('No active tab found');

    const injection = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: runAddAccessoriesInPage,
      args: [sectionCode, sectionName, savedAccessories.slice(), dryRun]
    });

    // Several frames may have run the script — use the one that actually found rows
    let best = null;
    let bestRows = -1;
    for (const frameResult of injection) {
      const r = frameResult && frameResult.result;
      if (!r || !Array.isArray(r.results)) continue;
      if (r.rowCount > bestRows) {
        bestRows = r.rowCount;
        best = r;
      }
    }
    if (!best) throw new Error('No result returned from any frame');

    accStatusEl.innerHTML = renderAccessoryReport(best, sectionName);
  } catch (e) {
    accStatusEl.innerHTML = `<div class="fail">Something went wrong: ${escapeHtml(
      (e && e.message) || e
    )}</div>`;
  }

  runAccBtn.disabled = false;
  runAccBtn.textContent = 'Add Accessories on MRP Page ▶';
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
          const rowName = normalizeSectionValue(boxes[1].textContent);
          if (rowCode === code && rowName === normalizeSectionValue(name)) return row;
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

  // The ERP now shows section values as "(93) Central Cutting" (code in parentheses
  // before the name). Strip that optional "(digits)" prefix so both the old format
  // ("Central Cutting") and the new one compare equal to the plain section name.
  function normalizeSectionValue(value) {
    return String(value || '')
      .trim()
      .replace(/^\(\s*\d+\s*\)\s*/, '')
      .trim();
  }

  // How many "Select Section" inputs currently hold a value (i.e. filled rows)
  function countFilledSections() {
    const inputs = document.querySelectorAll('input[placeholder="Select Section"]');
    let count = 0;
    for (const inp of inputs) {
      if (inp.value && inp.value.trim() !== '') count++;
    }
    return count;
  }

  // Verifies the selection actually took effect. Two independent signals:
  //  1) the exact input we clicked now holds this section (either display format), or
  //  2) the number of filled rows went up (works even if the display format changes again).
  // We only look at inputs with placeholder="Select Section", never the page's text
  // (the master list on the right contains every section name and would cause
  // false "confirmed" results).
  function isSelectionConfirmed(sectionName, filledBefore, trigger) {
    const target = normalizeSectionValue(sectionName);
    if (trigger && trigger.isConnected && normalizeSectionValue(trigger.value) === target) {
      return true;
    }
    return countFilledSections() > filledBefore;
  }

  const results = [];

  for (const sec of sections) {
    const stepResult = { code: sec.code, name: sec.name, ok: false, error: null };
    const maxAttempts = 2;
    const filledAtStart = countFilledSections();

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // If a previous attempt actually succeeded (but was not detected in time),
        // do not add a duplicate row — treat it as done.
        if (attempt > 1 && countFilledSections() > filledAtStart) {
          stepResult.ok = true;
          stepResult.error = null;
          break;
        }

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

        const confirmed = await waitFor(
          () => isSelectionConfirmed(sec.name, filledAtStart, trigger),
          3000
        );
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

// ==========================================================================
// This function is injected into and runs inside the Material Requirement
// Planning (MRP) page. Self-contained — cannot use variables from outside.
//
// Safety rules:
//  - It only ever works on a NEW (or already-empty) row. Existing rows are
//    never edited, removed or replaced.
//  - Codes already on the chosen section are skipped.
//  - If anything looks unexpected it stops with a clear message instead of guessing.
//  - dryRun = true only inspects the page and reports; it clicks nothing.
// ==========================================================================
async function runAddAccessoriesInPage(sectionCode, sectionName, accessoryCodes, dryRun) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const notes = [];

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

  async function waitFor(fn, timeout = 5000, interval = 150) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const val = fn();
      if (val) return val;
      await sleep(interval);
    }
    return null;
  }

  function realClick(el) {
    if (!el) return;
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  function setInputValue(input, value) {
    input.focus();
    const proto = window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  // "(93) Central Cutting" -> "Central Cutting"
  function normalizeValue(value) {
    return String(value || '')
      .trim()
      .replace(/^\(\s*\d+\s*\)\s*/, '')
      .trim();
  }

  function sameText(a, b) {
    return normalizeValue(a).toLowerCase() === normalizeValue(b).toLowerCase();
  }

  // "010020000052" -> "010020000052", "(0100..) Dyeing Fixer" -> "0100.."
  function accessoryCodeOf(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    const m = v.match(/^\(\s*([^)]+?)\s*\)/);
    if (m) return m[1].trim();
    return v.split(/\s+/)[0];
  }

  function findLeafByText(text) {
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length === 0 && el.textContent.trim() === text && isVisible(el)) return el;
    }
    return null;
  }

  function headerCenterX(text) {
    const el = findLeafByText(text);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return (r.left + r.right) / 2;
  }

  // Column header positions are measured once (layout does not change while we work)
  const sectionHeaderX = headerCenterX('Section');
  const accessoryHeaderX = headerCenterX('Accessory');

  // Dropdown-style inputs inside a scope: MUI "adorned" inputs or inputs with a placeholder
  function getDropdownInputs(scope) {
    const found = Array.from(scope.querySelectorAll('input')).filter((el) => {
      if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'hidden') return false;
      if (!isVisible(el)) return false;
      return el.classList.contains('MuiInputBase-inputAdornedEnd') || el.hasAttribute('placeholder');
    });
    found.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    return found;
  }

  // Pick the input sitting under a given column header (falls back to dropdown order)
  function pickColumn(inputs, headerX, fallbackIndex) {
    if (headerX != null) {
      let best = null;
      let bestDist = Infinity;
      for (const el of inputs) {
        const r = el.getBoundingClientRect();
        const dist =
          headerX >= r.left && headerX <= r.right
            ? 0
            : Math.min(Math.abs(headerX - r.left), Math.abs(headerX - r.right));
        if (dist < bestDist) {
          bestDist = dist;
          best = el;
        }
      }
      if (best && bestDist < 120) return best;
    }
    return inputs[fallbackIndex] || null;
  }

  // A "row" = the smallest ancestor of a row checkbox that holds both dropdowns
  function getRows() {
    const rows = [];
    const seen = new Set();
    for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
      if (!isVisible(cb)) continue;
      let el = cb;
      let rowEl = null;
      for (let i = 0; i < 8 && el.parentElement; i++) {
        el = el.parentElement;
        if (getDropdownInputs(el).length >= 2) {
          rowEl = el;
          break;
        }
      }
      if (!rowEl || seen.has(rowEl)) continue;
      seen.add(rowEl);

      const dropdowns = getDropdownInputs(rowEl);
      const sectionInput = pickColumn(dropdowns, sectionHeaderX, 0);
      const accessoryInput = pickColumn(dropdowns, accessoryHeaderX, 1);
      if (!sectionInput || !accessoryInput || sectionInput === accessoryInput) continue;

      rows.push({
        el: rowEl,
        sectionInput,
        accessoryInput,
        section: normalizeValue(sectionInput.value),
        accessory: accessoryCodeOf(accessoryInput.value)
      });
    }
    return rows;
  }

  const matchesSection = (r) => r.section && sameText(r.section, sectionName);
  // Rows we are allowed to fill: completely empty, or our section with no accessory yet
  const isFillable = (r) => !r.accessory && (!r.section || sameText(r.section, sectionName));
  const sectionRows = () => getRows().filter(matchesSection);

  // ---------- Side panel (dropdown search) helpers ----------
  const PANEL_SELECTOR = '.MuiDrawer-paper, .MuiDialog-paper, .MuiPopover-paper, #scrollableDiv';

  function snapshotPanels() {
    return new Set(Array.from(document.querySelectorAll(PANEL_SELECTOR)).filter(isVisible));
  }

  function findSearchInput(container) {
    for (const inp of container.querySelectorAll('input')) {
      if (inp.disabled || inp.readOnly) continue;
      if (inp.type === 'checkbox' || inp.type === 'radio' || inp.type === 'hidden') continue;
      if (isVisible(inp)) return inp;
    }
    return null;
  }

  // A panel counts as "opened by us" only if it was NOT visible before our click
  function findNewPanel(before) {
    const fresh = Array.from(document.querySelectorAll(PANEL_SELECTOR)).filter(
      (el) => isVisible(el) && !before.has(el)
    );
    if (fresh.length === 0) return null;
    const paper = fresh.find((el) => el.id !== 'scrollableDiv');
    if (paper) return paper;
    let c = fresh[0].parentElement;
    for (let i = 0; i < 6 && c; i++) {
      if (findSearchInput(c)) return c;
      c = c.parentElement;
    }
    return fresh[0].parentElement || fresh[0];
  }

  // Click the dropdown, then progressively higher ancestors (never the row itself),
  // until a new search panel appears
  async function openPanelFor(trigger, limitEl) {
    const before = snapshotPanels();
    let el = trigger;
    for (let level = 0; level < 6 && el && el !== limitEl; level++) {
      realClick(el);
      const panel = await waitFor(() => findNewPanel(before), 900, 100);
      if (panel) return panel;
      el = el.parentElement;
    }
    return null;
  }

  // Codes are compared ignoring case, spaces (incl. non-breaking / zero-width) so a
  // code that starts with a letter (e.g. "M48000000855") matches however the ERP
  // renders it (upper/lower case, highlighted, padded, wrapped in "( )" ...).
  function normCode(value) {
    return String(value || '')
      .replace(/[\s\u00A0\u200B-\u200D\uFEFF]+/g, '')
      .toLowerCase();
  }

  function panelRows(panel) {
    const primary = Array.from(
      panel.querySelectorAll(
        '.MuiListItem-button[role="button"], .MuiButtonBase-root.MuiListItem-root[role="button"]'
      )
    ).filter(isVisible);
    if (primary.length) return primary;
    // Fallback for result rows that use a different MUI structure
    return Array.from(
      panel.querySelectorAll('li, [role="button"], [role="option"], [role="row"], .MuiListItem-root')
    ).filter(isVisible);
  }

  function lookupPanelRow(panel, code) {
    const want = normCode(code);
    if (!want) return null;
    const rows = panelRows(panel);

    // 1) Some element inside the row has exactly this code as its text
    for (const row of rows) {
      if (normCode(row.textContent) === want) return row;
      for (const el of row.querySelectorAll('*')) {
        if (normCode(el.textContent) === want) return row;
      }
    }
    // 2) The code appears as a whole word/token of the row's text
    for (const row of rows) {
      const tokens = String(row.innerText || row.textContent || '')
        .split(/[\s()\[\],;|:]+/)
        .map(normCode)
        .filter(Boolean);
      if (tokens.includes(want)) return row;
    }
    // 3) Filtered down to a single result that contains the code
    if (rows.length === 1 && normCode(rows[0].textContent).includes(want)) return rows[0];
    return null;
  }

  async function findPanelRow(panel, code) {
    let row = await waitFor(() => lookupPanelRow(panel, code), 3000, 200);
    if (row) return row;

    // Not visible yet — the list may be long, so scroll it step by step
    let list = panel.id === 'scrollableDiv' ? panel : panel.querySelector('#scrollableDiv');
    if (!list) {
      const first = panelRows(panel)[0];
      list = first && first.closest('[style*="overflow"]');
    }
    if (!list) return null;

    for (let i = 0; i < 20; i++) {
      const before = list.scrollTop;
      list.scrollTop = before + Math.max(list.clientHeight, 200);
      list.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(250);
      row = lookupPanelRow(panel, code);
      if (row) return row;
      if (list.scrollTop === before) break;
    }
    return null;
  }

  async function pickFromPanel(panel, code) {
    const input = findSearchInput(panel);
    if (!input) throw new Error('Could not find the search box inside the opened panel');
    setInputValue(input, code);
    await sleep(700);
    const row = await findPanelRow(panel, code);
    if (!row) {
      const seen = panelRows(panel)
        .slice(0, 3)
        .map((r) => String(r.innerText || r.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60));
      throw new Error(
        `No result row for code ${code} in the panel` +
          (seen.length ? ` (panel showed: ${seen.map((t) => `"${t}"`).join(', ')})` : ' (panel showed no results)')
      );
    }
    realClick(row);
    // Wait for the panel to close before doing anything else
    await waitFor(() => !panel.isConnected || !isVisible(panel), 3000, 150);
    await sleep(400);
  }

  // ---------- Main ----------
  const codes = Array.from(
    new Set((accessoryCodes || []).map((c) => String(c).trim()).filter(Boolean))
  );

  const initialRows = getRows();
  const existing = new Set(
    initialRows
      .filter(matchesSection)
      .map((r) => r.accessory.toLowerCase())
      .filter(Boolean)
  );

  if (initialRows.length === 0) {
    notes.push(
      'No rows were detected on this page (looking for rows with a checkbox and two dropdowns). Make sure the Material Requirement Planning page is open.'
    );
  }
  if (sectionHeaderX == null || accessoryHeaderX == null) {
    notes.push('Could not locate the "Section" / "Accessory" column headers; using dropdown order instead.');
  }
  if (dryRun) {
    notes.push(findLeafByText('Add') ? 'Add button found.' : 'Add button NOT found.');
    const sample = initialRows.find(matchesSection) || initialRows[0];
    if (sample) {
      notes.push(
        `Sample row read as: section "${sample.section}", accessory "${sample.accessory}".`
      );
    }
  }

  const results = [];

  for (const code of codes) {
    const res = { code, status: 'failed', error: null };
    results.push(res);

    try {
      if (existing.has(code.toLowerCase())) {
        res.status = 'skipped';
        continue;
      }
      if (dryRun) {
        res.status = 'would-add';
        continue;
      }

      // 1) Find a row we may fill, or click "Add" to create one
      let target = getRows().find(isFillable);
      if (!target) {
        const addBtn = findLeafByText('Add');
        if (!addBtn) throw new Error('Could not find the "Add" button');
        realClick(addBtn);
        target = await waitFor(() => getRows().find(isFillable), 4000, 200);
        if (!target) throw new Error('Clicked "Add" but no new empty row appeared');
      }

      // 2) Choose the section on that row if it is still empty
      if (!target.section) {
        const panel = await openPanelFor(target.sectionInput, target.el);
        if (!panel) throw new Error('Clicked the Section dropdown but no search panel opened');
        await pickFromPanel(panel, sectionCode);
      }
      target = await waitFor(
        () => getRows().find((r) => matchesSection(r) && !r.accessory),
        4000,
        200
      );
      if (!target) throw new Error(`Section "${sectionName}" did not get selected on the new row`);

      // 3) Choose the accessory code on the same row
      const filledBefore = sectionRows().filter((r) => r.accessory).length;
      const panel2 = await openPanelFor(target.accessoryInput, target.el);
      if (!panel2) throw new Error('Clicked the Accessory dropdown but no search panel opened');
      await pickFromPanel(panel2, code);

      const confirmed = await waitFor(() => {
        const rows = sectionRows();
        return (
          rows.some((r) => r.accessory.toLowerCase() === code.toLowerCase()) ||
          rows.filter((r) => r.accessory).length > filledBefore
        );
      }, 4000, 200);
      if (!confirmed) throw new Error(`Selected "${code}" but it did not appear on the section's row`);

      existing.add(code.toLowerCase());
      res.status = 'added';
    } catch (e) {
      res.status = 'failed';
      res.error = (e && e.message) || String(e);
      // Do not keep going blindly after a failure on a live page
      notes.push(`Stopped after "${code}" failed — remaining codes were not attempted.`);
      break;
    }
  }

  return {
    dryRun: !!dryRun,
    rowCount: initialRows.length,
    existing: Array.from(existing),
    results,
    notes
  };
}

// ==========================================================================
// This function is injected into and runs inside the Bill of Materials page.
// Self-contained — cannot use variables from outside. READ-ONLY: it never
// clicks or edits anything; it only reads the accessory code of every ticked row.
// ==========================================================================
async function readCheckedAccessoryCodesInPage() {
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

  // "010020000052" -> "010020000052", "(0100..) Dyeing Fixer" -> "0100.."
  function accessoryCodeOf(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    const m = v.match(/^\(\s*([^)]+?)\s*\)/);
    if (m) return m[1].trim();
    return v.split(/\s+/)[0];
  }

  function findLeafByText(text) {
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length === 0 && el.textContent.trim() === text && isVisible(el)) return el;
    }
    return null;
  }

  // Dropdown-style inputs inside a scope: MUI "adorned" inputs or inputs with a placeholder
  function getDropdownInputs(scope) {
    const found = Array.from(scope.querySelectorAll('input')).filter((el) => {
      if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'hidden') return false;
      if (!isVisible(el)) return false;
      return el.classList.contains('MuiInputBase-inputAdornedEnd') || el.hasAttribute('placeholder');
    });
    found.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    return found;
  }

  // The dropdown under the "Accessory Code" column header (falls back to the leftmost one)
  const headerEl = findLeafByText('Accessory Code');
  let headerX = null;
  if (headerEl) {
    const hr = headerEl.getBoundingClientRect();
    headerX = (hr.left + hr.right) / 2;
  }

  function pickAccessoryInput(inputs) {
    if (headerX != null) {
      let best = null;
      let bestDist = Infinity;
      for (const el of inputs) {
        const r = el.getBoundingClientRect();
        const dist =
          headerX >= r.left && headerX <= r.right
            ? 0
            : Math.min(Math.abs(headerX - r.left), Math.abs(headerX - r.right));
        if (dist < bestDist) {
          bestDist = dist;
          best = el;
        }
      }
      if (best && bestDist < 120) return best;
    }
    return inputs[0] || null;
  }

  const codes = [];
  const seen = new Set();
  const notes = [];
  let checkedBoxes = 0;
  let checkedRows = 0;

  for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
    if (!cb.checked || !isVisible(cb)) continue;
    checkedBoxes++;

    // The row = smallest ancestor of this checkbox that holds a dropdown input,
    // and no other checkbox (so we never climb into the whole table)
    let el = cb;
    let rowEl = null;
    for (let i = 0; i < 8 && el.parentElement; i++) {
      el = el.parentElement;
      if (el.querySelectorAll('input[type="checkbox"]').length > 1) break;
      if (getDropdownInputs(el).length >= 1) {
        rowEl = el;
        break;
      }
    }
    if (!rowEl) continue;
    checkedRows++;

    const input = pickAccessoryInput(getDropdownInputs(rowEl));
    const code = input ? accessoryCodeOf(input.value) : '';
    if (!code) {
      notes.push('A ticked row has no accessory code selected — skipped.');
      continue;
    }
    if (!seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }

  if (checkedBoxes > 0 && checkedRows === 0) {
    notes.push('Ticked boxes were found, but their rows could not be read. Are you on the Bill of Materials page?');
  }

  return { checkedBoxes, checkedRows, codes, notes };
}
