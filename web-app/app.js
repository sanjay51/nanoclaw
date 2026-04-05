(function () {
  // ---- Connection state ----
  let API_BASE = '';
  let API_TOKEN = '';

  function apiUrl(path) {
    return API_BASE + path;
  }

  function apiHeaders(extra) {
    var h = extra || {};
    if (API_TOKEN) h['Authorization'] = 'Bearer ' + API_TOKEN;
    return h;
  }

  // ---- DOM refs ----
  var connectScreen = document.getElementById('connect-screen');
  var connectForm = document.getElementById('connect-form');
  var connectEndpoint = document.getElementById('connect-endpoint');
  var connectToken = document.getElementById('connect-token');
  var connectBtn = document.getElementById('connect-btn');
  var connectError = document.getElementById('connect-error');
  var connectRemember = document.getElementById('connect-remember');
  var app = document.getElementById('app');

  var messages = document.getElementById('messages');
  var empty = document.getElementById('empty');
  var typing = document.getElementById('typing');
  var form = document.getElementById('form');
  var input = document.getElementById('input');
  var dot = document.getElementById('dot');
  var statusEl = document.getElementById('status');
  var chatView = document.getElementById('chat-view');
  var detailPanel = document.getElementById('detail-panel');
  var detailBack = document.getElementById('detail-back');
  var detailTitle = document.getElementById('detail-title');
  var detailBody = document.getElementById('detail-body');
  var toastEl = document.getElementById('toast');
  var disconnectBtn = document.getElementById('disconnect-btn');
  var assistantTitle = document.getElementById('assistant-title');

  var statusData = { channels: [], groups: [], tasks: [], chats: [] };

  // ---- Toast ----
  var toastTimer = null;
  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.className = 'toast visible' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 2500);
  }

  // ---- Panel management ----
  function showChat() {
    chatView.classList.remove('hidden');
    detailPanel.classList.remove('visible');
    document.querySelectorAll('#sidebar .item.selected').forEach(function (el) { el.classList.remove('selected'); });
  }

  function showDetail(title, html) {
    chatView.classList.add('hidden');
    detailPanel.classList.add('visible');
    detailTitle.textContent = title;
    detailBody.innerHTML = html;
  }

  detailBack.addEventListener('click', showChat);

  // ---- Chat ----
  function addMsg(text, cls) {
    empty.style.display = 'none';
    var div = document.createElement('div');
    div.className = 'msg ' + cls;
    if (cls === 'bot') {
      div.innerHTML = renderMarkdown(text);
    } else {
      div.textContent = text;
    }
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function renderMarkdown(text) {
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    text = text.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    return text;
  }

  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.dispatchEvent(new Event('submit'));
    }
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    addMsg(text, 'user');
    input.value = '';
    input.style.height = 'auto';
    showChat();
    try {
      var res = await fetch(apiUrl('/api/message'), {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text: text }),
      });
      if (!res.ok) {
        var err = await res.json().catch(function () { return { error: res.statusText }; });
        addMsg('Error: ' + (err.error || res.statusText), 'bot');
      }
    } catch (err) {
      addMsg('Error: could not reach server', 'bot');
    }
  });

  // ---- SSE ----
  var currentES = null;

  function connectSSE() {
    if (currentES) { currentES.close(); currentES = null; }
    var sseUrl = apiUrl('/api/events') + (API_TOKEN ? '?token=' + encodeURIComponent(API_TOKEN) : '');
    var es = new EventSource(sseUrl);
    currentES = es;
    es.onopen = function () {
      dot.classList.add('connected');
      statusEl.textContent = 'connected';
    };
    es.onmessage = function (e) {
      try {
        var data = JSON.parse(e.data);
        if (data.type === 'message') {
          typing.classList.remove('visible');
          addMsg(data.text, 'bot');
          if (detailPanel.classList.contains('visible')) showChat();
        } else if (data.type === 'typing') {
          if (data.isTyping) {
            typing.classList.add('visible');
            messages.scrollTop = messages.scrollHeight;
          } else {
            typing.classList.remove('visible');
          }
        }
      } catch (err) { /* ignore */ }
    };
    es.onerror = function () {
      dot.classList.remove('connected');
      statusEl.textContent = 'reconnecting...';
      es.close();
      setTimeout(connectSSE, 2000);
    };
  }

  // ---- Helpers ----
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function relTime(iso) {
    if (!iso) return 'never';
    var d = new Date(iso);
    var now = Date.now();
    var diff = now - d.getTime();
    if (diff < 0) return 'in ' + humanDuration(-diff);
    if (diff < 60000) return 'just now';
    return humanDuration(diff) + ' ago';
  }

  function humanDuration(ms) {
    if (ms < 60000) return Math.floor(ms / 1000) + 's';
    if (ms < 3600000) return Math.floor(ms / 60000) + 'm';
    if (ms < 86400000) return Math.floor(ms / 3600000) + 'h';
    return Math.floor(ms / 86400000) + 'd';
  }

  // ---- Channel detail panel ----
  function showChannelDetail(ch) {
    var groupsHtml = (ch.groups || []).length
      ? ch.groups.map(function (g) {
          return '<div class="info-row">' +
            '<div class="dot ' + (g.isMain ? 'green' : 'dim') + '"></div>' +
            '<span class="label">' + esc(g.name) + '</span>' +
            (g.isMain ? '<span class="meta">main</span>' : '') +
          '</div>' +
          '<div style="padding: 2px 0 8px 14px; font-size: 12px; color: var(--text-muted);">' +
            'Folder: <code>' + esc(g.folder) + '</code>' +
            (g.trigger ? ' &middot; Trigger: <code>' + esc(g.trigger) + '</code>' : '') +
            ' &middot; Requires trigger: ' + (g.requiresTrigger ? 'yes' : 'no') +
          '</div>';
        }).join('')
      : '<div class="empty-hint">No groups registered on this channel</div>';

    var html =
      '<div class="detail-section">' +
        '<h3>Status</h3>' +
        '<div class="info-row">' +
          '<div class="dot ' + (ch.connected ? 'green' : 'red') + '"></div>' +
          '<span class="label">' + (ch.connected ? 'Connected' : 'Disconnected') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="detail-section">' +
        '<h3>Groups</h3>' +
        groupsHtml +
      '</div>';

    showDetail(ch.name.charAt(0).toUpperCase() + ch.name.slice(1) + ' Channel', html);
  }

  // ---- Task detail / edit panel ----
  function showTaskDetail(task) {
    var html =
      '<div class="detail-section">' +
        '<h3>Task Details</h3>' +
        '<div class="detail-field">' +
          '<label>Prompt</label>' +
          '<textarea id="edit-prompt">' + esc(task.prompt) + '</textarea>' +
        '</div>' +
        '<div class="detail-field">' +
          '<label>Schedule Type</label>' +
          '<select id="edit-type">' +
            '<option value="cron"' + (task.type === 'cron' ? ' selected' : '') + '>Cron</option>' +
            '<option value="interval"' + (task.type === 'interval' ? ' selected' : '') + '>Interval (ms)</option>' +
            '<option value="once"' + (task.type === 'once' ? ' selected' : '') + '>Once</option>' +
          '</select>' +
        '</div>' +
        '<div class="detail-field">' +
          '<label>Schedule Value</label>' +
          '<input id="edit-value" type="text" value="' + esc(task.value) + '">' +
        '</div>' +
        '<div class="detail-field">' +
          '<label>Status</label>' +
          '<select id="edit-status">' +
            '<option value="active"' + (task.status === 'active' ? ' selected' : '') + '>Active</option>' +
            '<option value="paused"' + (task.status === 'paused' ? ' selected' : '') + '>Paused</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div class="detail-section">' +
        '<h3>Info</h3>' +
        '<div class="detail-field">' +
          '<label>ID</label>' +
          '<div class="value mono">' + esc(task.id) + '</div>' +
        '</div>' +
        '<div class="detail-field">' +
          '<label>Group</label>' +
          '<div class="value">' + esc(task.group) + '</div>' +
        '</div>' +
        '<div class="detail-field">' +
          '<label>Context Mode</label>' +
          '<div class="value">' + esc(task.contextMode || 'isolated') + '</div>' +
        '</div>' +
        (task.nextRun ? '<div class="detail-field"><label>Next Run</label><div class="value">' + esc(new Date(task.nextRun).toLocaleString()) + ' (' + relTime(task.nextRun) + ')</div></div>' : '') +
        (task.lastRun ? '<div class="detail-field"><label>Last Run</label><div class="value">' + relTime(task.lastRun) + '</div></div>' : '') +
        (task.lastResult ? '<div class="detail-field"><label>Last Result</label><div class="value mono" style="white-space:pre-wrap;max-height:120px;overflow:auto;">' + esc(task.lastResult) + '</div></div>' : '') +
      '</div>' +
      '<div class="detail-actions">' +
        '<button class="btn primary" id="save-task">Save Changes</button>' +
        '<button class="btn danger" id="delete-task">Delete Task</button>' +
      '</div>';

    showDetail('Edit Task', html);

    document.getElementById('save-task').addEventListener('click', async function () {
      var body = {
        prompt: document.getElementById('edit-prompt').value,
        schedule_type: document.getElementById('edit-type').value,
        schedule_value: document.getElementById('edit-value').value,
        status: document.getElementById('edit-status').value,
      };
      try {
        var res = await fetch(apiUrl('/api/tasks/' + encodeURIComponent(task.id)), {
          method: 'PATCH',
          headers: apiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        });
        if (res.ok) {
          toast('Task updated');
          refreshSidebar();
        } else {
          var err = await res.json().catch(function () { return {}; });
          toast(err.error || 'Update failed', true);
        }
      } catch (e) { toast('Network error', true); }
    });

    document.getElementById('delete-task').addEventListener('click', async function () {
      if (!confirm('Delete this task? This cannot be undone.')) return;
      try {
        var res = await fetch(apiUrl('/api/tasks/' + encodeURIComponent(task.id)), {
          method: 'DELETE',
          headers: apiHeaders(),
        });
        if (res.ok) {
          toast('Task deleted');
          showChat();
          refreshSidebar();
        } else {
          toast('Delete failed', true);
        }
      } catch (e) { toast('Network error', true); }
    });
  }

  // ---- Sidebar rendering ----
  function renderChannels(channels) {
    var el = document.getElementById('channel-list');
    if (!channels.length) { el.innerHTML = '<div class="empty-hint">None</div>'; return; }
    el.innerHTML = channels.map(function (ch, i) {
      return '<div class="item" data-channel="' + i + '">' +
        '<div class="dot ' + (ch.connected ? 'green' : 'red') + '"></div>' +
        '<span class="label">' + esc(ch.name) + '</span>' +
        '<span class="badge">' + (ch.connected ? 'online' : 'offline') + '</span>' +
      '</div>';
    }).join('');
    el.querySelectorAll('.item[data-channel]').forEach(function (item) {
      item.addEventListener('click', function () {
        document.querySelectorAll('#sidebar .item.selected').forEach(function (el) { el.classList.remove('selected'); });
        item.classList.add('selected');
        var ch = channels[parseInt(item.dataset.channel)];
        showChannelDetail(ch);
      });
    });
  }

  function renderGroups(groups) {
    var el = document.getElementById('group-list');
    if (!groups.length) { el.innerHTML = '<div class="empty-hint">None registered</div>'; return; }
    el.innerHTML = groups.map(function (g) {
      return '<div class="item">' +
        '<div class="dot ' + (g.isMain ? 'green' : 'dim') + '"></div>' +
        '<span class="label">' + esc(g.name) + '</span>' +
        (g.isMain ? '<span class="badge main">main</span>' : '') +
      '</div>';
    }).join('');
  }

  function renderTasks(tasks) {
    var el = document.getElementById('task-list');
    if (!tasks.length) { el.innerHTML = '<div class="empty-hint">No scheduled tasks</div>'; return; }
    el.innerHTML = tasks.map(function (t, i) {
      return '<div class="item" data-task="' + i + '">' +
        '<div class="dot ' + (t.status === 'active' ? 'green' : t.status === 'paused' ? 'yellow' : 'dim') + '"></div>' +
        '<span class="label">' + esc(t.prompt.length > 60 ? t.prompt.slice(0, 60) + '...' : t.prompt) + '</span>' +
        '<span class="badge ' + t.status + '">' + t.status + '</span>' +
      '</div>' +
      '<div class="task-meta">' + t.type + ': ' + esc(t.value) +
        (t.nextRun ? ' &middot; next ' + relTime(t.nextRun) : '') +
      '</div>';
    }).join('');
    el.querySelectorAll('.item[data-task]').forEach(function (item) {
      item.addEventListener('click', function () {
        document.querySelectorAll('#sidebar .item.selected').forEach(function (el) { el.classList.remove('selected'); });
        item.classList.add('selected');
        var t = tasks[parseInt(item.dataset.task)];
        showTaskDetail(t);
      });
    });
  }

  function renderChats(chats) {
    var el = document.getElementById('chat-list');
    if (!chats.length) { el.innerHTML = '<div class="empty-hint">No chats yet</div>'; return; }
    el.innerHTML = chats.slice(0, 10).map(function (c) {
      return '<div class="item">' +
        '<div class="dot dim"></div>' +
        '<span class="label">' + esc(c.name || c.jid) + '</span>' +
        '<span class="badge">' + (c.channel || '?') + '</span>' +
      '</div>';
    }).join('');
  }

  async function refreshSidebar() {
    try {
      var res = await fetch(apiUrl('/api/status'), { headers: apiHeaders() });
      if (!res.ok) return;
      statusData = await res.json();
      renderChannels(statusData.channels || []);
      renderGroups(statusData.groups || []);
      renderTasks(statusData.tasks || []);
      renderChats(statusData.chats || []);
    } catch (e) { /* ignore */ }
  }

  // ---- Theme toggle ----
  var themeBtn = document.getElementById('theme-toggle');
  var root = document.documentElement;
  var saved = localStorage.getItem('nanoclaw-theme');
  if (saved === 'light') root.classList.add('light');

  themeBtn.addEventListener('click', function () {
    root.classList.toggle('light');
    var isLight = root.classList.contains('light');
    localStorage.setItem('nanoclaw-theme', isLight ? 'light' : 'dark');
    themeBtn.innerHTML = isLight ? '&#9790;' : '&#9788;';
  });
  if (saved === 'light') themeBtn.innerHTML = '&#9790;';

  // ---- Connection flow ----
  var sidebarRefreshInterval = null;

  async function connect(endpoint, token) {
    API_BASE = endpoint.replace(/\/+$/, '');
    API_TOKEN = token;

    var res = await fetch(apiUrl('/api/status'), { headers: apiHeaders() });
    if (res.status === 401) throw new Error('Invalid token');
    if (!res.ok) throw new Error('Connection failed: ' + res.status);

    var data = await res.json();
    var name = data.assistant || 'NanoClaw';

    document.title = name + ' \u2014 NanoClaw';
    assistantTitle.textContent = name;
    input.placeholder = 'Message ' + name + '...';

    connectScreen.style.display = 'none';
    app.style.display = 'flex';

    connectSSE();
    refreshSidebar();
    sidebarRefreshInterval = setInterval(refreshSidebar, 10000);
  }

  function disconnect() {
    if (currentES) { currentES.close(); currentES = null; }
    if (sidebarRefreshInterval) { clearInterval(sidebarRefreshInterval); sidebarRefreshInterval = null; }
    API_BASE = '';
    API_TOKEN = '';
    localStorage.removeItem('nanoclaw-endpoint');
    localStorage.removeItem('nanoclaw-token');
    app.style.display = 'none';
    connectScreen.style.display = 'flex';
    connectError.style.display = 'none';
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect';
    dot.classList.remove('connected');
    statusEl.textContent = 'disconnected';
    messages.innerHTML = '<div class="empty-state" id="empty">Send a message to start chatting.</div>';
  }

  disconnectBtn.addEventListener('click', disconnect);

  connectForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var endpoint = connectEndpoint.value.trim();
    var token = connectToken.value.trim();

    if (!endpoint) {
      connectError.textContent = 'Endpoint URL is required';
      connectError.style.display = 'block';
      return;
    }

    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';
    connectError.style.display = 'none';

    try {
      await connect(endpoint, token);
      if (connectRemember.checked) {
        localStorage.setItem('nanoclaw-endpoint', endpoint);
        localStorage.setItem('nanoclaw-token', token);
      }
    } catch (err) {
      connectError.textContent = err.message || 'Connection failed';
      connectError.style.display = 'block';
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect';
    }
  });

  // ---- Auto-connect from saved credentials ----
  var savedEndpoint = localStorage.getItem('nanoclaw-endpoint');
  var savedToken = localStorage.getItem('nanoclaw-token');
  if (savedEndpoint) {
    connectEndpoint.value = savedEndpoint;
    connectToken.value = savedToken || '';
    connectRemember.checked = true;
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';
    connect(savedEndpoint, savedToken || '').catch(function (err) {
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect';
      connectError.textContent = 'Auto-connect failed: ' + (err.message || 'Unknown error');
      connectError.style.display = 'block';
    });
  }
})();
