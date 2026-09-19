'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync, execSync } = require('child_process');
const config = require('./config');
const sources = require('./sources');
const registry = require('./registry');
const i18n = require('./i18n');
const versionLib = require('./version');
const platform = require('./platform');
const auth = require('./auth');
const tasks = require('./tasks');
const installer = require('./installer');
const net = require('./net');

let server = null;
let currentPort = null;
let currentHost = '127.0.0.1';

function dbg() {
  if (!process.env.EPM_DEBUG) return;
  const a = Array.from(arguments).map(x => typeof x === 'string' ? x : JSON.stringify(x));
  try { process.stderr.write('[epm-web] ' + a.join(' ') + '\n'); } catch (_) {}
}

/* ═══════ PID ═══════ */

function pidFile() {
  const dir = config.DATA_DIR || config.get('tempdir');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return path.join(dir, '.epm-web.pid');
}
function readPid() { try { return JSON.parse(fs.readFileSync(pidFile(), 'utf8')); } catch (_) { return null; } }
function writePid(info) {
  try { fs.mkdirSync(path.dirname(pidFile()), { recursive: true }); fs.writeFileSync(pidFile(), JSON.stringify(info), 'utf8'); } catch (_) {}
}
function clearPid() { try { fs.unlinkSync(pidFile()); } catch (_) {} }
function isAlive(pid) { if (!pid || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (_) { return false; } }

/* ═══════ HTTP ═══════ */

function json(res, code, data) {
  const b = JSON.stringify(data, null, 2);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(b), 'access-control-allow-origin': '*' });
  res.end(b);
}
function html(res, code, text) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}
function text(res, code, msg) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(msg);
}
function readBody(req) {
  return new Promise(resolve => {
    const c = [];
    req.on('data', x => c.push(x));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(c).toString('utf8') || '{}')); }
      catch (_) { resolve({}); }
    });
  });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ═══════ 页面 ═══════ */

function appHtml() {
  const ver = versionLib.getPkgVersion();
  const plat = platform.platform + '/' + platform.arch;
  const lang = i18n.current();

  const css = [
    ':root{--bg:#0b1220;--bg2:#111a2c;--card:#151f33;--line:#233149;--fg:#e6edf6;--muted:#8495ad;--acc:#38bdf8;--green:#34d399;--yellow:#fbbf24;--red:#f87171}',
    '*{box-sizing:border-box}',
    'body{margin:0;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--fg);font-size:14px;line-height:1.5}',
    'header{padding:14px 24px;background:linear-gradient(180deg,#1a2740,#0b1220);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:16px;flex-wrap:wrap}',
    'header h1{margin:0;font-size:16px;font-weight:600}',
    'header .meta{color:var(--muted);font-size:12px}',
    'header .right{margin-left:auto;display:flex;align-items:center;gap:10px;font-size:13px}',
    'header .who{color:var(--green)}',
    'header .no{color:var(--muted)}',
    'nav{background:var(--bg2);border-bottom:1px solid var(--line);padding:0 24px;display:flex;gap:4px;overflow-x:auto}',
    'nav a{padding:12px 16px;color:var(--muted);cursor:pointer;font-size:13px;border-bottom:2px solid transparent;white-space:nowrap}',
    'nav a:hover{color:var(--fg)}',
    'nav a.on{color:var(--acc);border-bottom-color:var(--acc)}',
    'main{max-width:1280px;margin:0 auto;padding:20px 24px}',
    'button{background:var(--line);color:var(--fg);border:0;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px;font-family:inherit}',
    'button:hover{background:#2d3f5e}',
    'button.primary{background:var(--acc);color:#0b1220;font-weight:600}',
    'button.primary:hover{background:#7dd3fc}',
    'button.danger{background:rgba(248,113,113,.15);color:var(--red)}',
    'button:disabled{opacity:.5;cursor:not-allowed}',
    'input,select{background:#0a1424;color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:8px 12px;font-size:14px;outline:none;width:100%}',
    'input:focus,select:focus{border-color:var(--acc)}',
    '.toolbar{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center}',
    '.toolbar input{flex:1;min-width:200px}',
    '.toolbar select{width:auto;min-width:120px}',
    '.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}',
    '.stat{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 16px}',
    '.stat .k{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px}',
    '.stat .v{font-size:22px;font-weight:600;color:var(--acc);margin-top:2px}',
    'table{width:100%;border-collapse:collapse;background:var(--card);border-radius:8px;overflow:hidden;border:1px solid var(--line)}',
    'th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line);font-size:13px;vertical-align:top}',
    'th{background:#0f1728;color:var(--muted);font-weight:500;font-size:11px;text-transform:uppercase}',
    'tr:last-child td{border-bottom:0}',
    'tr:hover td{background:rgba(56,189,248,.04)}',
    '.name{font-weight:600}',
    '.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}',
    '.badge.setup{background:rgba(251,191,36,.15);color:var(--yellow)}',
    '.badge.port{background:rgba(52,211,153,.15);color:var(--green)}',
    '.dim{color:var(--muted)}',
    '.mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--muted)}',
    '.empty{padding:60px 20px;text-align:center;color:var(--muted)}',
    '.loading{padding:40px;text-align:center;color:var(--muted)}',
    '.tag{display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;background:var(--line);color:var(--muted);margin-right:4px}',
    '.bar{display:inline-block;width:120px;height:12px;background:#0a1424;border-radius:3px;overflow:hidden;vertical-align:middle}',
    '.bar span{display:block;height:100%;background:var(--acc);transition:width .3s}',
    '.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:100}',
    '.modal{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px;max-width:520px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.5)}',
    '.modal h2{margin:0 0 16px;font-size:16px}',
    '.modal .row{margin-bottom:12px}',
    '.modal label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}',
    '.modal .actions{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}',
    '.modal .hint{font-size:12px;color:var(--muted);margin-top:8px;line-height:1.6}',
    '.modal a{color:var(--acc)}',
    '.toast{position:fixed;bottom:24px;right:24px;background:var(--card);border:1px solid var(--line);border-left:3px solid var(--acc);padding:12px 18px;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.4);max-width:400px;font-size:13px;z-index:200}',
    '.toast.err{border-left-color:var(--red)}',
    '.toast.ok{border-left-color:var(--green)}',
    'footer{padding:20px;text-align:center;color:var(--muted);font-size:12px;border-top:1px solid var(--line);margin-top:40px}',
    'a{color:var(--acc)}'
  ].join('\n');

  const js = [
    'var T = {',
    '  tabPackages:"包列表", tabInstalled:"已安装", tabSearch:"搜索", tabTasks:"任务", tabSettings:"设置", tabAbout:"关于",',
    '  refresh:"刷新", pull:"拉取列表", pulling:"拉取中...", pullOk:"拉取完成", pullFail:"拉取失败",',
    '  login:"登录", logout:"退出登录", loggedIn:"已登录", notLogged:"未登录",',
    '  colName:"名称", colType:"类型", colCompany:"公司", colVersion:"版本", colFile:"文件", colSize:"大小", colActions:"操作",',
    '  install:"安装", uninstall:"卸载", update:"更新", updateAll:"全部更新", details:"详情", latest:"最新",',
    '  noPkgs:"暂无数据，点击拉取列表从 GitHub 获取。", noInstalled:"未安装任何包。",',
    '  searchPh:"输入包名或公司名...", filterAll:"全部类型", filterSetup:"安装版", filterPort:"便携版", searchBtn:"搜索",',
    '  taskEmpty:"没有进行中的任务。", taskStop:"停止", taskStopAll:"全部停止", taskDownload:"下载", taskInstall:"安装",',
    '  loading:"加载中...",',
    '  confirmUninstall:"确认卸载 ", confirmUpdate:"确认更新 ",',
    '  setKey:"设置项", setValue:"值", setSave:"保存", setHint:"修改后点击保存立即生效。",',
    '  aboutVer:"版本", aboutPlat:"平台", aboutLang:"语言",',
    '  aboutWeb:"Web 控制台支持的功能", aboutCli:"CLI 独有功能",',
    '  webFeatures:["列出可用的包","列出已安装的包","搜索包","从 GitHub 拉取列表","按包名安装","更新已安装的包","查看版本","登录/退出 GitHub","卸载包","从 URL 添加包","查看/修改设置","查看/停止任务"],',
    '  cliFeatures:["发布应用 (release)","清空下载缓存 (temp clear)","终止所有进程 (exit)","启动/停止 Web 服务 (web)","指定端口/前台运行","启动交互式 CLI","从磁盘注册包 (redadd/redel)","列出本地包 (pak)","查看语言 (lang)"],',
    '  loginTitle:"登录 GitHub", loginToken:"Token", loginTokenPh:"ghp_xxxxxxxxxxxxxxxxxxxx",',
    '  loginHint:"在 GitHub 创建 Token 后粘贴到下方。", loginCancel:"取消", loginSubmit:"登录", loggingIn:"登录中...",',
    '  loginOk:"登录成功", loginFail:"登录失败", logoutOk:"已退出登录",',
    '  installOk:"安装已开始", uninstallOk:"卸载中", updateOk:"更新中", setSaved:"已保存",',
    '  unknown:"未知错误"',
    '};',
    '',
    'var state = { tab:"packages", pkgs:[], taskTimer:null };',
    '',
    'function esc(s){',
    '  return String(s==null?"":s).replace(/[&<>"\']/g,function(c){',
    '    return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];',
    '  });',
    '}',
    '',
    'function toast(msg, kind){',
    '  var el = document.getElementById("toast"); if(el) el.remove();',
    '  var d = document.createElement("div"); d.id="toast";',
    '  d.className = "toast" + (kind==="err"?" err":kind==="ok"?" ok":"");',
    '  d.textContent = msg; document.body.appendChild(d);',
    '  setTimeout(function(){ d.remove(); }, 3500);',
    '}',
    'function toastErr(e){ toast((e&&e.message)||String(e),"err"); }',
    'function toastOk(m){ toast(m,"ok"); }',
    '',
    'function api(method,url,body){',
    '  var opt = { method:method, headers:{} };',
    '  if(body){ opt.headers["content-type"]="application/json"; opt.body = JSON.stringify(body); }',
    '  return fetch(url,opt).then(function(r){',
    '    var ct = r.headers.get("content-type")||"";',
    '    if(ct.indexOf("json")!==-1) return r.json();',
    '    return r.text();',
    '  });',
    '}',
    '',
    'function fmtSize(n){',
    '  if(n==null||n===0) return "-";',
    '  var u=["B","KB","MB","GB","TB"], v=Number(n), i=0;',
    '  while(v>=1024&&i<u.length-1){ v/=1024; i++; }',
    '  return v.toFixed(i===0?0:1)+" "+u[i];',
    '}',
    '',
    'function renderUser(){',
    '  var el = document.getElementById("user");',
    '  api("GET","/api/user").then(function(d){',
    '    if(d.logged){',
    '      el.innerHTML = \'<span class="who">\'+esc(d.username)+\'</span> <button onclick="doLogout()">\'+T.logout+\'</button>\';',
    '    } else {',
    '      el.innerHTML = \'<span class="no">\'+T.notLogged+\'</span> <button class="primary" onclick="showLogin()">\'+T.login+\'</button>\';',
    '    }',
    '  }).catch(function(){ el.innerHTML = \'<span class="no">\'+T.notLogged+\'</span>\'; });',
    '}',
    '',
    'function renderNav(){',
    '  var tabs = [["packages",T.tabPackages],["installed",T.tabInstalled],["search",T.tabSearch],["tasks",T.tabTasks],["settings",T.tabSettings],["about",T.tabAbout]];',
    '  document.getElementById("nav").innerHTML = tabs.map(function(x){',
    '    return \'<a class="\'+(state.tab===x[0]?"on":"")+\'" onclick="tab(\\\'\'+x[0]+\'\\\')">\'+x[1]+\'</a>\';',
    '  }).join("");',
    '}',
    '',
    'function tab(name){',
    '  state.tab = name;',
    '  if(state.taskTimer){ clearInterval(state.taskTimer); state.taskTimer=null; }',
    '  renderNav();',
    '  var fns = { packages:renderPackages, installed:renderInstalled, search:renderSearch, tasks:renderTasks, settings:renderSettings, about:renderAbout };',
    '  (fns[name]||renderPackages)();',
    '}',
    '',
    'function renderPackages(){',
    '  var main = document.getElementById("main");',
    '  main.innerHTML = \'<div class="loading">\'+T.loading+\'</div>\';',
    '  api("GET","/api/packages").then(function(d){',
    '    state.pkgs = d.packages||[];',
    '    var s = d.stats||{};',
    '    var h = \'<div class="stats">\';',
    '    h += \'<div class="stat"><div class="k">\'+T.tabPackages+\'</div><div class="v">\'+(d.count||0)+\'</div></div>\';',
    '    h += \'<div class="stat"><div class="k">Releases</div><div class="v">\'+(s.releaseCount||0)+\'</div></div>\';',
    '    h += \'<div class="stat"><div class="k">Files</div><div class="v">\'+(s.fileCount||0)+\'</div></div>\';',
    '    h += \'</div>\';',
    '    h += \'<div class="toolbar"><input id="pkgFilter" placeholder="\'+esc(T.searchPh)+\'" oninput="filterPkgs()"><button class="primary" onclick="doGet()">\'+T.pull+\'</button><button onclick="renderPackages()">\'+T.refresh+\'</button></div>\';',
    '    h += \'<div id="pkgList"></div>\';',
    '    main.innerHTML = h;',
    '    filterPkgs();',
    '  }).catch(function(e){ main.innerHTML = \'<div class="empty">\'+esc(e.message)+\'</div>\'; });',
    '}',
    '',
    'function filterPkgs(){',
    '  var q = (document.getElementById("pkgFilter").value||"").toLowerCase();',
    '  var list = state.pkgs.filter(function(p){ return !q||p.name.toLowerCase().indexOf(q)!==-1||(p.company&&p.company.toLowerCase().indexOf(q)!==-1); });',
    '  var box = document.getElementById("pkgList");',
    '  if(!list.length){ box.innerHTML = \'<div class="empty">\'+T.noPkgs+\'</div>\'; return; }',
    '  var h = \'<table><thead><tr><th>\'+T.colName+\'</th><th>\'+T.colType+\'</th><th>\'+T.colCompany+\'</th><th>\'+T.colVersion+\'</th><th>\'+T.colFile+\'</th><th>\'+T.colSize+\'</th><th>\'+T.colActions+\'</th></tr></thead><tbody>\';',
    '  list.forEach(function(p){',
    '    var lat = p.latest||{};',
    '    var badge = p.type==="setup"?\'<span class="badge setup">setup</span>\':p.type==="port"?\'<span class="badge port">port</span>\':"";',
    '    var co = (p.company&&p.company!=="null")?esc(p.company):\'<span class="dim">null</span>\';',
    '    var vc = (p.versions&&p.versions.length>1)?\' <span class="dim">(\'+p.versions.length+\')</span>\':"";',
    '    h += \'<tr><td class="name">\'+esc(p.name)+\'</td><td>\'+badge+\'</td><td>\'+co+\'</td><td>v\'+esc(lat.version||"")+vc+\'</td><td class="mono">\'+esc(lat.fileName||"")+\'</td><td class="mono">\'+fmtSize(lat.size)+\'</td><td><button class="primary" onclick="doInstall(\\\'\'+esc(p.name)+\'\\\')">\'+T.install+\'</button>\';',
    '    if(p.versions&&p.versions.length>1) h += \' <button onclick="showVersions(\\\'\'+esc(p.name)+\'\\\')">\'+T.details+\'</button>\';',
    '    h += \'</td></tr>\';',
    '  });',
    '  h += \'</tbody></table>\';',
    '  box.innerHTML = h;',
    '}',
    '',
    'function renderInstalled(){',
    '  var main = document.getElementById("main");',
    '  main.innerHTML = \'<div class="loading">\'+T.loading+\'</div>\';',
    '  api("GET","/api/installed").then(function(d){',
    '    if(!d.count){ main.innerHTML = \'<div class="empty">\'+T.noInstalled+\'</div>\'; return; }',
    '    var h = \'<div class="toolbar"><button onclick="renderInstalled()">\'+T.refresh+\'</button><button class="primary" onclick="doUpdateAll()">\'+T.updateAll+\'</button></div>\';',
    '    h += \'<table><thead><tr><th>\'+T.colName+\'</th><th>\'+T.colType+\'</th><th>\'+T.colVersion+\'</th><th>\'+T.colFile+\'</th><th>\'+T.colActions+\'</th></tr></thead><tbody>\';',
    '    d.packages.forEach(function(p){',
    '      var badge = p.type==="setup"?\'<span class="badge setup">setup</span>\':p.type==="port"?\'<span class="badge port">port</span>\':"";',
    '      h += \'<tr><td class="name">\'+esc(p.name)+\'</td><td>\'+badge+\'</td><td>v\'+esc(p.version||"?")+\'</td><td class="mono">\'+esc(p.fileName||"")+\'</td><td><button onclick="doUpdate(\\\'\'+esc(p.name)+\'\\\')">\'+T.update+\'</button> <button class="danger" onclick="doUninstall(\\\'\'+esc(p.name)+\'\\\')">\'+T.uninstall+\'</button></td></tr>\';',
    '    });',
    '    h += \'</tbody></table>\';',
    '    main.innerHTML = h;',
    '  }).catch(function(e){ main.innerHTML = \'<div class="empty">\'+esc(e.message)+\'</div>\'; });',
    '}',
    '',
    'function renderSearch(){',
    '  var main = document.getElementById("main");',
    '  main.innerHTML = \'<div class="toolbar"><input id="sq" placeholder="\'+esc(T.searchPh)+\'" onkeydown="if(event.key===\\\'Enter\\\')doSearch()"><select id="stype"><option value="">\'+T.filterAll+\'</option><option value="setup">\'+T.filterSetup+\'</option><option value="port">\'+T.filterPort+\'</option></select><button class="primary" onclick="doSearch()">\'+T.searchBtn+\'</button></div><div id="sres"></div>\';',
    '}',
    '',
    'function doSearch(){',
    '  var q = document.getElementById("sq").value||"";',
    '  var ty = document.getElementById("stype").value||"";',
    '  var box = document.getElementById("sres");',
    '  box.innerHTML = \'<div class="loading">\'+T.loading+\'</div>\';',
    '  var ps = new URLSearchParams();',
    '  if(q) ps.set("q",q);',
    '  if(ty) ps.set("t",ty);',
    '  ps.set("av","1");',
    '  api("GET","/api/packages?"+ps.toString()).then(function(d){',
    '    if(!d.count){ box.innerHTML = \'<div class="empty">\'+T.noPkgs+\'</div>\'; return; }',
    '    var h = \'<table><thead><tr><th>\'+T.colName+\'</th><th>\'+T.colType+\'</th><th>\'+T.colCompany+\'</th><th>\'+T.colVersion+\'</th><th>\'+T.colFile+\'</th><th>\'+T.colSize+\'</th><th>\'+T.colActions+\'</th></tr></thead><tbody>\';',
    '    d.packages.forEach(function(p){',
    '      var badge = p.type==="setup"?\'<span class="badge setup">setup</span>\':p.type==="port"?\'<span class="badge port">port</span>\':"";',
    '      var co = (p.company&&p.company!=="null")?esc(p.company):\'<span class="dim">null</span>\';',
    '      p.versions.forEach(function(v,i){',
    '        h += \'<tr>\';',
    '        if(i===0){',
    '          h += \'<td class="name" rowspan="\'+p.versions.length+\'">\'+esc(p.name)+\'</td>\';',
    '          h += \'<td rowspan="\'+p.versions.length+\'">\'+badge+\'</td>\';',
    '          h += \'<td rowspan="\'+p.versions.length+\'">\'+co+\'</td>\';',
    '        }',
    '        h += \'<td>v\'+esc(v.version)+(v.version===p.latest.version?\' <span class="tag">\'+T.latest+\'</span>:"")+\'</td>\';',
    '        h += \'<td class="mono">\'+esc(v.fileName)+\'</td><td class="mono">\'+fmtSize(v.size)+\'</td>\';',
    '        h += \'<td><button class="primary" onclick="doInstall(\\\'\'+esc(p.name)+\'\\\',\\\'\'+esc(v.version)+\'\\\')">\'+T.install+\'</button></td></tr>\';',
    '      });',
    '    });',
    '    h += \'</tbody></table>\';',
    '    box.innerHTML = h;',
    '  }).catch(function(e){ box.innerHTML = \'<div class="empty">\'+esc(e.message)+\'</div>\'; });',
    '}',
    '',
    'function renderTasks(){ refreshTasks(); state.taskTimer = setInterval(refreshTasks,1000); }',
    '',
    'function refreshTasks(){',
    '  var main = document.getElementById("main");',
    '  api("GET","/api/tasks").then(function(d){',
    '    var list = d.tasks||[];',
    '    var h = \'<div class="toolbar"><button onclick="refreshTasks()">\'+T.refresh+\'</button>\';',
    '    if(list.length) h += \'<button class="danger" onclick="doTaskStop(\\\'all\\\')">\'+T.taskStopAll+\'</button>\';',
    '    h += \'</div>\';',
    '    if(!list.length){ h += \'<div class="empty">\'+T.taskEmpty+\'</div>\'; }',
    '    else {',
    '      h += \'<table><thead><tr><th>ID</th><th>\'+T.colName+\'</th><th>\'+T.colType+\'</th><th>进度</th><th>\'+T.colActions+\'</th></tr></thead><tbody>\';',
    '      list.forEach(function(tk){',
    '        var pct = tk.total>0?Math.min(tk.bytes/tk.total,1):0;',
    '        var label = tk.type==="download"?T.taskDownload:T.taskInstall;',
    '        h += \'<tr><td>\'+tk.id+\'</td><td class="name">\'+esc(tk.name)+\'</td><td>\'+label+\'</td><td>\';',
    '        if(tk.type==="download"){',
    '          h += \'<div class="bar"><span style="width:\'+(pct*100).toFixed(1)+\'%"></span></div> <span class="dim">\'+(pct*100).toFixed(1)+\'% \'+fmtSize(tk.bytes)+\' / \'+fmtSize(tk.total)+\'</span>\';',
    '        } else { h += \'<span class="dim">...</span>\'; }',
    '        h += \'</td><td><button class="danger" onclick="doTaskStop(\'+tk.id+\')">\'+T.taskStop+\'</button></td></tr>\';',
    '      });',
    '      h += \'</tbody></table>\';',
    '    }',
    '    main.innerHTML = h;',
    '  }).catch(function(){});',
    '}',
    '',
    'function renderSettings(){',
    '  var main = document.getElementById("main");',
    '  main.innerHTML = \'<div class="loading">\'+T.loading+\'</div>\';',
    '  api("GET","/api/settings").then(function(d){',
    '    var h = \'<table><thead><tr><th>\'+T.setKey+\'</th><th>\'+T.setValue+\'</th><th>\'+T.colActions+\'</th></tr></thead><tbody>\';',
    '    Object.keys(d).forEach(function(k){',
    '      var id = "set_"+k.replace(/[^a-zA-Z0-9_]/g,"_");',
    '      h += \'<tr><td class="mono">\'+esc(k)+\'</td><td><input id="\'+id+\'" value="\'+esc(d[k])+\'"></td><td><button class="primary" onclick="doSet(\\\'\'+esc(k)+\'\\\')">\'+T.setSave+\'</button></td></tr>\';',
    '    });',
    '    h += \'</tbody></table><p style="color:var(--muted);font-size:12px;margin-top:12px">\'+T.setHint+\'</p>\';',
    '    main.innerHTML = h;',
    '  }).catch(function(e){ main.innerHTML = \'<div class="empty">\'+esc(e.message)+\'</div>\'; });',
    '}',
    '',
    'function doSet(key){',
    '  var id = "set_"+key.replace(/[^a-zA-Z0-9_]/g,"_");',
    '  var el = document.getElementById(id); if(!el) return;',
    '  api("POST","/api/set",{key:key,value:el.value}).then(function(r){',
    '    if(r.ok) toastOk(T.setSaved+": "+key); else toastErr(r.error||T.unknown);',
    '  }).catch(toastErr);',
    '}',
    '',
    'function renderAbout(){',
    '  var main = document.getElementById("main");',
    '  api("GET","/api/version").then(function(d){',
    '    var h = \'<div class="stats">\';',
    '    h += \'<div class="stat"><div class="k">\'+T.aboutVer+\'</div><div class="v">v\'+esc(d.epm)+\'</div></div>\';',
    '    h += \'<div class="stat"><div class="k">\'+T.aboutPlat+\'</div><div class="v" style="font-size:14px">\'+esc(d.platform+"/"+d.arch)+\'</div></div>\';',
    '    h += \'<div class="stat"><div class="k">\'+T.aboutLang+\'</div><div class="v" style="font-size:14px">\'+esc(d.lang)+\'</div></div></div>\';',
    '    h += \'<h2 style="font-size:15px;margin:24px 0 12px">\'+T.aboutWeb+\'</h2><ul style="line-height:1.8;padding-left:20px">\';',
    '    T.webFeatures.forEach(function(f){ h += \'<li>\'+f+\'</li>\'; }); h += \'</ul>\';',
    '    h += \'<h2 style="font-size:15px;margin:24px 0 12px">\'+T.aboutCli+\'</h2><ul style="line-height:1.8;color:var(--muted);padding-left:20px">\';',
    '    T.cliFeatures.forEach(function(f){ h += \'<li>\'+f+\'</li>\'; }); h += \'</ul>\';',
    '    h += \'<h2 style="font-size:15px;margin:24px 0 12px">API</h2><p class="dim">完整 API 索引: <a href="/api" target="_blank">/api</a></p>\';',
    '    main.innerHTML = h;',
    '  }).catch(function(e){ main.innerHTML = \'<div class="empty">\'+esc(e.message)+\'</div>\'; });',
    '}',
    '',
    'function modal(html){',
    '  var el = document.createElement("div"); el.className="modal-bg"; el.id="modal-bg";',
    '  el.innerHTML = \'<div class="modal">\'+html+\'</div>\';',
    '  el.onclick = function(e){ if(e.target===el) closeModal(); };',
    '  document.body.appendChild(el);',
    '}',
    'function closeModal(){ var el = document.getElementById("modal-bg"); if(el) el.remove(); }',
    '',
    'function showLogin(){',
    '  modal(\'<h2>\'+T.loginTitle+\'</h2><div class="row"><label>\'+T.loginToken+\'</label><input id="loginToken" type="password" placeholder="\'+T.loginTokenPh+\'"></div><div class="hint">\'+T.loginHint+\' <a href="https://github.com/settings/tokens/new?scopes=repo,read:user,user:email&description=EasyPackageManager" target="_blank">点此创建 Token</a></div><div class="actions"><button onclick="closeModal()">\'+T.loginCancel+\'</button><button class="primary" onclick="doLogin()">\'+T.loginSubmit+\'</button></div>\');',
    '  setTimeout(function(){ var el = document.getElementById("loginToken"); if(el) el.focus(); },100);',
    '}',
    'function doLogin(){',
    '  var token = (document.getElementById("loginToken").value||"").trim(); if(!token) return;',
    '  toast(T.loggingIn);',
    '  api("POST","/api/login",{token:token}).then(function(r){',
    '    if(r.ok){ toastOk(T.loginOk+": "+r.username); closeModal(); renderUser(); }',
    '    else toastErr(T.loginFail+": "+(r.error||T.unknown));',
    '  }).catch(toastErr);',
    '}',
    'function doLogout(){ api("POST","/api/logout").then(function(){ toastOk(T.logoutOk); renderUser(); }).catch(toastErr); }',
    '',
    'function showVersions(name){',
    '  var p = state.pkgs.filter(function(x){ return x.name===name; })[0];',
    '  if(!p) return;',
    '  var h = \'<h2>\'+esc(name)+\'</h2><table><thead><tr><th>\'+T.colVersion+\'</th><th>\'+T.colFile+\'</th><th>\'+T.colSize+\'</th><th></th></tr></thead><tbody>\';',
    '  p.versions.forEach(function(v){',
    '    h += \'<tr><td>v\'+esc(v.version)+(v.version===p.latest.version?\' <span class="tag">\'+T.latest+\'</span>:"")+\'</td><td class="mono">\'+esc(v.fileName)+\'</td><td class="mono">\'+fmtSize(v.size)+\'</td><td><button class="primary" onclick="doInstall(\\\'\'+esc(name)+\'\\\',\\\'\'+esc(v.version)+\'\\\');closeModal()">\'+T.install+\'</button></td></tr>\';',
    '  });',
    '  h += \'</tbody></table><div class="actions"><button onclick="closeModal()">\'+T.loginCancel+\'</button></div>\';',
    '  modal(h);',
    '}',
    '',
    'function doGet(){',
    '  toast(T.pulling);',
    '  api("POST","/api/get").then(function(r){',
    '    if(r.ok){ toastOk(T.pullOk); renderPackages(); } else toastErr(r.error||T.unknown);',
    '  }).catch(toastErr);',
    '}',
    'function doInstall(name,version){',
    '  api("POST","/api/install",{name:name,version:version||null}).then(function(r){',
    '    if(r.ok) toastOk(T.installOk+": "+name); else toastErr(r.error||T.unknown);',
    '  }).catch(toastErr);',
    '}',
    'function doUninstall(name){',
    '  if(!confirm(T.confirmUninstall+name+" ?")) return;',
    '  api("POST","/api/uninstall",{name:name}).then(function(r){',
    '    if(r.ok){ toastOk(T.uninstallOk+": "+name); renderInstalled(); } else toastErr(r.error||T.unknown);',
    '  }).catch(toastErr);',
    '}',
    'function doUpdate(name){',
    '  if(!confirm(T.confirmUpdate+name+" ?")) return;',
    '  api("POST","/api/update",{name:name}).then(function(r){',
    '    if(r.ok) toastOk(T.updateOk+": "+name); else toastErr(r.error||T.unknown);',
    '  }).catch(toastErr);',
    '}',
    'function doUpdateAll(){',
    '  api("POST","/api/update",{}).then(function(r){',
    '    if(r.ok) toastOk(T.updateOk); else toastErr(r.error||T.unknown);',
    '  }).catch(toastErr);',
    '}',
    'function doTaskStop(id){ api("POST","/api/task/stop",{id:id}).then(function(){ refreshTasks(); }).catch(toastErr); }',
    '',
    'window.addEventListener("DOMContentLoaded", function(){',
    '  renderNav(); renderUser(); tab("packages");',
    '});'
  ].join('\n');

  return '<!doctype html>\n' +
    '<html lang="' + (lang === 'cn' ? 'zh-CN' : 'en') + '">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<title>EasyPackageManager</title>\n' +
    '<style>\n' + css + '\n</style>\n' +
    '</head>\n<body>\n' +
    '<header>\n' +
    '  <h1>EasyPackageManager</h1>\n' +
    '  <span class="meta">v' + esc(ver) + ' · ' + esc(plat) + ' · ' + esc(lang) + '</span>\n' +
    '  <div class="right" id="user"></div>\n' +
    '</header>\n' +
    '<nav id="nav"></nav>\n' +
    '<main id="main"><div class="loading">加载中...</div></main>\n' +
    '<footer>EasyPackageManager · <a href="/api" target="_blank">/api</a></footer>\n' +
    '<script>\n' + js + '\n</script>\n' +
    '</body>\n</html>';
}


async function handle(req, res) {
  let u;
  try { u = new URL(req.url, 'http://' + (req.headers.host || 'localhost')); }
  catch (_) { return text(res, 400, 'Bad Request'); }

  const p = u.pathname;
  const q = u.searchParams;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': '*'
    });
    return res.end();
  }

  if (p === '/' || p === '/index.html') {
    return html(res, 200, appHtml());
  }

  if (p === '/api' || p === '/api/') {
    const st = sources.stats();
    return json(res, 200, {
      name: 'EasyPackageManager API',
      version: versionLib.getPkgVersion(),
      platform: platform.platform,
      arch: platform.arch,
      lang: i18n.current(),
      stats: {
        pkgCount: st.pkgCount,
        releaseCount: st.releaseCount,
        fileCount: st.fileCount,
        installedCount: registry.list().length
      },
      endpoints: {
        'GET /api/version': 'EPM 版本',
        'GET /api/user': '登录状态',
        'GET /api/packages?q=&t=&av=1': '包列表',
        'GET /api/package/<name>': '单个包详情',
        'GET /api/installed': '已安装',
        'GET /api/tasks': '任务列表',
        'GET /api/settings': '设置',
        'POST /api/get': '从 GitHub 拉取',
        'POST /api/install': '{ name, version? }',
        'POST /api/uninstall': '{ name }',
        'POST /api/update': '{ name? }',
        'POST /api/add': '{ name, url }',
        'POST /api/set': '{ key, value }',
        'POST /api/task/stop': '{ id }',
        'POST /api/login': '{ token }',
        'POST /api/logout': ''
      }
    });
  }

  if (req.method === 'GET') {
    if (p === '/api/version') {
      return json(res, 200, {
        epm: versionLib.getPkgVersion(),
        platform: platform.platform,
        arch: platform.arch,
        lang: i18n.current(),
        installed: registry.list()
      });
    }

    if (p === '/api/user') {
      const a = auth.load();
      return json(res, 200, {
        logged: !!(a && a.token),
        username: (a && a.username) || null,
        email: (a && a.email) || null
      });
    }

    if (p === '/api/packages') {
      const qq = q.get('q') || '';
      const tt = q.get('t') || null;
      const ii = q.get('i') || null;
      const av = q.get('av') === '1';
      const hits = sources.search({ text: qq, type: tt, company: ii, allVersions: av });
      const st = sources.stats();
      return json(res, 200, {
        count: hits.length,
        stats: {
          pkgCount: st.pkgCount,
          releaseCount: st.releaseCount,
          fileCount: st.fileCount,
          installedCount: registry.list().length
        },
        packages: hits.map(function (x) {
          return {
            name: x.name, type: x.type, company: x.company,
            latest: x.latest ? {
              version: x.latest.version,
              fileName: x.latest.fileName,
              size: x.latest.size,
              url: x.latest.url
            } : null,
            versions: (x.versions || []).map(function (v) {
              return { version: v.version, fileName: v.fileName, size: v.size, url: v.url };
            })
          };
        })
      });
    }

    if (p.indexOf('/api/package/') === 0) {
      const name = decodeURIComponent(p.slice('/api/package/'.length));
      const pkg = sources.find(name);
      if (!pkg) return json(res, 404, { error: 'not found', name: name });
      return json(res, 200, {
        package: {
          name: pkg.name, type: pkg.type, company: pkg.company,
          latest: pkg.latest,
          versions: pkg.versions
        },
        installed: registry.get(pkg.name) || null
      });
    }

    if (p === '/api/installed') {
      const list = registry.list();
      return json(res, 200, { count: list.length, packages: list });
    }

    if (p === '/api/tasks') {
      const list = tasks.list();
      return json(res, 200, {
        count: list.length,
        tasks: list.map(function (tk) {
          return { id: tk.id, name: tk.name, type: tk.type, status: tk.status, bytes: tk.bytes, total: tk.total, started: tk.started };
        })
      });
    }

    if (p === '/api/settings') {
      return json(res, 200, config.list());
    }
  }

  if (req.method === 'POST') {
    const body = await readBody(req);

    if (p === '/api/get') {
      try {
        const { fetchAll } = require('./update-lib');
        const r = await fetchAll({});
        try { require('./applist').save(); } catch (_) {}
        return json(res, 200, { ok: true, releases: r.releases.length });
      } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
    }

    if (p === '/api/install') {
      if (!body.name) return json(res, 400, { ok: false, error: 'name required' });
      installer.install(body.name, body.version || null, {}).catch(function () {});
      return json(res, 200, { ok: true });
    }

    if (p === '/api/uninstall') {
      if (!body.name) return json(res, 400, { ok: false, error: 'name required' });
      installer.uninstall(body.name).catch(function () {});
      return json(res, 200, { ok: true });
    }

    if (p === '/api/update') {
      (async function () {
        try {
          const { fetchAll } = require('./update-lib');
          await fetchAll({});
        } catch (_) {}
        try { await installer.updatePackage(body.name || null, { q: true }); } catch (_) {}
      })();
      return json(res, 200, { ok: true });
    }

    if (p === '/api/add') {
      if (!body.name || !body.url) return json(res, 400, { ok: false, error: 'name and url required' });
      installer.addPackage(body.name, body.url, {}).catch(function () {});
      return json(res, 200, { ok: true });
    }

    if (p === '/api/set') {
      if (!body.key) return json(res, 400, { ok: false, error: 'key required' });
      try {
        config.set(body.key, String(body.value == null ? '' : body.value));
        if (body.key === 'lang') i18n.reload();
        return json(res, 200, { ok: true });
      } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
    }

    if (p === '/api/task/stop') {
      const id = body.id;
      if (id === 'all' || id == null) {
        const k = tasks.abortAll();
        return json(res, 200, { ok: true, killed: k });
      }
      const r = tasks.abort(id);
      return json(res, r.ok ? 200 : 404, r);
    }

    if (p === '/api/login') {
      if (!body.token) return json(res, 400, { ok: false, error: 'token required' });
      try {
        const res2 = await net.httpGetWithRetry('https://api.github.com/user', {
          headers: { authorization: 'Bearer ' + body.token, accept: 'application/vnd.github+json' }
        });
        if (res2.statusCode !== 200) return json(res, 401, { ok: false, error: 'invalid token' });
        const user = JSON.parse(res2.body.toString('utf8'));
        auth.save({ token: body.token, username: user.login, email: user.email || '', loggedAt: new Date().toISOString() });
        return json(res, 200, { ok: true, username: user.login });
      } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
    }

    if (p === '/api/logout') {
      auth.logout();
      return json(res, 200, { ok: true });
    }
  }

  return text(res, 404, 'Page not found');
}

/* ═══════ killPortHolder ═══════ */

function killPortHolder(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano | findstr :' + port, { encoding: 'utf8', windowsHide: true });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        if (line.indexOf('LISTENING') === -1) continue;
        const m = line.trim().match(/(\d+)\s*$/);
        if (m) pids.add(m[1]);
      }
      for (const pid of pids) {
        if (String(pid) === String(process.pid)) continue;
        try {
          execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore', timeout: 3000 });
          dbg('killed PID ' + pid + ' holding port ' + port);
        } catch (e) {
          dbg('kill PID ' + pid + ' failed: ' + e.message);
        }
      }
    } else {
      const out = execSync('lsof -ti :' + port, { encoding: 'utf8' });
      for (const pid of out.trim().split(/\s+/)) {
        if (!pid || String(pid) === String(process.pid)) continue;
        try { process.kill(Number(pid), 'SIGKILL'); } catch (_) {}
      }
    }
  } catch (e) {
    dbg('killPortHolder failed: ' + e.message);
  }
}

/* ═══════ 生命周期 ═══════ */

function start(opts) {
  opts = opts || {};
  if (server) return Promise.resolve({ ok: false, error: 'alreadyRunning', port: currentPort });
  const port = parseInt(opts.port || 7632, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return Promise.resolve({ ok: false, error: 'invalidPort' });
  const host = opts.host || '127.0.0.1';
  return new Promise(function (resolve) {
    const s = http.createServer(handle);
    s.on('error', function (err) {
      server = null; currentPort = null;
      if (err.code === 'EADDRINUSE') {
        try { killPortHolder(port); } catch (_) {}
      }
      resolve({ ok: false, error: err.code || 'listenError', message: err.message });
    });
    s.listen(port, host, function () {
      server = s; currentPort = port; currentHost = host;
      resolve({ ok: true, port: port, host: host });
    });
  });
}

function startBackground(opts) {
  opts = opts || {};
  const port = parseInt(opts.port || 7632, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return Promise.resolve({ ok: false, error: 'invalidPort' });
  const ex = readPid();
  if (ex && isAlive(ex.pid)) return Promise.resolve({ ok: false, error: 'alreadyRunning', port: ex.port, pid: ex.pid });
  clearPid();

  const isNodeExe = /(^|[\\/])node(\.exe)?$/i.test(process.execPath);
  const args = isNodeExe
    ? [process.argv[1], 'web', '--daemon', '--port', String(port)]
    : ['web', '--daemon', '--port', String(port)];

  const tmpdir = config.get('tempdir');
  try { fs.mkdirSync(tmpdir, { recursive: true }); } catch (_) {}
  const logFile = path.join(tmpdir, '.epm-web.log');
  let logFd = null;
  try { logFd = fs.openSync(logFile, 'w'); } catch (_) {}

  let child;
  try {
    child = spawn(process.execPath, args, {
      detached: true,
      stdio: ['ignore', logFd != null ? logFd : 'ignore', logFd != null ? logFd : 'ignore'],
      windowsHide: true,
      env: Object.assign({}, process.env, { EPM_DAEMON: '1', EPM_ROOT: config.ROOT })
    });
  } catch (e) {
    return Promise.resolve({ ok: false, error: 'spawnError', message: e.message });
  }
  child.unref();

  return new Promise(function (resolve) {
    const t0 = Date.now();
    const iv = setInterval(function () {
      const info = readPid();
      if (info && info.pid && isAlive(info.pid)) {
        clearInterval(iv);
        try { if (logFd != null) fs.closeSync(logFd); } catch (_) {}
        resolve({ ok: true, port: info.port, pid: info.pid });
      } else if (Date.now() - t0 > 8000) {
        clearInterval(iv);
        try { if (logFd != null) fs.closeSync(logFd); } catch (_) {}
        let logContent = '';
        try { logContent = fs.readFileSync(logFile, 'utf8'); } catch (_) {}
        const isBusy = logContent.indexOf('EADDRINUSE') !== -1;
        resolve({
          ok: false,
          error: isBusy ? 'portBusy' : 'timeout',
          message: isBusy ? ('端口 ' + port + ' 已被占用') : (logContent.slice(-500) || 'timeout')
        });
      }
    }, 100);
  });
}

function stop() {
  return new Promise(function (resolve) {
    const info = readPid();
    if (!info || !info.pid) return resolve({ ok: false, error: 'notRunning' });
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(info.pid), '/F', '/T'], { stdio: 'ignore', timeout: 3000 });
      } else {
        try { process.kill(info.pid, 'SIGTERM'); } catch (_) { process.kill(info.pid, 'SIGKILL'); }
      }
    } catch (_) {}
    clearPid();
    resolve({ ok: true, pid: info.pid, port: info.port });
  });
}

function status() {
  const info = readPid();
  if (!info || !info.pid) return { running: false };
  if (!isAlive(info.pid)) { clearPid(); return { running: false }; }
  return { running: true, pid: info.pid, port: info.port, host: info.host || '127.0.0.1' };
}

module.exports = { start, startBackground, stop, status, writePid, readPid, clearPid };
