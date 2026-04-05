(function () {
  'use strict';

  // ---- Connection state ----
  var API_BASE = '';
  var API_TOKEN = '';
  var assistantName = 'NanoClaw';

  function apiUrl(path) { return API_BASE + path; }

  function apiHeaders(extra) {
    var h = Object.assign({}, extra || {});
    if (API_TOKEN) h['Authorization'] = 'Bearer ' + API_TOKEN;
    return h;
  }

  async function api(method, path, body) {
    var opts = { method: method, headers: apiHeaders() };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    var res = await fetch(apiUrl(path), opts);
    if (res.status === 204) return null;
    var data = await res.json().catch(function () { return null; });
    if (!res.ok) throw new Error((data && data.error) || res.statusText);
    return data;
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
  var mainContent = document.getElementById('main-content');
  var toastEl = document.getElementById('toast');
  var disconnectBtnEl = document.getElementById('disconnect-btn');
  var assistantTitle = document.getElementById('assistant-title');
  var sidebarDot = document.getElementById('sidebar-dot');
  var sidebarStatusText = document.getElementById('sidebar-status-text');

  // ---- State ----
  var currentView = 'dashboard';
  var viewParams = {};
  var statusData = null;
  var currentES = null;
  var sidebarInterval = null;

  // Chat-specific state
  var chatJid = '';
  var chatMessages = [];
  var chatTyping = false;

  // ---- Toast ----
  var toastTimer = null;
  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.className = 'toast visible' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 2500);
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
    var diff = Date.now() - d.getTime();
    if (diff < 0) return 'in ' + humanDur(-diff);
    if (diff < 60000) return 'just now';
    return humanDur(diff) + ' ago';
  }

  function humanDur(ms) {
    if (ms < 60000) return Math.floor(ms / 1000) + 's';
    if (ms < 3600000) return Math.floor(ms / 60000) + 'm';
    if (ms < 86400000) return Math.floor(ms / 3600000) + 'h';
    return Math.floor(ms / 86400000) + 'd';
  }

  function fmtDate(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleString();
  }

  function renderMarkdown(text) {
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    text = text.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    return text;
  }

  // ---- Navigation ----
  function navigate(view, params) {
    currentView = view;
    viewParams = params || {};
    renderCurrentView();
    updateNavHighlight();
  }

  function updateNavHighlight() {
    document.querySelectorAll('.nav-item').forEach(function (el) {
      el.classList.toggle('active', el.dataset.view === currentView);
    });
  }

  document.querySelectorAll('.nav-item').forEach(function (el) {
    el.addEventListener('click', function () {
      navigate(el.dataset.view);
    });
  });

  function renderCurrentView() {
    switch (currentView) {
      case 'dashboard': renderDashboard(); break;
      case 'groups': renderGroups(); break;
      case 'group-detail': renderGroupDetail(); break;
      case 'tasks': renderTasks(); break;
      case 'task-detail': renderTaskDetail(); break;
      case 'task-create': renderTaskCreate(); break;
      case 'chat': renderChat(); break;
      case 'system': renderSystem(); break;
      default: renderDashboard();
    }
  }

  // ---- Periodic refresh ----
  async function refreshStatus() {
    try {
      statusData = await api('GET', '/api/status');
      var gc = document.getElementById('nav-groups-count');
      var tc = document.getElementById('nav-tasks-count');
      if (gc) gc.textContent = (statusData.groups || []).length;
      if (tc) tc.textContent = (statusData.tasks || []).length;
    } catch (e) { /* ignore */ }
  }

  // ================================================================
  // VIEW: Dashboard
  // ================================================================
  async function renderDashboard() {
    if (!statusData) await refreshStatus();
    var s = statusData || { channels: [], groups: [], tasks: [], chats: [] };

    var connectedChannels = s.channels.filter(function (c) { return c.connected; }).length;
    var activeTasks = s.tasks.filter(function (t) { return t.status === 'active'; }).length;

    mainContent.innerHTML =
      '<div class="view-header"><h2>Dashboard</h2></div>' +
      '<div class="view-body">' +
        '<div class="stat-grid">' +
          statCard(connectedChannels + '/' + s.channels.length, 'Channels') +
          statCard(s.groups.length, 'Groups') +
          statCard(activeTasks, 'Active Tasks') +
          statCard(s.chats.length, 'Chats') +
        '</div>' +

        '<div class="detail-section"><h3>Channels</h3>' +
        (s.channels.length ? '<table class="data-table"><thead><tr><th>Channel</th><th>Status</th><th>Groups</th></tr></thead><tbody>' +
          s.channels.map(function (ch) {
            return '<tr><td>' + esc(ch.name) + '</td>' +
              '<td><span class="badge ' + (ch.connected ? 'online' : 'offline') + '">' + (ch.connected ? 'online' : 'offline') + '</span></td>' +
              '<td>' + (ch.groups || []).length + '</td></tr>';
          }).join('') + '</tbody></table>' : '<div class="empty-hint">No channels</div>') +
        '</div>' +

        '<div class="detail-section"><h3>Recent Activity</h3>' +
        (s.chats.length ? '<table class="data-table"><thead><tr><th>Chat</th><th>Channel</th><th>Last Activity</th></tr></thead><tbody>' +
          s.chats.slice(0, 10).map(function (c) {
            return '<tr><td>' + esc(c.name || c.jid) + '</td>' +
              '<td>' + esc(c.channel || '-') + '</td>' +
              '<td>' + relTime(c.lastActivity) + '</td></tr>';
          }).join('') + '</tbody></table>' : '<div class="empty-hint">No activity yet</div>') +
        '</div>' +
      '</div>';
  }

  function statCard(value, label) {
    return '<div class="stat-card"><div class="stat-value">' + esc(String(value)) + '</div><div class="stat-label">' + esc(label) + '</div></div>';
  }

  // ================================================================
  // VIEW: Groups
  // ================================================================
  async function renderGroups() {
    mainContent.innerHTML = '<div class="view-header"><h2>Groups</h2></div><div class="view-body"><div class="empty-hint">Loading...</div></div>';
    try {
      var groups = await api('GET', '/api/groups');
      var body = '<div class="view-header"><h2>Groups</h2></div><div class="view-body">';
      if (!groups.length) {
        body += '<div class="empty-hint">No groups registered</div>';
      } else {
        body += '<table class="data-table"><thead><tr><th>Name</th><th>Folder</th><th>Channel</th><th>Trigger</th><th>Type</th><th>Added</th></tr></thead><tbody>';
        groups.forEach(function (g) {
          var channel = g.jid.split(':')[0] || '-';
          body += '<tr class="clickable" data-jid="' + esc(g.jid) + '">' +
            '<td><strong>' + esc(g.name) + '</strong></td>' +
            '<td><code>' + esc(g.folder) + '</code></td>' +
            '<td>' + esc(channel) + '</td>' +
            '<td><code>' + esc(g.trigger) + '</code></td>' +
            '<td>' + (g.isMain ? '<span class="badge main">main</span>' : g.requiresTrigger ? 'trigger' : 'auto') + '</td>' +
            '<td>' + relTime(g.added_at) + '</td></tr>';
        });
        body += '</tbody></table>';
      }
      body += '</div>';
      mainContent.innerHTML = body;

      mainContent.querySelectorAll('tr.clickable').forEach(function (tr) {
        tr.addEventListener('click', function () {
          navigate('group-detail', { jid: tr.dataset.jid });
        });
      });
    } catch (e) {
      mainContent.innerHTML = '<div class="view-header"><h2>Groups</h2></div><div class="view-body"><div class="empty-hint">Error: ' + esc(e.message) + '</div></div>';
    }
  }

  // ================================================================
  // VIEW: Group Detail
  // ================================================================
  async function renderGroupDetail() {
    var jid = viewParams.jid;
    mainContent.innerHTML = '<div class="view-header"><button class="back-link" id="back-groups">&larr; Groups</button><h2>Loading...</h2></div><div class="view-body"></div>';
    wireBack('back-groups', 'groups');

    try {
      var g = await api('GET', '/api/groups/' + encodeURIComponent(jid));
      var sessions = await api('GET', '/api/sessions');
      var session = sessions.find(function (s) { return s.folder === g.folder; });

      var body =
        '<div class="view-header">' +
          '<button class="back-link" id="back-groups2">&larr; Groups</button>' +
          '<h2>' + esc(g.name) + '</h2>' +
          (g.isMain ? '<span class="badge main">main</span>' : '') +
        '</div>' +
        '<div class="view-body">' +
          '<div class="detail-section"><h3>Configuration</h3>' +
            '<div class="form-grid">' +
              formField('Name', '<input id="g-name" value="' + esc(g.name) + '">') +
              formField('Trigger', '<input id="g-trigger" value="' + esc(g.trigger) + '">') +
              formField('Requires Trigger', '<select id="g-reqtrigger"><option value="true"' + (g.requiresTrigger ? ' selected' : '') + '>Yes</option><option value="false"' + (!g.requiresTrigger ? ' selected' : '') + '>No</option></select>') +
              formField('Container Timeout (ms)', '<input id="g-timeout" type="number" value="' + ((g.containerConfig && g.containerConfig.timeout) || '') + '" placeholder="Default: 300000">') +
            '</div>' +
            '<div class="form-actions">' +
              '<button class="btn primary" id="save-group">Save Changes</button>' +
              (!g.isMain ? '<button class="btn danger" id="delete-group">Delete Group</button>' : '') +
            '</div>' +
          '</div>' +

          '<div class="detail-section"><h3>Info</h3>' +
            detailRow('JID', g.jid, true) +
            detailRow('Folder', g.folder, true) +
            detailRow('Added', fmtDate(g.added_at)) +
            detailRow('Session', session ? '<span title="' + esc(session.sessionId) + '">' + esc(session.sessionId.slice(0, 16)) + '...</span> <button class="btn sm danger" id="clear-session">Clear</button>' : 'None') +
          '</div>' +

          '<div class="detail-section"><h3>Message History</h3>' +
            '<button class="btn sm" id="load-messages">Load Messages</button>' +
            '<div id="message-area"></div>' +
          '</div>' +
        '</div>';

      mainContent.innerHTML = body;
      wireBack('back-groups2', 'groups');

      // Save group
      on('save-group', 'click', async function () {
        try {
          var updates = {
            name: document.getElementById('g-name').value,
            trigger: document.getElementById('g-trigger').value,
            requiresTrigger: document.getElementById('g-reqtrigger').value === 'true',
          };
          var timeout = parseInt(document.getElementById('g-timeout').value, 10);
          if (timeout > 0) updates.containerConfig = { timeout: timeout };
          await api('PATCH', '/api/groups/' + encodeURIComponent(jid), updates);
          toast('Group updated');
          refreshStatus();
        } catch (e) { toast(e.message, true); }
      });

      // Delete group
      on('delete-group', 'click', async function () {
        if (!confirm('Delete this group registration? Group folder on disk will be preserved.')) return;
        try {
          await api('DELETE', '/api/groups/' + encodeURIComponent(jid));
          toast('Group deleted');
          refreshStatus();
          navigate('groups');
        } catch (e) { toast(e.message, true); }
      });

      // Clear session
      on('clear-session', 'click', async function () {
        try {
          await api('DELETE', '/api/sessions/' + encodeURIComponent(g.folder));
          toast('Session cleared');
          renderGroupDetail();
        } catch (e) { toast(e.message, true); }
      });

      // Load messages
      on('load-messages', 'click', async function () {
        try {
          var msgs = await api('GET', '/api/groups/' + encodeURIComponent(jid) + '/messages?limit=50');
          var area = document.getElementById('message-area');
          if (!msgs.length) {
            area.innerHTML = '<div class="empty-hint">No messages</div>';
            return;
          }
          area.innerHTML = '<div class="message-list">' + msgs.map(function (m) {
            return '<div class="message-item">' +
              '<span class="msg-time">' + relTime(m.timestamp) + '</span>' +
              '<span class="msg-sender">' + esc(m.sender_name) + '</span>' +
              '<span class="msg-content">' + esc(m.content.length > 200 ? m.content.slice(0, 200) + '...' : m.content) + '</span>' +
            '</div>';
          }).join('') + '</div>';
        } catch (e) { toast(e.message, true); }
      });

    } catch (e) {
      mainContent.innerHTML = '<div class="view-header"><button class="back-link" id="back-groups3">&larr; Groups</button><h2>Error</h2></div><div class="view-body"><div class="empty-hint">' + esc(e.message) + '</div></div>';
      wireBack('back-groups3', 'groups');
    }
  }

  // ================================================================
  // VIEW: Tasks
  // ================================================================
  async function renderTasks() {
    mainContent.innerHTML = '<div class="view-header"><h2>Tasks</h2><div class="actions"><button class="btn primary" id="new-task">+ New Task</button></div></div><div class="view-body"><div class="empty-hint">Loading...</div></div>';
    on('new-task', 'click', function () { navigate('task-create'); });

    try {
      if (!statusData) await refreshStatus();
      var tasks = (statusData && statusData.tasks) || [];

      var html = '<div class="view-header"><h2>Tasks</h2><div class="actions"><button class="btn primary" id="new-task2">+ New Task</button></div></div><div class="view-body">';
      if (!tasks.length) {
        html += '<div class="empty-hint">No scheduled tasks</div>';
      } else {
        html += '<table class="data-table"><thead><tr><th>Prompt</th><th>Group</th><th>Schedule</th><th>Status</th><th>Next Run</th><th>Last Run</th></tr></thead><tbody>';
        tasks.forEach(function (t) {
          html += '<tr class="clickable" data-id="' + esc(t.id) + '">' +
            '<td><span class="truncate">' + esc(t.prompt) + '</span></td>' +
            '<td><code>' + esc(t.group) + '</code></td>' +
            '<td>' + esc(t.type) + ': <code>' + esc(t.value) + '</code></td>' +
            '<td><span class="badge ' + t.status + '">' + t.status + '</span></td>' +
            '<td>' + relTime(t.nextRun) + '</td>' +
            '<td>' + relTime(t.lastRun) + '</td></tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';
      mainContent.innerHTML = html;

      on('new-task2', 'click', function () { navigate('task-create'); });
      mainContent.querySelectorAll('tr.clickable').forEach(function (tr) {
        tr.addEventListener('click', function () {
          navigate('task-detail', { id: tr.dataset.id });
        });
      });
    } catch (e) {
      mainContent.innerHTML = '<div class="view-header"><h2>Tasks</h2></div><div class="view-body"><div class="empty-hint">Error: ' + esc(e.message) + '</div></div>';
    }
  }

  // ================================================================
  // VIEW: Task Detail
  // ================================================================
  async function renderTaskDetail() {
    var id = viewParams.id;
    mainContent.innerHTML = '<div class="view-header"><button class="back-link" id="back-tasks">&larr; Tasks</button><h2>Loading...</h2></div><div class="view-body"></div>';
    wireBack('back-tasks', 'tasks');

    try {
      var t = await api('GET', '/api/tasks/' + encodeURIComponent(id));
      var logs = await api('GET', '/api/tasks/' + encodeURIComponent(id) + '/logs?limit=20');

      var html =
        '<div class="view-header">' +
          '<button class="back-link" id="back-tasks2">&larr; Tasks</button>' +
          '<h2>Edit Task</h2>' +
          '<span class="badge ' + t.status + '">' + t.status + '</span>' +
        '</div>' +
        '<div class="view-body">' +
          '<div class="detail-section"><h3>Configuration</h3>' +
            '<div class="form-grid">' +
              formField('Prompt', '<textarea id="t-prompt">' + esc(t.prompt) + '</textarea>') +
              formField('Schedule Type', '<select id="t-type"><option value="cron"' + (t.schedule_type === 'cron' ? ' selected' : '') + '>Cron</option><option value="interval"' + (t.schedule_type === 'interval' ? ' selected' : '') + '>Interval (ms)</option><option value="once"' + (t.schedule_type === 'once' ? ' selected' : '') + '>Once</option></select>') +
              formField('Schedule Value', '<input id="t-value" value="' + esc(t.schedule_value) + '">') +
              formField('Status', '<select id="t-status"><option value="active"' + (t.status === 'active' ? ' selected' : '') + '>Active</option><option value="paused"' + (t.status === 'paused' ? ' selected' : '') + '>Paused</option></select>') +
            '</div>' +
            '<div class="form-actions">' +
              '<button class="btn primary" id="save-task">Save Changes</button>' +
              '<button class="btn danger" id="delete-task">Delete Task</button>' +
            '</div>' +
          '</div>' +

          '<div class="detail-section"><h3>Info</h3>' +
            detailRow('ID', t.id, true) +
            detailRow('Group', t.group_folder, true) +
            detailRow('Chat JID', t.chat_jid, true) +
            detailRow('Context Mode', t.context_mode || 'isolated') +
            detailRow('Next Run', t.next_run ? fmtDate(t.next_run) + ' (' + relTime(t.next_run) + ')' : '-') +
            detailRow('Last Run', t.last_run ? fmtDate(t.last_run) + ' (' + relTime(t.last_run) + ')' : '-') +
            (t.last_result ? detailRow('Last Result', '<span class="truncate" style="max-width:500px">' + esc(t.last_result) + '</span>') : '') +
          '</div>' +

          '<div class="detail-section"><h3>Run History</h3>' +
          (logs.length ?
            '<table class="data-table"><thead><tr><th>Time</th><th>Duration</th><th>Status</th><th>Result</th></tr></thead><tbody>' +
            logs.map(function (l) {
              return '<tr>' +
                '<td>' + fmtDate(l.run_at) + '</td>' +
                '<td>' + humanDur(l.duration_ms) + '</td>' +
                '<td><span class="badge ' + l.status + '">' + l.status + '</span></td>' +
                '<td><span class="truncate">' + esc((l.result || l.error || '-').slice(0, 100)) + '</span></td></tr>';
            }).join('') + '</tbody></table>'
          : '<div class="empty-hint">No runs yet</div>') +
          '</div>' +
        '</div>';

      mainContent.innerHTML = html;
      wireBack('back-tasks2', 'tasks');

      on('save-task', 'click', async function () {
        try {
          await api('PATCH', '/api/tasks/' + encodeURIComponent(id), {
            prompt: document.getElementById('t-prompt').value,
            schedule_type: document.getElementById('t-type').value,
            schedule_value: document.getElementById('t-value').value,
            status: document.getElementById('t-status').value,
          });
          toast('Task updated');
          refreshStatus();
        } catch (e) { toast(e.message, true); }
      });

      on('delete-task', 'click', async function () {
        if (!confirm('Delete this task? This cannot be undone.')) return;
        try {
          await api('DELETE', '/api/tasks/' + encodeURIComponent(id));
          toast('Task deleted');
          refreshStatus();
          navigate('tasks');
        } catch (e) { toast(e.message, true); }
      });

    } catch (e) {
      mainContent.innerHTML = '<div class="view-header"><button class="back-link" id="back-tasks3">&larr; Tasks</button><h2>Error</h2></div><div class="view-body"><div class="empty-hint">' + esc(e.message) + '</div></div>';
      wireBack('back-tasks3', 'tasks');
    }
  }

  // ================================================================
  // VIEW: Task Create
  // ================================================================
  async function renderTaskCreate() {
    var groups = [];
    try { groups = await api('GET', '/api/groups'); } catch (e) { /* ignore */ }

    var groupOpts = groups.map(function (g) {
      return '<option value="' + esc(g.folder) + '" data-jid="' + esc(g.jid) + '">' + esc(g.name) + ' (' + esc(g.folder) + ')</option>';
    }).join('');

    mainContent.innerHTML =
      '<div class="view-header"><button class="back-link" id="back-tasks4">&larr; Tasks</button><h2>New Task</h2></div>' +
      '<div class="view-body">' +
        '<div class="form-grid">' +
          formField('Prompt', '<textarea id="nt-prompt" placeholder="What should the agent do?"></textarea>') +
          formField('Group', '<select id="nt-group">' + groupOpts + '</select>') +
          formField('Schedule Type', '<select id="nt-type"><option value="cron">Cron</option><option value="interval">Interval (ms)</option><option value="once">Once</option></select>') +
          formField('Schedule Value', '<input id="nt-value" placeholder="e.g. 0 9 * * * or 3600000">', 'Cron expression, interval in ms, or ISO timestamp for once') +
          formField('Context Mode', '<select id="nt-context"><option value="isolated">Isolated</option><option value="group">Group</option></select>', 'Isolated: fresh context each run. Group: shares group conversation.') +
        '</div>' +
        '<div class="form-actions">' +
          '<button class="btn primary" id="create-task">Create Task</button>' +
          '<button class="btn" id="cancel-create">Cancel</button>' +
        '</div>' +
      '</div>';

    wireBack('back-tasks4', 'tasks');
    on('cancel-create', 'click', function () { navigate('tasks'); });

    on('create-task', 'click', async function () {
      var groupSelect = document.getElementById('nt-group');
      var selectedOpt = groupSelect.options[groupSelect.selectedIndex];
      try {
        await api('POST', '/api/tasks', {
          prompt: document.getElementById('nt-prompt').value,
          group_folder: groupSelect.value,
          chat_jid: selectedOpt.dataset.jid,
          schedule_type: document.getElementById('nt-type').value,
          schedule_value: document.getElementById('nt-value').value,
          context_mode: document.getElementById('nt-context').value,
        });
        toast('Task created');
        refreshStatus();
        navigate('tasks');
      } catch (e) { toast(e.message, true); }
    });
  }

  // ================================================================
  // VIEW: Chat
  // ================================================================
  async function renderChat() {
    var groups = [];
    try { groups = await api('GET', '/api/groups'); } catch (e) { /* ignore */ }

    // Default to first group or web:localhost
    if (!chatJid && groups.length) chatJid = groups[0].jid;

    var groupOpts = groups.map(function (g) {
      return '<option value="' + esc(g.jid) + '"' + (g.jid === chatJid ? ' selected' : '') + '>' + esc(g.name) + ' (' + esc(g.jid) + ')</option>';
    }).join('');

    mainContent.innerHTML =
      '<div class="chat-container">' +
        '<div class="chat-header">' +
          '<div class="dot' + (currentES ? ' connected' : '') + '" id="chat-dot"></div>' +
          '<select id="chat-group">' + groupOpts + '</select>' +
          '<span class="chat-header .status-text" id="chat-status">' + (currentES ? 'connected' : 'connecting...') + '</span>' +
          '<div style="margin-left:auto"><button class="btn sm" id="load-history">Load History</button></div>' +
        '</div>' +
        '<div class="chat-messages" id="chat-messages">' +
          '<div class="empty-state" id="chat-empty">Send a message to start chatting.</div>' +
        '</div>' +
        '<div class="typing-indicator" id="chat-typing"><span>.</span><span>.</span><span>.</span> thinking</div>' +
        '<div class="chat-input">' +
          '<form id="chat-form">' +
            '<textarea id="chat-input" rows="1" placeholder="Message ' + esc(assistantName) + '..." autofocus></textarea>' +
            '<button type="submit">Send</button>' +
          '</form>' +
        '</div>' +
      '</div>';

    var messagesDiv = document.getElementById('chat-messages');
    var emptyDiv = document.getElementById('chat-empty');
    var typingDiv = document.getElementById('chat-typing');
    var chatInputEl = document.getElementById('chat-input');

    // Restore chat messages if we navigated away and back
    if (chatMessages.length) {
      emptyDiv.style.display = 'none';
      chatMessages.forEach(function (m) {
        appendChatMsg(messagesDiv, m.text, m.cls);
      });
    }

    // Group selector
    on('chat-group', 'change', function () {
      chatJid = document.getElementById('chat-group').value;
      chatMessages = [];
      messagesDiv.innerHTML = '<div class="empty-state" id="chat-empty">Send a message to start chatting.</div>';
    });

    // Load history
    on('load-history', 'click', async function () {
      try {
        var msgs = await api('GET', '/api/groups/' + encodeURIComponent(chatJid) + '/messages?limit=30');
        if (!msgs.length) { toast('No messages'); return; }
        chatMessages = [];
        messagesDiv.innerHTML = '';
        msgs.forEach(function (m) {
          var cls = m.is_from_me ? 'user' : 'bot';
          chatMessages.push({ text: m.content, cls: cls });
          appendChatMsg(messagesDiv, m.content, cls);
        });
      } catch (e) { toast(e.message, true); }
    });

    // Auto-resize textarea
    chatInputEl.addEventListener('input', function () {
      chatInputEl.style.height = 'auto';
      chatInputEl.style.height = Math.min(chatInputEl.scrollHeight, 200) + 'px';
    });

    chatInputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('chat-form').dispatchEvent(new Event('submit'));
      }
    });

    document.getElementById('chat-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var text = chatInputEl.value.trim();
      if (!text) return;

      emptyDiv && (emptyDiv.style.display = 'none');
      chatMessages.push({ text: text, cls: 'user' });
      appendChatMsg(messagesDiv, text, 'user');
      chatInputEl.value = '';
      chatInputEl.style.height = 'auto';

      try {
        await api('POST', '/api/message', { text: text, chat_jid: chatJid });
      } catch (err) {
        chatMessages.push({ text: 'Error: ' + err.message, cls: 'bot' });
        appendChatMsg(messagesDiv, 'Error: ' + err.message, 'bot');
      }
    });
  }

  function appendChatMsg(container, text, cls) {
    var div = document.createElement('div');
    div.className = 'msg ' + cls;
    if (cls === 'bot') {
      div.innerHTML = renderMarkdown(text);
    } else {
      div.textContent = text;
    }
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  // ================================================================
  // VIEW: System
  // ================================================================
  async function renderSystem() {
    mainContent.innerHTML = '<div class="view-header"><h2>System</h2></div><div class="view-body"><div class="empty-hint">Loading...</div></div>';

    try {
      var results = await Promise.all([
        api('GET', '/api/status'),
        api('GET', '/api/sessions'),
        api('GET', '/api/chats'),
      ]);
      var status = results[0];
      var sessions = results[1];
      var chats = results[2];

      var html =
        '<div class="view-header"><h2>System</h2></div>' +
        '<div class="view-body">' +

        '<div class="detail-section"><h3>Channels</h3>' +
        '<table class="data-table"><thead><tr><th>Channel</th><th>Status</th><th>Groups</th></tr></thead><tbody>' +
        (status.channels || []).map(function (ch) {
          return '<tr><td>' + esc(ch.name) + '</td>' +
            '<td><span class="badge ' + (ch.connected ? 'online' : 'offline') + '">' + (ch.connected ? 'online' : 'offline') + '</span></td>' +
            '<td>' + (ch.groups || []).map(function (g) { return esc(g.name); }).join(', ') + '</td></tr>';
        }).join('') +
        '</tbody></table></div>' +

        '<div class="detail-section"><h3>Sessions</h3>' +
        (sessions.length ?
          '<table class="data-table"><thead><tr><th>Group Folder</th><th>Session ID</th><th>Action</th></tr></thead><tbody>' +
          sessions.map(function (s) {
            return '<tr><td><code>' + esc(s.folder) + '</code></td>' +
              '<td><code style="font-size:11px">' + esc(s.sessionId.slice(0, 24)) + '...</code></td>' +
              '<td><button class="btn sm danger clear-session-btn" data-folder="' + esc(s.folder) + '">Clear</button></td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="empty-hint">No active sessions</div>') +
        '</div>' +

        '<div class="detail-section"><h3>All Chats (' + chats.length + ')</h3>' +
        (chats.length ?
          '<table class="data-table"><thead><tr><th>Name</th><th>JID</th><th>Channel</th><th>Type</th><th>Last Activity</th></tr></thead><tbody>' +
          chats.slice(0, 50).map(function (c) {
            return '<tr><td>' + esc(c.name || '-') + '</td>' +
              '<td><code style="font-size:11px">' + esc(c.jid) + '</code></td>' +
              '<td>' + esc(c.channel || '-') + '</td>' +
              '<td>' + (c.is_group ? 'group' : 'direct') + '</td>' +
              '<td>' + relTime(c.last_message_time) + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="empty-hint">No chats</div>') +
        '</div>' +

        '</div>';

      mainContent.innerHTML = html;

      // Wire clear session buttons
      mainContent.querySelectorAll('.clear-session-btn').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          try {
            await api('DELETE', '/api/sessions/' + encodeURIComponent(btn.dataset.folder));
            toast('Session cleared');
            renderSystem();
          } catch (e) { toast(e.message, true); }
        });
      });

    } catch (e) {
      mainContent.innerHTML = '<div class="view-header"><h2>System</h2></div><div class="view-body"><div class="empty-hint">Error: ' + esc(e.message) + '</div></div>';
    }
  }

  // ================================================================
  // Helpers for view rendering
  // ================================================================
  function formField(label, inputHtml, hint) {
    return '<div class="form-field"><label>' + esc(label) + '</label>' + inputHtml +
      (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>';
  }

  function detailRow(label, value, mono) {
    return '<div class="detail-row"><span class="label">' + esc(label) + '</span><span class="value' + (mono ? ' mono' : '') + '">' + value + '</span></div>';
  }

  function on(id, event, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(event, fn);
  }

  function wireBack(id, view) {
    on(id, 'click', function () { navigate(view); });
  }

  // ================================================================
  // SSE
  // ================================================================
  function connectSSE() {
    if (currentES) { currentES.close(); currentES = null; }
    var sseUrl = apiUrl('/api/events') + (API_TOKEN ? '?token=' + encodeURIComponent(API_TOKEN) : '');
    var es = new EventSource(sseUrl);
    currentES = es;

    es.onopen = function () {
      sidebarDot.classList.add('connected');
      sidebarStatusText.textContent = 'connected';
      var chatDot = document.getElementById('chat-dot');
      if (chatDot) chatDot.classList.add('connected');
    };

    es.onmessage = function (e) {
      try {
        var data = JSON.parse(e.data);
        if (data.type === 'message') {
          // If on chat view, append message
          var messagesDiv = document.getElementById('chat-messages');
          var typingDiv = document.getElementById('chat-typing');
          if (messagesDiv && currentView === 'chat') {
            var emptyDiv = document.getElementById('chat-empty');
            if (emptyDiv) emptyDiv.style.display = 'none';
            if (typingDiv) typingDiv.classList.remove('visible');
            chatMessages.push({ text: data.text, cls: 'bot' });
            appendChatMsg(messagesDiv, data.text, 'bot');
          }
        } else if (data.type === 'typing') {
          var typingDiv2 = document.getElementById('chat-typing');
          if (typingDiv2 && currentView === 'chat') {
            typingDiv2.classList.toggle('visible', data.isTyping);
            if (data.isTyping) {
              var md = document.getElementById('chat-messages');
              if (md) md.scrollTop = md.scrollHeight;
            }
          }
        }
      } catch (err) { /* ignore */ }
    };

    es.onerror = function () {
      sidebarDot.classList.remove('connected');
      sidebarStatusText.textContent = 'reconnecting...';
      var chatDot = document.getElementById('chat-dot');
      if (chatDot) chatDot.classList.remove('connected');
      es.close();
      currentES = null;
      setTimeout(connectSSE, 3000);
    };
  }

  // ================================================================
  // Theme toggle
  // ================================================================
  var themeBtn = document.getElementById('theme-toggle');
  var root = document.documentElement;
  var savedTheme = localStorage.getItem('nanoclaw-theme');
  if (savedTheme === 'light') root.classList.add('light');

  themeBtn.addEventListener('click', function () {
    root.classList.toggle('light');
    var isLight = root.classList.contains('light');
    localStorage.setItem('nanoclaw-theme', isLight ? 'light' : 'dark');
    themeBtn.innerHTML = isLight ? '&#9790;' : '&#9788;';
  });
  if (savedTheme === 'light') themeBtn.innerHTML = '&#9790;';

  // ================================================================
  // Connection flow
  // ================================================================
  async function connect(endpoint, token) {
    API_BASE = endpoint.replace(/\/+$/, '');
    API_TOKEN = token;

    var res = await fetch(apiUrl('/api/status'), { headers: apiHeaders() });
    if (res.status === 401) throw new Error('Invalid token');
    if (!res.ok) throw new Error('Connection failed: ' + res.status);

    statusData = await res.json();
    assistantName = statusData.assistant || 'NanoClaw';

    document.title = assistantName + ' \u2014 NanoClaw';
    assistantTitle.textContent = assistantName;

    connectScreen.style.display = 'none';
    app.style.display = 'flex';

    connectSSE();
    navigate('dashboard');
    sidebarInterval = setInterval(refreshStatus, 10000);
  }

  function disconnect() {
    if (currentES) { currentES.close(); currentES = null; }
    if (sidebarInterval) { clearInterval(sidebarInterval); sidebarInterval = null; }
    API_BASE = '';
    API_TOKEN = '';
    statusData = null;
    chatMessages = [];
    chatJid = '';
    localStorage.removeItem('nanoclaw-endpoint');
    localStorage.removeItem('nanoclaw-token');
    app.style.display = 'none';
    connectScreen.style.display = 'flex';
    connectError.style.display = 'none';
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect';
    sidebarDot.classList.remove('connected');
    sidebarStatusText.textContent = 'disconnected';
  }

  disconnectBtnEl.addEventListener('click', disconnect);

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
