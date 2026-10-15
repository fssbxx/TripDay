/* 行程安排工具 · 移动端 Web 应用（原生 JS，无框架） */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var toastEl = document.getElementById('toast');

  // ------------------------------------------------------------------ 状态
  var state = {
    user: null,
    scheduleName: null,
    schedule: null,
    activeDay: 0,
    editIndex: null,
    sheet: null,            // { tab:'common'|'onsite' }
    exportFromList: false,  // 「导出与分享」是从行程列表直接进入（返回时回到列表）
    locsFrom: null,         // 「现场教学地点」的入口：'list' 表示从行程列表进入
    regionsTree: null,
    defaultRegion: { province: '陕西', city: '榆林', district: '榆阳区' },
    filters: {},            // key -> {province,city,district}
    sheetLocations: [],
    viewLocations: [],
    activeSelectKey: null
  };

  // ------------------------------------------------------------------ 工具
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function enc(s) { return encodeURIComponent(String(s)); }
  // 取「YYYY-MM-DD HH:MM」用于展示
  function fmtTime(s) { return String(s || '').slice(0, 16); }

  var notifyTimer;
  var tlDragGuard = 0;      // 刚结束拖动的时间戳，用于屏蔽随之而来的误点击
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  async function api(path, opt) {
    opt = opt || {};
    var init = { method: opt.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opt.body instanceof FormData) {
      init.body = opt.body;
    } else if (opt.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opt.body);
    }
    var res = await fetch(path, init);
    if (opt.raw) return res;
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      var detail = data && data.detail;
      var err = new Error(typeof detail === 'string' ? detail : ('请求失败 (' + res.status + ')'));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ------------------------------------------------------------------ 图标
  var I = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    edit: '<path d="M12 20h8"/><path d="M16.5 3.5l4 4L8 20H4v-4z"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6.5 7l1 13h9l1-13"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
    folder: '<path d="M3 7a2 2 0 012-2h3.6l2 2H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
    calplus: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M12 13v5M9.5 15.5h5"/>',
    share: '<circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="6.5" r="2.4"/><circle cx="18" cy="17.5" r="2.4"/><path d="M8.1 10.9l7.8-3.3"/><path d="M8.1 13.1l7.8 3.3"/>',
    pin: '<path d="M12 22s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="11" r="2.6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    chev: '<path d="M9 5l7 7-7 7"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9 2 2 0 11-2.8 2.8 1.7 1.7 0 00-2.9 1.2 2 2 0 11-4 0 1.7 1.7 0 00-2.9-1.2 2 2 0 11-2.8-2.8A1.7 1.7 0 003 13.6a2 2 0 110-4 1.7 1.7 0 001.5-2.9 2 2 0 112.8-2.8A1.7 1.7 0 0010 3.1a2 2 0 114 0 1.7 1.7 0 002.9 1.2 2 2 0 112.8 2.8A1.7 1.7 0 0021 9.6a2 2 0 110 4 1.7 1.7 0 00-1.6 1.4z"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3.2 3.2 0 010 7M18 20c0-2.4-.9-4.6-2.4-6.2"/>',
    logout: '<path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3"/><path d="M10 12H3"/><path d="M6 8l-3 4 3 4"/>',
    lock: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>',
    doc: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
    image: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    pdf: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v3M14 20h6"/>',
    bus: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M4 11h16"/><circle cx="8" cy="18.5" r="1.3"/><circle cx="16" cy="18.5" r="1.3"/>',
    tea: '<path d="M5 7h11v6a4 4 0 01-4 4H9a4 4 0 01-4-4z"/><path d="M16 9h2a2 2 0 010 4h-2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'
  };
  function icon(n, cls) { return '<svg class="' + (cls || 'ic') + '" viewBox="0 0 24 24">' + I[n] + '</svg>'; }

  // 空状态：圆形图标 + 文案（第二个参数传 null 则不显示图标）
  function emptyHtml(text, ic) {
    var badge = (ic === null) ? '' : '<span class="ei">' + icon(ic || 'folder', 'ic') + '</span>';
    return '<div class="empty">' + badge + '<p>' + text + '</p></div>';
  }

  // DAY 页签行：左右可滑动时显示边缘渐隐提示
  function syncTabsFade(el) {
    var max = el.scrollWidth - el.clientWidth;
    el.classList.toggle('fade-l', el.scrollLeft > 2);
    el.classList.toggle('fade-r', max > 2 && el.scrollLeft < max - 2);
  }

  // ------------------------------------------------------------------ 行政区划辅助
  function provObj(name) { return (state.regionsTree || []).find(function (p) { return p.name === name; }); }
  function cityObj(p, name) { return p ? (p.children || []).find(function (c) { return c.name === name; }) : null; }
  function getFilter(key) {
    if (!state.filters[key]) state.filters[key] = Object.assign({ district: '' }, state.defaultRegion);
    return state.filters[key];
  }
  async function ensureRegions() {
    if (state.regionsTree) return;
    var data = await api('/api/regions');
    state.regionsTree = data.tree || [];
    if (data.default) state.defaultRegion = data.default;
    // 后端默认地区给的是区县名称，前端下拉用 aid，这里换算一次
    var p = provObj(state.defaultRegion.province);
    var c = cityObj(p, state.defaultRegion.city);
    var d = c && (c.children || []).find(function (x) { return x.name === state.defaultRegion.district; });
    state.defaultRegion.district = d ? d.aid : '';
  }
  function regionLabel(key) {
    var f = getFilter(key);
    var parts = [];
    if (f.province) parts.push(f.province);
    if (f.city) parts.push(f.city);
    if (f.district) {
      var c = cityObj(provObj(f.province), f.city);
      var d = c && (c.children || []).find(function (x) { return x.aid === f.district; });
      if (d) parts.push(d.name);
    }
    return parts.length ? parts.join(' · ') : '全国';
  }
  function regionPickerHtml(key) {
    return '<button type="button" class="pickrow" data-pick="' + key + '">' +
      '<span class="pk-txt">' + esc(regionLabel(key)) + '</span>' +
      icon('chev', 'ic chev') + '</button>';
  }
  function locationQuery(key) {
    var f = getFilter(key);
    var q = [];
    if (f.province) q.push('province=' + enc(f.province));
    if (f.city) q.push('city=' + enc(f.city));
    if (f.district) q.push('district=' + enc(f.district));
    return q.length ? '?' + q.join('&') : '';
  }

  // ------------------------------------------------------------------ 地区滚轮选择（微信风格）
  var PICK_H = 44;   // 每项高度，需与 .pk-item 的 CSS 高度一致
  function colValues(col, sel) {
    var p = provObj(sel.province);
    if (col === 'province') return [''].concat((state.regionsTree || []).map(function (x) { return x.name; }));
    if (col === 'city') return [''].concat(p ? (p.children || []).map(function (x) { return x.name; }) : []);
    var c = cityObj(p, sel.city);
    return [''].concat(c ? (c.children || []).map(function (x) { return x.aid; }) : []);
  }
  function colLabel(col, v, sel) {
    if (col === 'province') return v || '全国';
    if (col === 'city') return v || '全部';
    if (!v) return '全部';
    var c = cityObj(provObj(sel.province), sel.city);
    var d = c && (c.children || []).find(function (x) { return x.aid === v; });
    return d ? d.name : '';
  }
  function drawCol(colEl, col, sel) {
    var vals = colValues(col, sel);
    colEl.innerHTML = vals.map(function (v) {
      return '<div class="pk-item' + (v === sel[col] ? ' on' : '') + '" data-v="' + esc(v) + '">' +
        esc(colLabel(col, v, sel)) + '</div>';
    }).join('');
    var idx = vals.indexOf(sel[col]);
    colEl.scrollTop = (idx < 0 ? 0 : idx) * PICK_H;
  }
  function markCol(colEl, col, sel) {
    $$('.pk-item', colEl).forEach(function (it) {
      it.classList.toggle('on', it.dataset.v === sel[col]);
    });
  }
  function applyRegion(key, sel) {
    var f = getFilter(key);
    f.province = sel.province; f.city = sel.city; f.district = sel.district;
    if (key === 'view') loadViewLocations().then(renderLocations);
    else if (key === 'sheet') loadSheetLocations().then(renderSheet);
    else if (key === 'form') locationFormRefresh();
  }
  async function openRegionPicker(key) {
    await ensureRegions();
    var f = getFilter(key);
    var sel = { province: f.province || '', city: f.city || '', district: f.district || '' };

    var overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML =
      '<div class="picker">' +
      '<div class="pk-head">' +
      '<button class="pk-btn" id="pkCancel">取消</button>' +
      '<div class="pk-title">选择地区</div>' +
      '<button class="pk-btn ok" id="pkOk">确定</button>' +
      '</div>' +
      '<div class="pk-cols"><div class="pk-band"></div>' +
      '<div class="pk-col" data-col="province"></div>' +
      '<div class="pk-col" data-col="city"></div>' +
      '<div class="pk-col" data-col="district"></div>' +
      '</div></div>';
    document.body.appendChild(overlay);

    var cols = {};
    ['province', 'city', 'district'].forEach(function (col) {
      var colEl = overlay.querySelector('.pk-col[data-col="' + col + '"]');
      cols[col] = colEl;
      drawCol(colEl, col, sel);
      var timer;
      colEl.addEventListener('scroll', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          var vals = colValues(col, sel);
          var idx = Math.max(0, Math.min(vals.length - 1, Math.round(colEl.scrollTop / PICK_H)));
          var v = vals[idx];
          if (sel[col] === v) return;
          sel[col] = v;
          if (col === 'province') { sel.city = ''; sel.district = ''; drawCol(cols.city, 'city', sel); drawCol(cols.district, 'district', sel); }
          else if (col === 'city') { sel.district = ''; drawCol(cols.district, 'district', sel); }
          markCol(colEl, col, sel);
        }, 120);
      });
    });

    overlay.querySelector('#pkCancel').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#pkOk').addEventListener('click', function () {
      overlay.remove();
      applyRegion(key, sel);
    });
  }

  // ------------------------------------------------------------------ 登录
  function renderLogin() {
    app.innerHTML =
      '<div class="loginwrap">' +
      '<div class="logo">' + icon('calplus', 'ic') + '</div>' +
      '<h1>行程安排工具</h1>' +
      '<div class="tag">登录后管理你的培训行程</div>' +
      '<div class="fields">' +
      '<div class="field"><span class="fi">' + icon('users', 'ic sm') + '</span>' +
      '<input id="lgUser" autocomplete="username" placeholder="用户名"></div>' +
      '<div class="field"><span class="fi">' + icon('lock', 'ic sm') + '</span>' +
      '<input id="lgPass" type="password" autocomplete="current-password" placeholder="密码"></div>' +
      '</div>' +
      '<button class="btn" id="lgBtn">登 录</button>' +
      '<p class="hint">账号由管理员分配，登录后行程仅自己可见</p>' +
      '</div>';

    $('#lgBtn').addEventListener('click', doLogin);
    $('#lgPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  }

  async function doLogin() {
    var username = $('#lgUser').value.trim();
    var password = $('#lgPass').value;
    if (!username || !password) { toast('请输入用户名和密码'); return; }
    var btn = $('#lgBtn');
    btn.textContent = '登录中…';
    try {
      var data = await api('/api/auth/login', { method: 'POST', body: { username: username, password: password } });
      state.user = data.user;
      toast('登录成功');
      renderSchedules();
    } catch (e) {
      toast(e.message);
      btn.textContent = '登 录';
    }
  }

  // ------------------------------------------------------------------ 行程列表
  async function renderSchedules() {
    app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    var data;
    try { data = await api('/api/schedules'); }
    catch (e) { state.user = null; return renderLogin(); }

    var list = data.schedules || [];
    var last = data.last_schedule;
    var isAdmin = state.user && state.user.is_admin;

    var cards = list.length ? list.map(function (s) {
      var isLast = s.name === last;
      return '<div class="card sched" data-name="' + esc(s.name) + '">' +
        (isLast ? '<span class="stripe"></span>' : '') +
        '<div class="inner">' +
        '<div class="r1">' +
        '<span class="fic">' + icon('folder', 'ic') + '</span>' +
        '<span class="nm">' + esc(s.name) + '</span>' +
        '</div>' +
        '<div class="ops">' +
        '<button class="iconbtn" data-act="share" data-name="' + esc(s.name) + '" title="导出与分享">' + icon('share', 'ic sm') + '</button>' +
        '<button class="iconbtn" data-act="copy" data-name="' + esc(s.name) + '" title="复制行程">' + icon('copy', 'ic sm') + '</button>' +
        '<button class="iconbtn" data-act="del" data-name="' + esc(s.name) + '" title="删除行程">' + icon('trash', 'ic sm') + '</button>' +
        '</div></div>' +
        '<div class="meta"><span class="days">' + s.day_count + ' 天 · ' + s.item_count + ' 项日程</span>' +
        (s.created_at ? '<span class="ctime">' + esc(fmtTime(s.created_at)) + ' 创建</span>' : '') +
        '</div></div>';
    }).join('') : emptyHtml('还没有行程，输入名称后点 + 新建', 'folder');

    app.innerHTML =
      '<div class="hero">' +
      '<div class="topbar">' +
      '<span class="spacer"></span>' +
      '<div class="acts">' +
      '<button class="iconbtn" id="btnLocs" title="管理现场教学点" aria-label="管理现场教学点">' + icon('pin', 'ic') + '</button>' +
      (isAdmin ? '<button class="iconbtn" id="btnUsers" title="账号管理">' + icon('users', 'ic') + '</button>' : '') +
      '<button class="iconbtn" id="btnLogout" title="退出登录">' + icon('logout', 'ic') + '</button>' +
      '</div></div>' +
      '<div class="head"><div style="flex:1;min-width:0">' +
      '<div class="title"><span class="tname">行程管理</span></div>' +
      '<div class="sub"><span class="pillsub">共 ' + list.length + ' 个行程</span></div>' +
      '</div></div>' +
      '</div>' +
      '<div class="searchbar-wrap"><div class="searchbar">' +
      '<input id="newName" placeholder="输入新行程名称，如：南京上海">' +
      '<button class="plus" id="btnNew" title="新建行程">' + icon('plus', 'ic sm') + '</button>' +
      '</div></div>' +
      '<div class="body">' + cards + '</div>';

    $('#btnNew').addEventListener('click', createSchedule);
    $('#newName').addEventListener('keydown', function (e) { if (e.key === 'Enter') createSchedule(); });
    $('#btnLogout').addEventListener('click', doLogout);
    $('#btnLocs').addEventListener('click', function () { openLocations('list'); });
    if ($('#btnUsers')) $('#btnUsers').addEventListener('click', renderUsers);

    $$('#app .sched').forEach(function (card) {
      card.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-act]');
        if (btn) {
          if (btn.dataset.act === 'share') return openShare(btn.dataset.name);
          if (btn.dataset.act === 'copy') return copySchedule(btn.dataset.name);
          if (btn.dataset.act === 'del') return deleteSchedule(btn.dataset.name);
        }
        openSchedule(card.dataset.name);
      });
    });
  }

  async function createSchedule() {
    var name = $('#newName').value.trim();
    if (!name) { toast('请输入行程名称'); return; }
    try {
      var data = await api('/api/schedules', { method: 'POST', body: { name: name } });
      toast('已创建「' + data.name + '」');
      openSchedule(data.name);
    } catch (e) { toast(e.message); }
  }

  async function copySchedule(name) {
    try {
      var data = await api('/api/schedules/' + enc(name) + '/copy', { method: 'POST', body: {} });
      toast('已复制为「' + data.name + '」');
      renderSchedules();
    } catch (e) { toast(e.message); }
  }

  function deleteSchedule(name) {
    confirmDialog('确定删除行程「' + esc(name) + '」？<br>此操作不可撤销。', function () { doDeleteSchedule(name); });
  }

  async function doDeleteSchedule(name) {
    try {
      await api('/api/schedules/' + enc(name), { method: 'DELETE' });
      toast('已删除');
      if (state.scheduleName === name) state.scheduleName = null;
      renderSchedules();
    } catch (e) { toast(e.message); }
  }

  // 应用内确认弹窗：替代原生 confirm，样式统一且移动端一定可见
  function confirmDialog(message, onOk, okText) {
    var wrap = document.createElement('div');
    wrap.className = 'overlay center';
    wrap.innerHTML =
      '<div class="confirm">' +
      '<div class="msg">' + message + '</div>' +
      '<div class="cbtn">' +
      '<button class="no">取消</button>' +
      '<button class="yes">' + (okText || '删除') + '</button>' +
      '</div></div>';
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) { wrap.remove(); return; }
      var b = e.target.closest('button');
      if (!b) return;
      wrap.remove();
      if (b.classList.contains('yes')) onOk();
    });
    document.body.appendChild(wrap);
  }

  // 应用内输入弹窗（用于重命名等需要文本输入的场景）
  function promptDialog(title, value, onOk) {
    var wrap = document.createElement('div');
    wrap.className = 'overlay center';
    wrap.innerHTML =
      '<div class="confirm ask">' +
      '<div class="msg">' + title + '</div>' +
      '<input class="dinput" value="' + esc(value) + '" maxlength="30">' +
      '<div class="cbtn">' +
      '<button class="no">取消</button>' +
      '<button class="yes">确定</button>' +
      '</div></div>';
    var input = wrap.querySelector('.dinput');
    function submit() {
      var v = input.value.trim();
      wrap.remove();
      if (v) onOk(v);
    }
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) { wrap.remove(); return; }
      var b = e.target.closest('button');
      if (!b) return;
      if (b.classList.contains('yes')) { submit(); return; }
      wrap.remove();
    });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    document.body.appendChild(wrap);
    setTimeout(function () { input.focus(); input.select(); }, 30);
  }

  function renameSchedule() {
    var old = state.scheduleName;
    promptDialog('修改行程名称', old, function (v) {
      if (v === old) return;
      doRenameSchedule(old, v);
    });
  }

  async function doRenameSchedule(oldName, newName) {
    try {
      var data = await api('/api/schedules/' + enc(oldName) + '/rename',
        { method: 'POST', body: { new_name: newName } });
      state.scheduleName = data.name;
      state.schedule.name = data.name;
      renderTimeline();
      toast('已重命名');
    } catch (e) { toast(e.message); }
  }

  // 每日起始时间：每天第一项日程从这个时刻开始，依次累加
  function openStartTimePicker() {
    var cur = state.schedule.start_time || '07:00';
    var wrap = document.createElement('div');
    wrap.className = 'overlay center';
    wrap.innerHTML =
      '<div class="confirm ask">' +
      '<div class="msg">每日起始时间<br>' +
      '<span style="font-size:12.5px;color:var(--sub);font-weight:400">每天的第一项日程从这个时刻开始，按顺序累加</span></div>' +
      '<input class="dinput" type="time" value="' + esc(cur) + '">' +
      '<div class="fhint">当前：' + esc(cur) + ' 开始</div>' +
      '<div class="cbtn">' +
      '<button class="no">取消</button>' +
      '<button class="yes">确定</button>' +
      '</div></div>';
    var input = wrap.querySelector('.dinput');
    function submit() {
      var v = input.value;
      wrap.remove();
      if (v && v !== cur) saveStartTime(v);
    }
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) { wrap.remove(); return; }
      var b = e.target.closest('button');
      if (!b) return;
      if (b.classList.contains('yes')) { submit(); return; }
      wrap.remove();
    });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    document.body.appendChild(wrap);
  }

  async function saveStartTime(value) {
    try {
      var res = await api('/api/schedules/' + enc(state.scheduleName) + '/start-time',
        { method: 'PATCH', body: { start_time: value } });
      state.schedule.start_time = res.start_time;
      state.schedule.days = res.days;
      state.schedule.items = res.items;
      renderTimeline();
      toast('已改为每天 ' + res.start_time + ' 开始');
    } catch (e) { toast(e.message); }
  }

  async function doLogout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    state.user = null;
    state.regionsTree = null;
    renderLogin();
  }

  // ------------------------------------------------------------------ 主行程
  async function openSchedule(name) {
    app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    try {
      state.scheduleName = name;
      state.schedule = await api('/api/schedules/' + enc(name));
      // 进入行程时定位到第一个有日程的一天，避免新增的内容在别的 DAY 上“看不见”
      var idx = 0;
      var days = state.schedule.days || [];
      for (var i = 0; i < days.length; i++) {
        if ((days[i].rows || []).length) { idx = i; break; }
      }
      state.activeDay = idx;
      state.sheet = null;
      renderTimeline();
    } catch (e) {
      toast(e.message);
      renderSchedules();
    }
  }

  // 从行程管理列表直接进入某个行程的「导出与分享」页
  async function openShare(name) {
    app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    try {
      state.scheduleName = name;
      state.schedule = await api('/api/schedules/' + enc(name));
      state.activeDay = 0;
      state.sheet = null;
      state.exportFromList = true;
      renderExport();
    } catch (e) {
      toast(e.message);
      renderSchedules();
    }
  }

  function currentRows() {
    if (!state.schedule || !state.schedule.days.length) return [];
    var d = state.schedule.days[state.activeDay] || state.schedule.days[0];
    return d.rows || [];
  }

  function renderTimeline(keepOverlay) {
    // 添加日程后仅重绘时间线、保留已打开的抽屉节点，避免重建造成闪烁与点击丢失
    var overlay = keepOverlay ? $('#app .overlay') : null;
    var s = state.schedule;
    var days = s.days || [];
    var tabs = days.length ? days.map(function (d, i) {
      var on = i === state.activeDay;
      return '<button class="tab' + (on ? ' on' : '') + '" data-day="' + i + '">' +
        esc(d.label || ('DAY' + (i + 1))) +
        (on ? '<span class="tabx" data-delday="' + i + '" title="删除这一天" aria-label="删除这一天">' + icon('close', 'ic') + '</span>' : '') +
        '</button>';
    }).join('') : '<button class="tab on">DAY1</button>';

    var rows = currentRows();
    var itemCount = days.reduce(function (n, dd) { return n + ((dd.rows || []).length); }, 0);
    var tl = rows.length ? rows.map(rowHtml).join('') : emptyHtml('这一天还没有日程，点右下角 + 添加', null);

    app.innerHTML =
      '<div class="hero">' +
      '<div class="topbar">' +
      '<button class="iconbtn" id="btnBack">' + icon('back', 'ic') + '</button>' +
      '<span class="spacer"></span>' +
      '<div class="acts">' +
      '<button class="iconbtn" id="btnExport" title="导出与分享">' + icon('share', 'ic') + '</button>' +
      '<button class="iconbtn" id="btnDelSched" title="删除行程">' + icon('trash', 'ic') + '</button>' +
      '</div></div>' +
      '<div class="head"><div style="flex:1;min-width:0">' +
      '<div class="title"><span class="tname">' + esc(s.name) + '</span>' +
      '<button class="rename" id="btnRename" title="修改行程名称">' + icon('edit', 'ic sm') + '</button></div>' +
      '<div class="sub"><span class="pillsub">' + (s.day_count || days.length || 1) + ' 天 · ' + itemCount + ' 项日程</span>' +
      '<button class="pillsub btnpill" id="btnStartTime" title="设置每日起始时间">' + icon('clock', 'ic sm') + esc(s.start_time || '07:00') + ' 开始</button></div>' +
      '</div></div></div>' +
      // DAY 页签单行横向滑动；「+」是最后一个页签，跟随一起滑动，不会与 DAY 重叠
      '<div class="tabs">' + tabs +
      '<button class="dayadd" id="btnAddDay" title="插入新一天" aria-label="插入新一天">' + icon('plus', 'ic sm') + '</button>' +
      '</div>' +
      '<div class="body"><div class="tl">' + tl + '</div></div>' +
      '<button class="fab" id="btnFab">' + icon('plus', 'ic') + '</button>';

    $('#btnBack').addEventListener('click', renderSchedules);
    $('#btnExport').addEventListener('click', function () { state.exportFromList = false; renderExport(); });
    $('#btnDelSched').addEventListener('click', function () { deleteSchedule(s.name); });
    $('#btnRename').addEventListener('click', renameSchedule);
    $('#btnStartTime').addEventListener('click', openStartTimePicker);
    $('#btnAddDay').addEventListener('click', addDay);
    $('#btnFab').addEventListener('click', function () { openSheet('common'); });

    $$('#app .tab').forEach(function (t) {
      t.addEventListener('click', function () {
        state.activeDay = parseInt(t.dataset.day, 10) || 0;
        renderTimeline();
      });
    });
    $$('#app .tabx').forEach(function (x) {
      x.addEventListener('click', function (e) {
        e.stopPropagation();                       // 不要触发 DAY 切换
        deleteDay(parseInt(x.dataset.delday, 10));
      });
    });

    // 重建后把选中的 DAY 滚入视野，并同步左右渐隐提示
    var tabsEl = $('#app .tabs');
    if (tabsEl) {
      var onTab = $('#app .tab.on');
      if (onTab && onTab.scrollIntoView) onTab.scrollIntoView({ block: 'nearest', inline: 'center' });
      syncTabsFade(tabsEl);
    }

    $$('#app .tl .row').forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (Date.now() - tlDragGuard < 400) return;   // 刚拖动排序完，忽略这次误点击
        var btn = e.target.closest('button[data-act]');
        if (!btn) return;
        var idx = parseInt(btn.dataset.index, 10);
        if (btn.dataset.act === 'edit') renderEdit(idx);
        if (btn.dataset.act === 'del') deleteItem(idx);
      });
    });
    initReorder($('#app .tl'));

    if (overlay) app.appendChild(overlay);
    else if (state.sheet) renderSheet();
  }

  function rowHtml(r) {
    var isOnsite = r.type === 'onsite_teaching';
    var name = r.name || '';
    var pin = isOnsite ? icon('pin', 'ic sm pin') : (name.indexOf('乘车前往') === 0 ? icon('bus', 'ic sm') : '');
    return '<div class="row" data-index="' + r.index + '"><div class="card">' +
      '<div class="line1">' +
      '<span class="time">' + esc(r.start || '') + '–' + esc(r.end || '') + '</span>' +
      '<span class="badge">' + (r.duration || 0) + ' 分钟</span>' +
      '<span class="ops">' +
      '<button class="iconbtn" data-act="edit" data-index="' + r.index + '">' + icon('edit', 'ic sm') + '</button>' +
      '<button class="iconbtn" data-act="del" data-index="' + r.index + '">' + icon('trash', 'ic sm') + '</button>' +
      '</span></div>' +
      '<div class="name">' + pin + '<span>' + esc(name) + '</span></div>' +
      (r.note ? '<div class="note">' + esc(r.note) + '</div>' : '') +
      '</div></div>';
  }

  async function addDay() {
    try {
      var res = await api('/api/schedules/' + enc(state.scheduleName) + '/days', { method: 'POST' });
      applyItems(res);
      state.activeDay = state.schedule.days.length - 1;
      renderTimeline();
      toast('已插入新的一天');
    } catch (e) { toast(e.message); }
  }

  function deleteDay(dayIndex) {
    var d = (state.schedule.days || [])[dayIndex];
    if (!d) return;
    var n = (d.rows || []).length;
    confirmDialog(
      '确定删除「' + esc(d.label || ('DAY' + (dayIndex + 1))) + '」？<br>' +
      (n ? '该天的 ' + n + ' 项日程会一并删除。<br>' : '') + '此操作不可撤销。',
      function () { doDeleteDay(dayIndex); }
    );
  }

  async function doDeleteDay(dayIndex) {
    try {
      var res = await api('/api/schedules/' + enc(state.scheduleName) + '/days/' + dayIndex, { method: 'DELETE' });
      applyItems(res);
      renderTimeline();
      toast('已删除该天');
    } catch (e) { toast(e.message); }
  }

  function applyItems(res) {
    state.schedule.days = res.days;
    state.schedule.items = res.items;
    // 同步天数/日程数，否则新增一天后标题里的「N 天」不会立即更新
    state.schedule.day_count = res.days.length;
    var n = state.schedule.days.length;
    if (state.activeDay >= n) state.activeDay = n - 1;
  }

  // ------------------------------------------------------------- 排序（长按拖动）
  // 当前天内各行上下拖动排序：长按拾起 → 拖动 → 松手后按新顺序提交到后端。
  function initReorder(tlEl) {
    if (!tlEl) return;
    var rows = $$('.row', tlEl);
    if (rows.length < 2) return;

    var pending = null, drag = null, pressTimer = null, startX = 0, startY = 0;

    function cancelPending() {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      pending = null;
    }

    function onDown(e) {
      if (drag || pending) return;
      if (e.button != null && e.button !== 0) return;               // 仅左键 / 触摸
      if (!e.isPrimary) return;
      if (e.target.closest && e.target.closest('button')) return;   // 按钮不参与拖动
      startX = e.clientX; startY = e.clientY;
      pending = { row: e.currentTarget, id: e.pointerId };
      pressTimer = setTimeout(beginDrag, e.pointerType === 'mouse' ? 0 : 260);
    }

    function onMove(e) {
      if (drag) { moveDrag(e); return; }
      if (!pending || e.pointerId !== pending.id) return;
      // 长按未成型前先移动，判定为滚动，放弃拖动
      if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) cancelPending();
    }

    function onUp(e) {
      if (drag) { endDrag(e); return; }
      cancelPending();
    }

    function beginDrag() {
      pressTimer = null;
      if (!pending) return;
      var row = pending.row;
      var rect = row.getBoundingClientRect();
      var ph = document.createElement('div');
      ph.className = 'row-ph';
      ph.style.height = rect.height + 'px';
      row.parentNode.insertBefore(ph, row);
      row.classList.add('dragging');
      row.style.width = rect.width + 'px';
      row.style.height = rect.height + 'px';
      row.style.left = rect.left + 'px';
      row.style.top = rect.top + 'px';
      drag = { row: row, ph: ph, id: pending.id, startY: startY, rect: rect };
      pending = null;
      try { row.setPointerCapture(drag.id); } catch (err) {}
      if (navigator.vibrate) { try { navigator.vibrate(10); } catch (err) {} }
    }

    function moveDrag(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (e.cancelable) e.preventDefault();
      var dy = e.clientY - drag.startY;
      drag.row.style.transform = 'translateY(' + dy + 'px)';
      // 以被拖行的当前中心点决定插到哪一行之前/之后
      var cx = drag.rect.left + drag.rect.width / 2;
      var cy = drag.rect.top + dy + drag.rect.height / 2;
      var under = document.elementFromPoint(cx, cy);
      var target = under && under.closest ? under.closest('.row') : null;
      if (!target || target === drag.row) return;
      var r = target.getBoundingClientRect();
      var after = cy > r.top + r.height / 2;
      drag.ph.parentNode.insertBefore(drag.ph, after ? target.nextSibling : target);
    }

    function endDrag(e) {
      if (!drag) return;
      var row = drag.row, ph = drag.ph;
      row.style.transform = ''; row.style.left = ''; row.style.top = '';
      row.style.width = ''; row.style.height = '';
      row.classList.remove('dragging');
      try { row.releasePointerCapture(drag.id); } catch (err) {}
      ph.parentNode.insertBefore(row, ph);          // 把被拖行放回占位处
      ph.parentNode.removeChild(ph);
      drag = null;
      tlDragGuard = Date.now();                     // 屏蔽随后触发的误点击
      var order = collectOrder(tlEl);
      if (order) saveOrder(order);
    }

    rows.forEach(function (row) {
      row.addEventListener('pointerdown', onDown);
      row.addEventListener('pointermove', onMove);
      row.addEventListener('pointerup', onUp);
      row.addEventListener('pointercancel', onUp);
      row.addEventListener('touchmove', function (e) {
        if (drag && e.cancelable) e.preventDefault();   // 拖动中禁止页面滚动
      }, { passive: false });
      row.addEventListener('contextmenu', function (e) { if (drag) e.preventDefault(); });
    });
  }

  // 读取当前天在 DOM 中的新顺序，回填为整份 items 的全排列
  function collectOrder(tlEl) {
    var n = ((state.schedule && state.schedule.items) || []).length;
    if (!n) return null;
    var newIdx = $$('.row', tlEl).map(function (el) { return parseInt(el.dataset.index, 10); });
    var slots = newIdx.slice().sort(function (a, b) { return a - b; });   // 原本占用的下标位置
    var order = [];
    for (var i = 0; i < n; i++) order.push(i);
    for (var k = 0; k < slots.length; k++) order[slots[k]] = newIdx[k];
    for (var j = 0; j < n; j++) { if (order[j] !== j) return order; }     // 未变化则不必提交
    return null;
  }

  async function saveOrder(order) {
    try {
      var res = await api('/api/schedules/' + enc(state.scheduleName) + '/order',
        { method: 'PUT', body: { order: order } });
      applyItems(res);
      renderTimeline();
      toast('顺序已更新');
    } catch (e) {
      renderTimeline();
      toast(e.message || '排序失败');
    }
  }

  async function deleteItem(index) {
    var row = null;
    (state.schedule.days || []).forEach(function (d) {
      (d.rows || []).forEach(function (r) { if (r.index === index) row = r; });
    });
    if (row && !window.confirm('删除「' + row.name + '」？')) return;
    try {
      var res = await api('/api/schedules/' + enc(state.scheduleName) + '/items/' + index, { method: 'DELETE' });
      applyItems(res);
      renderTimeline();
      toast('已删除');
    } catch (e) { toast(e.message); }
  }

  // ------------------------------------------------------------------ 编辑任务
  function renderEdit(index) {
    state.sheet = null;
    var item = state.schedule.items[index];
    if (!item) return;
    state.editIndex = index;
    var rowInfo = null;
    (state.schedule.days || []).forEach(function (d) {
      (d.rows || []).forEach(function (r) { if (r.index === index) rowInfo = r; });
    });
    app.innerHTML =
      '<div class="topbar"><button class="iconbtn" id="btnBack">' + icon('back', 'ic') + '</button>' +
      '<h1>编辑任务</h1></div>' +
      '<div class="body">' +
      // 1. 任务名称
      '<div class="card"><div class="frow" style="padding-top:0">' +
      '<div class="flabel">任务名称</div>' +
      '<input class="finput" id="edName" value="' + esc(item.name || '') + '" placeholder="任务名称">' +
      '</div></div>' +
      // 2. 时长：左侧为推算的开始/结束时间，右侧为可调的时长控件（左右布局，更省高度）
      '<div class="card"><div class="frow" style="padding-top:0">' +
      '<div class="dur-row">' +
      '<div class="dur-info">' +
      '<div class="flabel" style="margin-bottom:6px">时长（分钟）</div>' +
      '<div class="dur-time"><span id="edStart">' + esc(rowInfo && rowInfo.start || '--:--') + '</span>' +
      '<span class="dur-dash">–</span><span id="edEnd">' + esc(rowInfo && rowInfo.end || '--:--') + '</span></div>' +
      '</div>' +
      '<div class="stepper">' +
      '<button class="sbtn" id="durMinus" aria-label="减少">−</button>' +
      '<input class="finput durin" id="durVal" type="number" inputmode="numeric" min="10" max="1440" value="' + (item.duration || 60) + '">' +
      '<button class="sbtn" id="durPlus" aria-label="增加">+</button>' +
      '</div>' +
      '</div>' +
      '</div></div>' +
      // 3. 备注
      '<div class="card"><div class="frow" style="padding-top:0">' +
      '<div class="flabel">备注 / 地点</div>' +
      '<textarea class="finput" id="edNote" rows="3" placeholder="选填">' + esc(item.note || '') + '</textarea>' +
      '</div></div>' +
      '<div class="notebar">' + icon('clock', 'ic sm') + '改动会自动保存，并按顺序重算当天时间</div>' +
      '</div>';

    var saveTimer = null;

    // 读取时长输入并限制在 10–1440 分钟
    function readDur() {
      var v = parseInt($('#durVal').value, 10);
      if (isNaN(v)) v = item.duration || 60;
      return Math.min(1440, Math.max(10, v));
    }

    async function doSave() {
      saveTimer = null;
      try {
        var res = await api('/api/schedules/' + enc(state.scheduleName) + '/items/' + index,
          { method: 'PATCH', body: { name: $('#edName').value.trim() || '未命名', note: $('#edNote').value, duration: readDur() } });
        state.schedule.days = res.days;
        state.schedule.items = res.items;
        state.schedule.day_count = res.days.length;
        var info = null;
        (res.days || []).forEach(function (d) {
          (d.rows || []).forEach(function (r) { if (r.index === index) info = r; });
        });
        var sEl = $('#edStart'), eEl = $('#edEnd');
        if (sEl) sEl.textContent = (info && info.start) || '--:--';
        if (eEl) eEl.textContent = (info && info.end) || '--:--';
      } catch (e) { toast(e.message); }
    }

    function queueSave(delay) {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(doSave, delay == null ? 700 : delay);
    }

    function stepDur(delta) {
      var el = $('#durVal');
      el.value = Math.min(1440, Math.max(10, readDur() + delta));
      queueSave(0);
    }

    $('#edName').addEventListener('input', function () { queueSave(); });
    $('#edNote').addEventListener('input', function () { queueSave(); });
    $('#durVal').addEventListener('input', function () { queueSave(); });
    $('#durVal').addEventListener('change', function () { $('#durVal').value = readDur(); queueSave(0); });
    $('#durVal').addEventListener('blur', function () { $('#durVal').value = readDur(); });
    $('#durMinus').addEventListener('click', function () { stepDur(-10); });
    $('#durPlus').addEventListener('click', function () { stepDur(10); });

    $('#btnBack').addEventListener('click', async function () {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; await doSave(); }
      renderTimeline();
    });
  }

  // ------------------------------------------------------------------ 添加任务抽屉
  async function openSheet(tab) {
    state.sheet = { tab: tab || 'common' };
    if (state.sheet.tab === 'onsite') {
      await ensureRegions();
      await loadSheetLocations();
    }
    renderSheet();
  }

  async function loadSheetLocations() {
    var data = await api('/api/locations' + locationQuery('sheet'));
    state.sheetLocations = data.locations || [];
  }

  function renderSheet() {
    var old = $('#app .overlay');
    if (old) old.remove();
    var tab = state.sheet.tab;
    var common = [
      { name: '开班仪式', duration: 30 }, { name: '乘车前往', duration: 30 }, { name: '早餐', duration: 30 },
      { name: '结班仪式', duration: 30 }, { name: '入住酒店', duration: 20 }, { name: '午餐', duration: 30 },
      { name: '专题授课', duration: 90 }, { name: '休息', duration: 60 }, { name: '晚餐', duration: 30 }
    ];
    var bodyHtml;
    if (tab === 'common') {
      bodyHtml = '<div class="grid">' + common.map(function (p, i) {
        return '<button class="gitem" data-preset="' + i + '">' + icon(presetIcon(p.name), 'ic') +
          '<span>' + esc(p.name) + '</span></button>';
      }).join('') + '</div>';
    } else {
      bodyHtml = regionPickerHtml('sheet') +
        '<div style="overflow-y:auto">' + (state.sheetLocations.length ? state.sheetLocations.map(function (loc) {
          return '<div class="lrow"><span class="lic">' + icon('pin', 'ic sm') + '</span>' +
            '<div style="flex:1;min-width:0"><div class="nm">' + esc(loc.name) + '</div>' +
            '<div class="sub">建议 ' + (loc.duration || 60) + ' 分钟</div></div>' +
            '<button class="add" data-loc="' + loc.id + '">添加</button></div>';
        }).join('') : emptyHtml('该地区暂无教学点', 'pin')) + '</div>';
    }

    var overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML =
      '<div class="sheet">' +
      '<div class="handle"></div>' +
      '<div class="sh-head"><h2>添加任务</h2>' +
      '<button class="x" id="sheetClose">' + icon('close', 'ic') + '</button></div>' +
      '<div class="seg">' +
      '<button data-tab="common" class="' + (tab === 'common' ? 'on' : '') + '">常用类型</button>' +
      '<button data-tab="onsite" class="' + (tab === 'onsite' ? 'on' : '') + '">现场教学</button>' +
      '</div>' + bodyHtml + '</div>';
    app.appendChild(overlay);

    $('#sheetClose').addEventListener('click', function () { state.sheet = null; overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) { state.sheet = null; overlay.remove(); } });
    $$('#app .seg button').forEach(function (b) {
      b.addEventListener('click', function () { openSheet(b.dataset.tab); });
    });
    if (tab === 'common') {
      $$('#app .gitem').forEach(function (b) {
        b.addEventListener('click', function () { addPreset(common[parseInt(b.dataset.preset, 10)]); });
      });
    } else {
      $$('#app .lrow .add').forEach(function (b) {
        b.addEventListener('click', function () { addOnsite(parseInt(b.dataset.loc, 10)); });
      });
    }
  }

  function presetIcon(name) {
    if (name.indexOf('乘车') === 0) return 'bus';
    if (name.indexOf('餐') >= 0) return 'tea';
    return 'doc';
  }

  async function addPreset(p) {
    var isMeal = ['早餐', '午餐', '晚餐'].indexOf(p.name) >= 0;
    var body = isMeal
      ? { type: 'meal', name: p.name, duration: 60, meal_type: p.name === '早餐' ? 'breakfast' : (p.name === '晚餐' ? 'dinner' : 'lunch') }
      : { type: 'task', name: p.name, duration: p.duration };
    await postItem(body);
  }

  async function addOnsite(locId) {
    var loc = state.sheetLocations.find(function (l) { return l.id === locId; });
    if (!loc) return;
    await postItem({
      type: 'onsite_teaching',
      name: '现场教学：' + loc.name,
      duration: loc.duration || 60,
      note: loc.description || '',
      location_id: loc.id,
      location_data: loc
    });
  }

  // 新日程项插入到「当前正在看的这一天」末尾；找不到时返回 null（后端追加到末尾）
  function currentDayInsertIndex() {
    var days = state.schedule.days || [];
    var d = days[state.activeDay];
    if (!d) return null;
    var rows = d.rows || [];
    if (rows.length) return rows[rows.length - 1].index + 1;
    // 这一天还没有日程 → 插到这一天分隔项之后
    var items = state.schedule.items || [];
    var n = -1;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type === 'day_marker') {
        n++;
        if (n === state.activeDay) return i + 1;
      }
    }
    return null;
  }

  async function postItem(body) {
    try {
      var idx = currentDayInsertIndex();
      var url = '/api/schedules/' + enc(state.scheduleName) + '/items' + (idx === null ? '' : '?index=' + idx);
      var res = await api(url, { method: 'POST', body: body });
      applyItems(res);
      renderTimeline(true);
      toast('已添加到日程');
    } catch (e) { toast(e.message); }
  }

  // ------------------------------------------------------------------ 导出与分享
  function renderExport() {
    state.sheet = null;
    var s = state.schedule;
    // 预览卡只保留行程名称与「X天 · Y项日程」概览，保持整页一屏可览
    var preview =
      '<div class="preview"><div class="pn">' + esc(s.name) + '</div>' +
      '<div class="pd">' + (s.day_count || 0) + '天 · ' + (s.item_count || 0) + '项日程</div></div>';

    var share = s.share;
    // 分享链接前缀（全局配置，留空则自动使用当前访问地址）
    var baseFrow =
      '<div class="frow"><div class="flabel">访问地址（分享链接前缀）</div>' +
      '<input class="tin" id="shareBase" type="url" inputmode="url" autocomplete="off" placeholder="留空使用当前访问地址">' +
      '<div class="fhint">公网：https://你的域名，局域网：http://192.168.x.x:3066；留空使用当前浏览器地址。</div></div>';
    var shareHtml = share ?
      '<div class="card">' +
      '<div class="frow" style="padding-top:0"><div class="flabel">分享链接（无需登录即可查看）</div>' +
      '<div class="linkbox"><span class="u">' + esc(share.url) + '</span>' +
      '<button class="copy" id="btnCopyLink">复制</button></div>' +
      '<div class="fhint">拿到链接的人只能查看，不能修改；可随时取消分享。</div></div>' +
      '<div class="frow" style="display:flex;align-items:center;gap:12px">' +
      '<div style="flex:1"><div class="fval" style="font-size:15px">允许查看者复制到自己的行程</div>' +
      '<div class="fhint">对方需先登录，复制后即为独立副本</div></div>' +
      '<button class="sw' + (share.allow_copy ? ' on' : '') + '" id="swCopy"></button></div>' +
      '<button class="optrow" id="btnUnshare">' + icon('trash', 'ic sm') + '取消分享</button>' +
      '</div>'
      : '<div class="card"><div class="frow" style="padding-top:0">' +
      '<div class="fhint">分享后生成一个免登录只读链接</div></div>' +
      baseFrow + '</div>' +
      '<div style="margin-top:10px"><button class="btn" id="btnShare">生成分享链接</button></div>';

    app.innerHTML =
      '<div class="topbar"><button class="iconbtn" id="btnBack">' + icon('back', 'ic') + '</button>' +
      '<h1>导出与分享</h1></div>' +
      '<div class="body export-page">' +
      preview +

      '<div class="sect sect-row"><span>导出</span><span class="sect-note">灰色部分暂未开放</span></div>' +
      '<div class="tiles">' +
      '<button class="tile on" id="tileTxt">' + icon('doc', 'ic') + '<span>TXT 文本</span></button>' +
      '<button class="tile" disabled>' + icon('image', 'ic') + '<span>长图</span></button>' +
      '<button class="tile" disabled>' + icon('pdf', 'ic') + '<span>排版 PDF</span></button>' +
      '</div>' +

      '<div class="sect">分享给他人查看</div>' + shareHtml +

      '<div class="sect">更多操作</div>' +
      '<div class="card">' +
      '<button class="optrow" id="btnCopySched">' + icon('copy', 'ic sm') + '复制到新行程' + icon('chev', 'ic chev') + '</button>' +
      '<button class="optrow" id="btnManageLoc">' + icon('pin', 'ic sm') + '管理现场教学地点' + icon('chev', 'ic chev') + '</button>' +
      '</div>' +
      '</div>';

    $('#btnBack').addEventListener('click', function () {
      if (state.exportFromList) { state.exportFromList = false; renderSchedules(); } else { renderTimeline(); }
    });
    $('#tileTxt').addEventListener('click', downloadTxt);
    $('#btnCopySched').addEventListener('click', function () { copySchedule(s.name); });
    $('#btnManageLoc').addEventListener('click', function () { openLocations(); });
    if (share) {
      $('#btnCopyLink').addEventListener('click', function () { copyText(share.url); });
      $('#swCopy').addEventListener('click', toggleAllowCopy);
      $('#btnUnshare').addEventListener('click', unshare);
    } else {
      $('#btnShare').addEventListener('click', createShare);
    }
    // 访问地址只在未生成分享链接时出现（生成后不再展示该配置项）
    var shareBaseEl = $('#shareBase');
    if (shareBaseEl) {
      shareBaseEl.addEventListener('change', saveShareBase);
      loadShareBase();
    }
  }

  // 分享链接前缀：读取已配置值，输入框留空时用生效地址作占位提示
  async function loadShareBase() {
    try {
      var data = await api('/api/settings/share-base-url');
      state.shareBase = data.base_url || '';
      state.shareBaseEffective = data.effective || '';
      var el = $('#shareBase');
      if (el) {
        el.value = state.shareBase;
        if (state.shareBaseEffective) el.placeholder = state.shareBaseEffective;
      }
    } catch (e) { /* 读取失败时保持默认占位 */ }
  }

  async function saveShareBase() {
    var el = $('#shareBase');
    if (!el) return;
    var v = (el.value || '').trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\//i.test(v)) {
      toast('请填写以 http:// 或 https:// 开头的地址');
      el.value = state.shareBase || '';
      return;
    }
    try {
      var data = await api('/api/settings/share-base-url', { method: 'PUT', body: { base_url: v } });
      state.shareBase = data.base_url || '';
      state.shareBaseEffective = data.effective || '';
      el.value = state.shareBase;
      if (state.shareBaseEffective) el.placeholder = state.shareBaseEffective;
      var u = document.querySelector('.linkbox .u');
      if (u && state.schedule && state.schedule.share) {
        state.schedule.share.url = state.shareBaseEffective + '/s/' + state.schedule.share.token;
        u.textContent = state.schedule.share.url;
      }
      toast(v ? '访问地址已保存' : '已恢复为当前访问地址');
    } catch (e) { toast(e.message); }
  }

  function downloadTxt() {
    var a = document.createElement('a');
    a.href = '/api/schedules/' + enc(state.scheduleName) + '/export';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制'); }, function () { fallbackCopy(text); });
    } else { fallbackCopy(text); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('复制失败，请手动复制'); }
    ta.remove();
  }

  async function createShare() {
    try {
      var data = await api('/api/schedules/' + enc(state.scheduleName) + '/share', { method: 'POST' });
      state.schedule.share = data.share;
      toast('已生成分享链接');
      renderExport();
    } catch (e) { toast(e.message); }
  }

  async function unshare() {
    if (!window.confirm('取消分享后，原链接将立即失效。确定继续？')) return;
    try {
      await api('/api/schedules/' + enc(state.scheduleName) + '/share', { method: 'DELETE' });
      state.schedule.share = null;
      toast('已取消分享');
      renderExport();
    } catch (e) { toast(e.message); }
  }

  async function toggleAllowCopy() {
    var next = !state.schedule.share.allow_copy;
    try {
      var data = await api('/api/schedules/' + enc(state.scheduleName) + '/share',
        { method: 'PATCH', body: { allow_copy: next } });
      state.schedule.share = data.share;
      renderExport();
    } catch (e) { toast(e.message); }
  }

  // ------------------------------------------------------------------ 现场教学地点（管理 + 添加）
  async function openLocations(from) {
    state.locsFrom = from || null;
    state.sheet = null;
    await ensureRegions();
    app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    await loadViewLocations();
    renderLocations();
  }

  async function loadViewLocations() {
    var data = await api('/api/locations' + locationQuery('view'));
    state.viewLocations = data.locations || [];
  }

  function renderLocations() {
    var fromList = state.locsFrom === 'list';
    var rows = state.viewLocations.length ? state.viewLocations.map(function (loc) {
      return '<div class="lrow"><span class="lic">' + icon('pin', 'ic sm') + '</span>' +
        '<div style="flex:1;min-width:0"><div class="nm">' + esc(loc.name) + '</div>' +
        '<div class="sub">建议 ' + (loc.duration || 60) + ' 分钟' + (loc.address ? ' · ' + esc(loc.address) : '') + '</div></div>' +
        (fromList ? '' : '<button class="add" data-loc="' + loc.id + '">添加</button>') +
        '<button class="gear" data-edit="' + loc.id + '">' + icon('gear', 'ic sm') + '</button>' +
        '</div>';
    }).join('') : emptyHtml('该地区暂无教学点', 'pin');

    app.innerHTML =
      '<div class="hero">' +
      '<div class="topbar"><button class="iconbtn" id="btnBack">' + icon('back', 'ic') + '</button>' +
      '<span class="spacer"></span>' +
      '<button class="iconbtn" id="btnNewLoc" title="新建教学点">' + icon('plus', 'ic') + '</button></div>' +
      '<div class="head"><div style="flex:1;min-width:0">' +
      '<div class="title"><span class="tname">现场教学地点</span></div>' +
      '<div class="sub"><span class="pillsub">共 ' + state.viewLocations.length + ' 个教学点</span></div>' +
      '</div></div>' +
      '</div>' +
      '<div class="body gap">' + regionPickerHtml('view') + rows +
      '<button class="foot-tip" id="btnManual">找不到地点？<b>点此手动添加教学点</b></button>' +
      '</div>';

    $('#btnBack').addEventListener('click', function () {
      if (fromList) { state.locsFrom = null; renderSchedules(); } else { renderTimeline(); }
    });
    $('#btnNewLoc').addEventListener('click', function () { locationForm(null); });
    $('#btnManual').addEventListener('click', function () { locationForm(null); });
    $$('#app .lrow .add').forEach(function (b) {
      b.addEventListener('click', async function () {
        var loc = state.viewLocations.find(function (l) { return l.id === parseInt(b.dataset.loc, 10); });
        if (!loc) return;
        await postItem({
          type: 'onsite_teaching', name: '现场教学：' + loc.name, duration: loc.duration || 60,
          note: loc.description || '', location_id: loc.id, location_data: loc
        });
      });
    });
    $$('#app .lrow .gear').forEach(function (b) {
      b.addEventListener('click', function () {
        var loc = state.viewLocations.find(function (l) { return l.id === parseInt(b.dataset.edit, 10); });
        if (loc) locationForm(loc);
      });
    });
  }

  function locationForm(loc) {
    var isNew = !loc;
    loc = loc || { name: '', region_id: '', address: '', description: '', ticket: '', opening_hours: '', duration: 60, contact: '', note: '' };
    // 定位地区
    var pName = state.defaultRegion.province, cName = state.defaultRegion.city, dAid = '';
    if (loc.region_id) {
      (state.regionsTree || []).forEach(function (p) {
        (p.children || []).forEach(function (c) {
          (c.children || []).forEach(function (d) {
            if (d.aid === loc.region_id) { pName = p.name; cName = c.name; dAid = d.aid; }
          });
        });
      });
    }
    var f = { province: pName || '', city: cName || '', district: dAid };
    state.filters.form = f;

    var overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML =
      '<div class="sheet">' +
      '<div class="handle"></div>' +
      '<div class="sh-head"><h2>' + (isNew ? '新建教学点' : '编辑教学点') + '</h2>' +
      '<button class="x" id="lfClose">' + icon('close', 'ic') + '</button></div>' +
      '<div style="overflow-y:auto">' +
      '<div class="card">' +
      '<div class="frow" style="padding-top:0"><div class="flabel">地点名称 *</div>' +
      '<input class="finput" id="lfName" value="' + esc(loc.name) + '"></div>' +
      '<div class="frow"><div class="flabel">所在地区 *</div>' + regionPickerHtml('form') + '</div>' +
      '<div class="frow"><div class="flabel">建议时长（分钟）</div>' +
      '<input class="finput" id="lfDur" type="number" min="10" max="1440" value="' + (loc.duration || 60) + '"></div>' +
      '<div class="frow"><div class="flabel">详细地址</div><input class="finput" id="lfAddr" value="' + esc(loc.address) + '"></div>' +
      '<div class="frow"><div class="flabel">简介</div><input class="finput" id="lfDesc" value="' + esc(loc.description) + '"></div>' +
      '<div class="frow"><div class="flabel">门票信息</div><input class="finput" id="lfTicket" value="' + esc(loc.ticket) + '"></div>' +
      '<div class="frow"><div class="flabel">开放时间</div><input class="finput" id="lfOpen" value="' + esc(loc.opening_hours) + '"></div>' +
      '<div class="frow"><div class="flabel">联系电话</div><input class="finput" id="lfContact" value="' + esc(loc.contact) + '"></div>' +
      '<div class="frow"><div class="flabel">备注</div><input class="finput" id="lfNote" value="' + esc(loc.note) + '"></div>' +
      '</div>' +
      '<div class="btn-row" style="padding-left:0;padding-right:0">' +
      (isNew ? '' : '<button class="btn ghost" id="lfDel">删除</button>') +
      '<button class="btn" id="lfSave">保 存</button></div>' +
      '</div></div>';

    app.appendChild(overlay);
    $('#lfClose').addEventListener('click', function () { overlay.remove(); });
    $('#lfSave').addEventListener('click', function () { saveLocationForm(loc, overlay); });
    if ($('#lfDel')) $('#lfDel').addEventListener('click', function () { deleteLocationForm(loc, overlay); });
  }

  async function saveLocationForm(loc, overlay) {
    var f = getFilter('form');
    var body = {
      name: $('#lfName').value.trim(),
      region_id: f.district || '',
      duration: parseInt($('#lfDur').value, 10) || 60,
      address: $('#lfAddr').value.trim(),
      description: $('#lfDesc').value.trim(),
      ticket: $('#lfTicket').value.trim(),
      opening_hours: $('#lfOpen').value.trim(),
      contact: $('#lfContact').value.trim(),
      note: $('#lfNote').value.trim()
    };
    if (!body.name) { toast('请输入地点名称'); return; }
    if (!body.region_id) { toast('请选择完整的所在地区'); return; }
    try {
      if (loc.id) await api('/api/locations/' + loc.id, { method: 'PUT', body: body });
      else await api('/api/locations', { method: 'POST', body: body });
      toast('已保存');
      overlay.remove();
      await loadViewLocations();
      renderLocations();
    } catch (e) { toast(e.message); }
  }

  async function deleteLocationForm(loc, overlay) {
    if (!window.confirm('确定删除地点「' + loc.name + '」？此操作不可撤销。')) return;
    try {
      await api('/api/locations/' + loc.id, { method: 'DELETE' });
      toast('已删除');
      overlay.remove();
      await loadViewLocations();
      renderLocations();
    } catch (e) { toast(e.message); }
  }

  // ------------------------------------------------------------------ 账号管理（管理员）
  async function renderUsers() {
    var data;
    try { data = await api('/api/users'); } catch (e) { toast(e.message); return; }
    var users = data.users || [];

    var overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML =
      '<div class="sheet">' +
      '<div class="handle"></div>' +
      '<div class="sh-head"><h2>账号管理</h2>' +
      '<button class="x" id="uClose">' + icon('close', 'ic') + '</button></div>' +
      '<div style="overflow-y:auto">' +
      '<div class="card">' + users.map(function (u) {
        return '<div class="userrow"><span class="nm">' + esc(u.username) + '</span>' +
          (u.is_admin ? '<span class="badge-admin">管理员</span>' : '') +
          (u.id === state.user.id ? '<span class="badge-me">当前</span>'
            : '<button class="iconbtn" data-del="' + u.id + '">' + icon('trash', 'ic sm') + '</button>') +
          '</div>';
      }).join('') + '</div>' +
      '<div class="sect">新建账号</div>' +
      '<div class="card">' +
      '<div class="frow" style="padding-top:0"><div class="flabel">用户名</div>' +
      '<input class="finput" id="uName" placeholder="如：zhangsan"></div>' +
      '<div class="frow"><div class="flabel">密码</div>' +
      '<input class="finput" id="uPass" type="text" placeholder="至少 4 位"></div>' +
      '<div class="frow" style="display:flex;align-items:center;gap:12px"><div style="flex:1">' +
      '<div class="fval" style="font-size:15px">设为管理员</div></div>' +
      '<button class="sw" id="uAdmin"></button></div>' +
      '</div>' +
      '<div style="margin-top:12px"><button class="btn" id="uCreate">创建账号</button></div>' +
      '</div></div>';

    app.appendChild(overlay);
    var admin = false;
    $('#uClose').addEventListener('click', function () { overlay.remove(); });
    $('#uAdmin').addEventListener('click', function () {
      admin = !admin;
      $('#uAdmin').classList.toggle('on', admin);
    });
    $('#uCreate').addEventListener('click', async function () {
      var username = $('#uName').value.trim();
      var password = $('#uPass').value;
      if (!username || password.length < 4) { toast('请填写用户名，密码至少 4 位'); return; }
      try {
        await api('/api/users', { method: 'POST', body: { username: username, password: password, is_admin: admin } });
        toast('已创建账号');
        overlay.remove();
        renderUsers();
      } catch (e) { toast(e.message); }
    });
    $$('#app .userrow button[data-del]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!window.confirm('确定删除该账号？其所有行程将一并删除。')) return;
        try {
          await api('/api/users/' + b.dataset.del, { method: 'DELETE' });
          toast('已删除');
          overlay.remove();
          renderUsers();
        } catch (e) { toast(e.message); }
      });
    });
  }

  // ------------------------------------------------------------------ 分享公开页（免登录）
  async function renderShared(token) {
    app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    var data;
    try { data = await api('/api/share/' + enc(token)); }
    catch (e) {
      app.innerHTML = '<div class="topbar"><h1>行程查看</h1></div>' +
        '<div class="body">' + emptyHtml(esc(e.message), 'close') + '</div>';
      return;
    }
    var days = data.days || [];
    var active = 0;
    state.shared = data;
    state.sharedToken = token;

    function draw() {
      var d = days[active] || { rows: [] };
      var tabs = days.map(function (x, i) {
        return '<button class="tab' + (i === active ? ' on' : '') + '" data-day="' + i + '">' + esc(x.label || ('DAY' + (i + 1))) + '</button>';
      }).join('');
      var tl = (d.rows || []).length ? d.rows.map(function (r) {
        var pin = r.type === 'onsite_teaching' ? icon('pin', 'ic sm pin') : '';
        return '<div class="row"><div class="card">' +
          '<div class="line1"><span class="time">' + esc(r.start) + '–' + esc(r.end) + '</span>' +
          '<span class="badge">' + r.duration + ' 分钟</span></div>' +
          '<div class="name">' + pin + '<span>' + esc(r.name) + '</span></div>' +
          (r.note ? '<div class="note">' + esc(r.note) + '</div>' : '') +
          '</div></div>';
      }).join('') : emptyHtml('暂无日程', 'doc');

      app.innerHTML =
        '<div class="head" style="padding-top:calc(14px + env(safe-area-inset-top))">' +
        '<div style="flex:1"><div class="title">' + esc(data.name) + '</div>' +
        '<div class="sub">分享查看</div></div></div>' +
        '<div class="tabs">' + tabs + '</div>' +
        '<div class="body">' +
        '<div class="readonly-tip">' + icon('lock', 'ic sm') + '你正在查看分享的行程，内容为只读</div>' +
        '<div class="tl">' + tl + '</div></div>' +
        '<div class="dockbar">' +
        (state.user && data.allow_copy ? '<button class="btn outline" id="shCopy" style="margin-bottom:12px">复制到我的行程</button>' : '') +
        (state.user ? '' : '<button class="btn" id="shLogin">登录后复制到我的行程</button>') +
        '</div>';

      $$('#app .tab').forEach(function (t) {
        t.addEventListener('click', function () { active = parseInt(t.dataset.day, 10) || 0; draw(); });
      });
      var stabs = $('#app .tabs');
      if (stabs) syncTabsFade(stabs);
      if ($('#shLogin')) $('#shLogin').addEventListener('click', function () { location.href = '/'; });
      if ($('#shCopy')) $('#shCopy').addEventListener('click', async function () {
        try {
          var res = await api('/api/share/' + enc(token) + '/copy', { method: 'POST' });
          toast('已复制到「' + res.name + '」');
          location.href = '/';
        } catch (e) { toast(e.message); }
      });
    }
    draw();
  }

  // ------------------------------------------------------------------ 全局：地区选择 & 启动
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pick]');
    if (b) openRegionPicker(b.dataset.pick);
  });

  // DAY 页签行滚动时更新左右渐隐提示（scroll 不冒泡，用捕获阶段监听）
  app.addEventListener('scroll', function (e) {
    var el = e.target;
    if (el && el.classList && el.classList.contains('tabs')) syncTabsFade(el);
  }, true);

  // 表单内地区选好后只重绘地区选择行
  function locationFormRefresh() {
    var overlay = $('#app .overlay');
    if (!overlay) return;
    var old = overlay.querySelector('.pickrow[data-pick="form"]');
    if (!old) return;
    old.outerHTML = regionPickerHtml('form');
  }

  async function boot() {
    var m = location.pathname.match(/^\/s\/([^/]+)\/?$/);
    try {
      var me = await api('/api/auth/me');
      state.user = me.user;
    } catch (e) { state.user = null; }
    if (m) return renderShared(decodeURIComponent(m[1]));
    if (!state.user) return renderLogin();
    return renderSchedules();
  }

  boot();
})();