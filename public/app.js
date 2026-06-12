// --- Tab switching ---
let statusInterval = null;

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');

    clearInterval(statusInterval);
    statusInterval = null;
    if (btn.dataset.tab === 'status') {
      fetchStatus();
      statusInterval = setInterval(fetchStatus, 2000);
    }
  });
});

// --- Queue tab ---
const sourceInput  = document.getElementById('source-path');
const destInput    = document.getElementById('dest-path');
const trailingSlashCb = document.getElementById('trailing-slash');
const bwlimitInput = document.getElementById('bwlimit');
const queueBtn     = document.getElementById('queue-btn');
const toast        = document.getElementById('queue-toast');
const saveNameInput = document.getElementById('save-dest-name');
const saveDestBtn  = document.getElementById('save-dest-btn');
const savedContainer = document.getElementById('saved-destinations');

function validateQueueBtn() {
  queueBtn.disabled = !(sourceInput.value.trim() && destInput.value.trim());
}
sourceInput.addEventListener('input', validateQueueBtn);
destInput.addEventListener('input', validateQueueBtn);

function setupDropzone(dropEl, inputEl) {
  dropEl.addEventListener('dragover', e => {
    e.preventDefault();
    dropEl.classList.add('drag-over');
  });
  dropEl.addEventListener('dragleave', e => {
    if (!dropEl.contains(e.relatedTarget)) dropEl.classList.remove('drag-over');
  });
  dropEl.addEventListener('drop', e => {
    e.preventDefault();
    dropEl.classList.remove('drag-over');
    const uriList = e.dataTransfer.getData('text/uri-list') || '';
    const uri = uriList.trim().split(/\r?\n/)[0].trim();
    if (uri.startsWith('file://')) {
      inputEl.value = decodeURIComponent(uri.replace(/^file:\/\//, ''));
      inputEl.dispatchEvent(new Event('input'));
    }
  });
}

setupDropzone(document.getElementById('source-drop'), sourceInput);
setupDropzone(document.getElementById('dest-drop'), destInput);

queueBtn.addEventListener('click', async () => {
  queueBtn.disabled = true;
  try {
    const res = await fetch('/api/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: sourceInput.value.trim(),
        dest: destInput.value.trim(),
        bwlimit: parseInt(bwlimitInput.value) || 20000,
        trailingSlash: trailingSlashCb.checked,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      showToast('success', data.output || 'Task queued.');
      sourceInput.value = '';
      destInput.value = '';
      trailingSlashCb.checked = false;
    } else {
      showToast('error', data.error || 'Failed to queue task.');
    }
  } catch (err) {
    showToast('error', err.message);
  }
  validateQueueBtn();
});

function showToast(type, msg) {
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 6000);
}

// --- Saved destinations ---
async function loadDestinations() {
  try {
    const res = await fetch('/api/destinations');
    renderDestinations(await res.json());
  } catch {}
}

function renderDestinations(dests) {
  savedContainer.innerHTML = '';
  dests.forEach(d => {
    const chip = document.createElement('div');
    chip.className = 'dest-chip';
    chip.title = d.path;
    chip.innerHTML = `
      <span class="chip-name">${esc(d.name)}</span>
      <span class="chip-path">${esc(tailPath(d.path, 30))}</span>
      <button class="chip-remove" title="Remove">×</button>
    `;
    chip.addEventListener('click', e => {
      if (e.target.classList.contains('chip-remove')) return;
      destInput.value = d.path;
      destInput.dispatchEvent(new Event('input'));
    });
    chip.querySelector('.chip-remove').addEventListener('click', async () => {
      await fetch(`/api/destinations/${encodeURIComponent(d.name)}`, { method: 'DELETE' });
      loadDestinations();
    });
    savedContainer.appendChild(chip);
  });
}

saveDestBtn.addEventListener('click', async () => {
  const name = saveNameInput.value.trim();
  const destPath = destInput.value.trim();
  if (!name) { showToast('error', 'Enter a label first.'); return; }
  if (!destPath) { showToast('error', 'Destination path is empty.'); return; }
  const res = await fetch('/api/destinations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, path: destPath }),
  });
  const data = await res.json();
  if (res.ok) {
    saveNameInput.value = '';
    loadDestinations();
  } else {
    showToast('error', data.error || 'Failed to save.');
  }
});

// --- Status tab ---
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    renderStatus(await res.json());
  } catch {}
}

function formatRsyncCommand(commandStr) {

  // Clean up any accidental leading/trailing whitespace or quotes
  const cleaned = commandStr.replace(/^"|"$/g, '').trim();
  
  // Updated Regex breakdown:
  //   (.*)               -> Capture group 1: everything up to the paths
  //   \s+[']?(\/[\S\s]+?)[']? -> Capture group 2 (Source): Optional single quote, leading slash, lazy match everything, optional closing single quote
  //   \s+[']?(\/[\S\s]+?)[']?$ -> Capture group 3 (Destination): Same as source, matching up to the end of the string ($) to safely capture spaces inside quotes
  const match = cleaned.match(/(.*)\s+[']?(\/[\S\s]+?)[']?\s+[']?(\/[\S\s]+?)[']?$/);
  
  if (!match) {
    return "Invalid or unmatchable rsync command format";
  }
  
  // Extract source (group 2) and destination (group 3)
  let source = match[2].trim();
  let destination = match[3].trim();
  
  // Strip escape slashes AND trailing/leading single quotes that might linger
  source = source.replace(/\\/g, '').replace(/^'|'$/g, '');
  destination = destination.replace(/\\/g, '').replace(/^'|'$/g, '');
  
  // Helper function to truncate paths longer than custom chars from the left
  const truncatePath = (path, charCap) => {
    return path.length > charCap ? '...' + path.slice(charCap * -1) : path;
  };
  
  return `${truncatePath(source, 32)} -> ${truncatePath(destination, 24)}`;
}

function renderStatus(data) {
  const tbody = document.getElementById('status-body');
  const countEl = document.getElementById('status-count');

  const tasks = Object.values(data.tasks || {});
  tasks.sort((a, b) => b.id - a.id);

  countEl.textContent = `${tasks.length} task${tasks.length !== 1 ? 's' : ''}`;

  if (tasks.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No tasks in queue</td></tr>';
    return;
  }

  tbody.innerHTML = tasks.map(task => {
    const { label, cls } = parseStatus(task.status);
    const cmd = formatRsyncCommand(task.command || task.original_command) || '';
    const started = formatDate(task.created_at || null);
    return `<tr>
      <td class="id-cell">${task.id}</td>
      <td><span class="status-badge status-${cls}">${esc(label)}</span></td>
      <td class="cmd-cell" title="${esc(cmd)}">${esc(cmd)}</td>
      <td class="started-cell">${started}</td>
      <td class="action-cell">
        <button class="remove-btn" data-id="${task.id}">Remove</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const res = await fetch(`/api/tasks/${btn.dataset.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to remove task.');
        btn.disabled = false;
      } else {
        fetchStatus();
      }
    });
  });
}

function parseStatus(status) {
  if (typeof status === 'string') {
    return { label: status, cls: status.toLowerCase() };
  }
  if (status && typeof status === 'object') {
    const key = Object.keys(status)[0];
    if (!key) return { label: 'Unknown', cls: 'unknown' };
    if (key === 'Done') {
      const val = status[key];
      const result = val?.result ?? val;
      if (!result || result === 'Success') return { label: 'Done', cls: 'done' };
      if (typeof result === 'object') {
        if ('Failure' in result) return { label: `Failed (${result.Failure})`, cls: 'failed' };
        if ('Signal' in result) return { label: 'Killed', cls: 'failed' };
        if ('DependencyFailed' in result || result === 'DependencyFailed') return { label: 'Dep Failed', cls: 'failed' };
      }
      return { label: 'Done', cls: 'done' };
    }
    return { label: key, cls: key.toLowerCase() };
  }
  return { label: String(status), cls: 'unknown' };
}

function formatDate(str) {
  if (!str) return '—';
  try {
    return new Date(str).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function tailPath(str, n) {
  return str.length > n ? '…' + str.slice(-(n - 1)) : str;
}

// Init
loadDestinations();
