const { invoke } = window.__TAURI__.core;

let notes = [];
let currentFilter = 'all';
let currentView = 'list';
let editingId = null;
let searchQuery = '';

const $ = id => document.getElementById(id);

async function loadNotes() {
  notes = await invoke('list_notes');
  render();
}

function filteredNotes() {
  let list = notes;
  if (currentFilter !== 'all') list = list.filter(n => n.status === currentFilter);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(n =>
      n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
  }
  return list;
}

function render() { renderList(); renderBoard(); if (editingId) renderEditor(); }

function statusDot(status) {
  return `<span class="dot ${status}"></span>`;
}

function formatCountdown(dueAt) {
  if (!dueAt) return '';
  const diff = dueAt - Date.now();
  const overdue = diff < 0;
  const abs = Math.abs(diff);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const text = d > 0 ? `${d}天${h}小时` : h > 0 ? `${h}小时${m}分` : `${m}分`;
  return `<span class="countdown ${overdue ? 'overdue' : ''}">${overdue ? '已过期 ' + text : '还剩 ' + text}</span>`;
}

function checklistProgress(note) {
  if (!note.checklist.length) return '';
  const done = note.checklist.filter(i => i.done).length;
  const pct = Math.round(done / note.checklist.length * 100);
  return `<div class="progress-mini"><div style="width:${pct}%"></div></div><span>${pct}%</span>`;
}

function noteCard(note, isBoard) {
  const tags = note.tags.map(t => `<span class="tag-chip">${t}</span>`).join('');
  const summary = note.content.replace(/\n/g, ' ').slice(0, 80);
  return `
    <div class="${isBoard ? 'board-card' : 'note-card'}" data-id="${note.id}">
      <div class="title">${note.title || '(无标题)'}</div>
      ${!isBoard ? `<div class="summary">${summary}</div>` : ''}
      <div class="meta">
        ${statusDot(note.status)} ${tags}
        ${checklistProgress(note)}
        ${formatCountdown(note.due_at)}
      </div>
    </div>`;
}

function renderList() {
  const el = $('list-view');
  el.innerHTML = filteredNotes().map(n => noteCard(n, false)).join('') || '<p style="color:#8A8F98">还没有便签，点右上角新建。</p>';
  el.querySelectorAll('.note-card').forEach(card => {
    card.onclick = () => openEditor(card.dataset.id);
  });
}

function renderBoard() {
  const cols = document.querySelectorAll('.board-col');
  cols.forEach(col => {
    const status = col.dataset.status;
    const body = col.querySelector('.col-body');
    const items = filteredNotes().filter(n => n.status === status);
    body.innerHTML = items.map(n => noteCard(n, true)).join('');
    body.querySelectorAll('.board-card').forEach(card => {
      card.onclick = () => openEditor(card.dataset.id);
    });
  });
}

function openEditor(id) {
  editingId = id;
  $('editor').classList.remove('hidden');
  renderEditor();
}

function renderEditor() {
  const note = notes.find(n => n.id === editingId);
  if (!note) { $('editor').classList.add('hidden'); return; }
  $('edit-title').value = note.title;
  $('edit-content').value = note.content;
  $('edit-status').value = note.status;
  $('edit-priority').value = note.priority;
  $('edit-tags').value = note.tags.join(', ');
  $('edit-due').value = note.due_at ? new Date(note.due_at).toISOString().slice(0, 16) : '';
  renderChecklist(note);
  const done = note.checklist.filter(i => i.done).length;
  $('progress-text').textContent = note.checklist.length
    ? `清单 ${done}/${note.checklist.length}` : '无清单';
}

function renderChecklist(note) {
  const el = $('checklist');
  el.innerHTML = note.checklist.map((item, idx) => `
    <div class="check-item" data-idx="${idx}">
      <input type="checkbox" ${item.done ? 'checked' : ''}>
      <input type="text" value="${item.text}">
    </div>`).join('');
  el.querySelectorAll('.check-item').forEach(row => {
    const idx = Number(row.dataset.idx);
    row.querySelector('input[type=checkbox]').onchange = e => {
      note.checklist[idx].done = e.target.checked;
      persist(note);
    };
    row.querySelector('input[type=text]').oninput = e => {
      note.checklist[idx].text = e.target.value;
      persist(note);
    };
  });
}

function persist(note) {
  note.updated_at = Date.now();
  invoke('save_note', { note }).then(loadNotes);
}

function bindEditorInputs() {
  const getNote = () => notes.find(n => n.id === editingId);
  $('edit-title').oninput = e => { const n = getNote(); if (n) { n.title = e.target.value; persist(n); } };
  $('edit-content').oninput = e => { const n = getNote(); if (n) { n.content = e.target.value; persist(n); } };
  $('edit-status').onchange = e => { const n = getNote(); if (n) { n.status = e.target.value; persist(n); } };
  $('edit-priority').onchange = e => { const n = getNote(); if (n) { n.priority = e.target.value; persist(n); } };
  $('edit-tags').oninput = e => {
    const n = getNote(); if (n) {
      n.tags = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
      persist(n);
    }
  };
  $('edit-due').onchange = e => {
    const n = getNote(); if (n) {
      n.due_at = e.target.value ? new Date(e.target.value).getTime() : null;
      persist(n);
    }
  };
  $('add-check').onclick = () => {
    const n = getNote(); if (!n) return;
    n.checklist.push({ id: crypto.randomUUID(), text: '', done: false });
    persist(n); renderChecklist(n);
  };
  $('delete-note').onclick = async () => {
    if (!editingId) return;
    await invoke('delete_note', { id: editingId });
    editingId = null;
    $('editor').classList.add('hidden');
    loadNotes();
  };
  $('close-editor').onclick = () => { editingId = null; $('editor').classList.add('hidden'); };
}

async function newNote() {
  const id = await invoke('new_id');
  const now = Date.now();
  const note = {
    id, title: '', content: '', status: 'todo', priority: 'none',
    tags: [], checklist: [], due_at: null, pinned: false,
    created_at: now, updated_at: now, deleted: false,
  };
  await invoke('save_note', { note });
  await loadNotes();
  openEditor(id);
}

function bindTopbar() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      render();
    };
  });
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      $('list-view').classList.toggle('hidden', currentView !== 'list');
      $('board-view').classList.toggle('hidden', currentView !== 'board');
    };
  });
  $('search').oninput = e => { searchQuery = e.target.value; render(); };
  $('new-note').onclick = newNote;
}

bindTopbar();
bindEditorInputs();
loadNotes();
