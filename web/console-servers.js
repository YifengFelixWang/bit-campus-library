(function () {
  "use strict";

  var C = window.TataCore;
  var esc = C.esc;

  function roleBadge(node) {
    if (node.status !== "online") return C.badge("离线", "red");
    if (node.role === "primary") return C.badge("主节点", "green");
    return C.badge("备节点", "blue");
  }

  function meter(label, value, suffix) {
    var tone = value >= 80 ? "hot" : (value >= 60 ? "warn" : "");
    return '<div class="meter"><div class="meter-label"><span>' + esc(label) + "</span><span>" + value + (suffix || "%") + '</span></div><div class="meter-track"><i class="meter-bar ' + tone + '" style="width:' + Math.min(100, value) + '%"></i></div></div>';
  }

  function serverCardHtml(node) {
    var offline = node.status !== "online";
    return [
      '<div class="server-card ' + (node.role === "primary" ? "is-primary" : "") + (offline ? " is-offline" : "") + '">',
      '  <div class="server-head">',
      '    <div class="server-name"><i class="status-dot ' + (offline ? "offline" : "online") + '"></i><div><strong>' + esc(node.name) + "</strong><div class=\"server-host\">" + esc(node.host) + ":" + node.port + " · " + esc(node.region) + "</div></div></div>",
      "    " + roleBadge(node),
      "  </div>",
      '  <div class="server-meta">',
      "    <div>版本<b>" + esc(node.version) + "</b></div>",
      "    <div>复制延迟<b>" + (node.role === "standby" && !offline ? node.lag + " s" : (offline ? "—" : "0 s")) + "</b></div>",
      "    <div>连接数<b>" + (offline ? "—" : node.connections) + "</b></div>",
      "    <div>网络延迟<b>" + (offline ? "—" : node.latency + " ms") + "</b></div>",
      "  </div>",
      meter("CPU 使用率", offline ? 0 : node.cpu),
      meter("内存使用率", offline ? 0 : node.mem),
      '  <div class="row-actions" style="margin-top:12px">',
      '    <button class="link-btn" type="button" data-act="connect" data-id="' + esc(node.id) + '">连接此节点</button>',
      offline ? '<button class="link-btn primary" type="button" data-act="recover" data-id="' + esc(node.id) + '">恢复上线</button>' : "",
      "  </div>",
      "</div>"
    ].join("");
  }

  function topologySvg(c) {
    var a = c.nodes["node-a"];
    var b = c.nodes["node-b"];
    var aOn = a.status === "online";
    var bOn = b.status === "online";
    var aPrimary = a.role === "primary";
    var bPrimary = b.role === "primary";
    return [
      '<svg viewBox="0 0 880 330" role="img" aria-label="GaussDB 主备拓扑图">',
      '<defs><linearGradient id="topoGlow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4ead9"/><stop offset="1" stop-color="#fffdf9"/></linearGradient></defs>',
      '<rect x="0" y="0" width="880" height="330" fill="url(#topoGlow)"/>',
      '<g class="topo-node">',
      '  <rect x="24" y="118" width="156" height="94" rx="14"/>',
      '  <text x="44" y="150" class="tn-title">前端应用</text>',
      '  <text x="44" y="172" class="tn-sub">tata_app · 连接池</text>',
      '  <text x="44" y="190" class="tn-sub">心跳 2s · 自动重连</text>',
      "</g>",
      '<path class="topo-line ' + (aOn || bOn ? "active" : "down") + '" d="M180 165 H300"/>',
      '<circle class="topo-packet" r="3.5"><animateMotion dur="1.6s" repeatCount="indefinite" path="M180 165 H300"/></circle>',
      '<text x="196" y="155" class="topo-label">读写请求</text>',
      '<g class="topo-node ' + (aPrimary ? "primary" : "") + (aOn ? "" : " offline") + '">',
      '  <rect x="300" y="56" width="230" height="140" rx="16"/>',
      '  <text x="322" y="86" class="tn-title">节点 A</text>',
      '  <text x="322" y="108" class="tn-sub">' + esc(a.host) + ":" + a.port + "</text>",
      '  <text x="322" y="128" class="tn-sub">' + (aPrimary ? "主节点 · 读写" : (aOn ? "备节点 · 只读" : "已离线")) + "</text>",
      '  <text x="322" y="148" class="tn-sub">CPU ' + a.cpu + "% · 延迟 " + a.latency + "ms</text>",
      aOn ? '<circle cx="500" cy="80" r="4" fill="#3f9a68" class="node-pulse"/>' : '<circle cx="500" cy="80" r="4" fill="#c05043"/>',
      "</g>",
      '<g class="topo-node ' + (bPrimary ? "primary" : "") + (bOn ? "" : " offline") + '">',
      '  <rect x="610" y="56" width="230" height="140" rx="16"/>',
      '  <text x="632" y="86" class="tn-title">节点 B</text>',
      '  <text x="632" y="108" class="tn-sub">' + esc(b.host) + ":" + b.port + "</text>",
      '  <text x="632" y="128" class="tn-sub">' + (bPrimary ? "主节点 · 读写" : (bOn ? "备节点 · 只读" : "已离线")) + "</text>",
      '  <text x="632" y="148" class="tn-sub">CPU ' + b.cpu + "% · 延迟 " + b.latency + "ms</text>",
      bOn ? '<circle cx="810" cy="80" r="4" fill="#3f9a68" class="node-pulse"/>' : '<circle cx="810" cy="80" r="4" fill="#c05043"/>',
      "</g>",
      '<path class="topo-line ' + (aOn && bOn ? "active" : "down") + '" d="M530 96 H610"/>',
      '<path class="topo-line ' + (aOn && bOn ? "" : "down") + '" d="M610 186 H530"/>',
      '<text x="538" y="88" class="topo-label">WAL 流复制</text>',
      '<text x="538" y="204" class="topo-label">心跳 / 仲裁</text>',
      '<text x="330" y="238" class="topo-label">' + (aOn ? "节点 A 在线" : "节点 A 离线") + " · " + (bOn ? "节点 B 在线" : "节点 B 离线") + " · 自动故障转移" + (c.autoFailover ? "开启" : "关闭") + "</text>",
      '<text x="330" y="260" class="topo-label">切换次数 ' + c.switchCount + " · 最近切换 " + (c.lastFailover ? "刚刚" : "无") + "</text>",
      "</svg>"
    ].join("");
  }

  function renderServers() {
    C.setActions([
      '<button class="btn btn-ghost btn-sm" type="button" data-hact="tick">' + C.icon("refresh") + "刷新状态</button>",
      C.can("server:manage") ? '<button class="btn btn-primary btn-sm" type="button" data-hact="switch">' + C.icon("swap") + "手动切换主备</button>" : ""
    ].join(""));

    var c = window.TataDB.clusterSnapshot();
    var primary = c.nodes[c.primary];
    var standby = c.nodes[c.standby];
    var offline = Object.keys(c.nodes).filter(function (id) { return c.nodes[id].status !== "online"; });
    var nodes = [c.nodes["node-a"], c.nodes["node-b"]];

    C.body().innerHTML = [
      '<div class="panel">',
      '  <div class="panel-head"><div><h2>GaussDB 主备拓扑</h2><p>应用通过连接串同时配置两个节点，读写请求始终指向当前主节点</p></div>',
      '    <label class="switch"><input type="checkbox" id="autoFailover"' + (c.autoFailover ? " checked" : "") + ">自动故障转移</label></div>",
      '  <div class="topology">' + topologySvg(c) + "</div>",
      '  <div class="toolbar" style="margin-top:14px">',
      '    <button class="btn btn-danger btn-sm" type="button" data-act="stop" ' + (primary && primary.status === "online" ? "" : "disabled") + ">" + C.icon("power") + "模拟关闭主服务器</button>",
      offline.length ? '<button class="btn btn-primary btn-sm" type="button" data-act="recover" data-id="' + esc(offline[0]) + '">' + C.icon("refresh") + "恢复离线节点 " + esc(offline[0].replace("node-", "").toUpperCase()) + "</button>" : "",
      '    <button class="btn btn-ghost btn-sm" type="button" data-act="switch" ' + (primary && standby && primary.status === "online" && standby.status === "online" ? "" : "disabled") + ">" + C.icon("swap") + "手动切换</button>",
      '    <span class="spacer"></span>',
      '    <span class="hint">切换次数 ' + c.switchCount + " · 最近切换 " + (c.lastFailover ? C.fmtDateTime(c.lastFailover) : "无") + "</span>",
      "  </div>",
      "</div>",
      '<div class="server-grid" style="margin-top:18px">',
      nodes.map(serverCardHtml).join(""),
      "</div>",
      '<div class="grid-2" style="margin-top:18px">',
      '  <div class="panel">',
      '    <div class="panel-head"><div><h2>集群事件</h2><p>心跳、选主、复制与连接重定向日志</p></div></div>',
      '    <div class="timeline" id="clusterEvents">',
      c.events.slice(0, 10).map(function (e) {
        var tone = e.level === "success" ? "success" : (e.level === "warn" ? "warn" : (e.level === "error" ? "error" : ""));
        return '<div class="timeline-item ' + tone + '"><strong>' + esc(e.text) + '</strong><span>' + C.fmtDateTime(e.ts) + "</span></div>";
      }).join(""),
      "    </div>",
      "  </div>",
      '  <div class="panel">',
      '    <div class="panel-head"><div><h2>应用连接与自动重连</h2><p>前端检测主备状态并展示当前路由</p></div></div>',
      '    <pre class="code-block small">' + esc([
        "jdbc:postgresql://10.0.1.11:8000,10.0.1.12:8000/tata_books",
        "  ?target_session_attrs=read-write",
        "  &connectTimeout=3",
        "  &hostRecheckSeconds=2",
        "",
        "应用心跳间隔：2s",
        "故障检测阈值：3 次心跳超时",
        "重连策略：指数退避，最多 5 次"
      ].join("\n")) + "</pre>",
      '    <div class="hint" style="margin-top:10px">当主节点关闭时，DCS 仲裁提升备节点；虚拟 IP 或连接串探测自动把读写请求路由到新主节点，应用无需改配置。</div>',
      '    <div class="divider"></div>',
      '    <div class="hint">当前主节点：<strong>' + esc(primary ? primary.name : "-") + "</strong> · 复制延迟 " + (standby && standby.status === "online" ? standby.lag + " s" : "备节点离线") + " · 自动切换" + (c.autoFailover ? "已开启" : "已关闭") + "</div>",
      "  </div>",
      "</div>"
    ].join("");

    document.getElementById("autoFailover").addEventListener("change", function () {
      var result = window.TataDB.setAutoFailover(this.checked);
      C.toast(result.message, "success");
    });

    C.body().onclick = function (event) {
      var button = event.target.closest("button[data-act]");
      if (!button || C.state.currentTab !== "servers") return;
      var act = button.getAttribute("data-act");
      var id = button.getAttribute("data-id");
      if (act === "stop") stopPrimary();
      else if (act === "switch") manualSwitch();
      else if (act === "recover") recoverNode(id);
      else if (act === "connect") connectNode(id);
    };
  }

  function manualSwitch() {
    window.TataUI.confirm({
      icon: "swap",
      title: "手动切换主备",
      desc: "确认将当前主节点降为备节点，并把备节点提升为主节点？应用连接会自动重定向。",
      confirmText: "执行切换",
      onConfirm: function () {
        var result = window.TataDB.switchPrimary();
        if (!result.ok) {
          C.toast(result.message, "error");
          return false;
        }
        C.toast(result.message);
        window.TataUI.refreshAll();
        renderServers();
        return true;
      }
    });
  }

  function stopPrimary() {
    var c = window.TataDB.clusterSnapshot();
    if (!c.autoFailover) {
      C.toast("自动故障转移已关闭，请先开启再演示主节点故障。", "warn");
      return;
    }
    window.TataUI.confirm({
      icon: "power",
      title: "模拟关闭主服务器",
      desc: "将模拟主节点断电/进程退出。系统会检测心跳超时、由 DCS 仲裁并自动提升备节点，全过程约 3 秒。",
      confirmText: "关闭主服务器",
      danger: true,
      onConfirm: function () {
        var result = window.TataDB.stopPrimary();
        if (!result.ok) {
          C.toast(result.message, "error");
          return false;
        }
        C.toast(result.message, "warn");
        window.TataUI.refreshAll();
        renderServers();
        showFailoverSteps(result.steps || []);
        return true;
      }
    });
  }

  function showFailoverSteps(steps) {
    var body = [
      '<div class="hint" style="margin-bottom:12px">主节点已下线，以下步骤由集群自动完成；应用侧无需修改连接配置。</div>',
      '<div class="timeline" id="foSteps">',
      steps.map(function (text, index) {
        return '<div class="timeline-item" data-fo="' + index + '"><strong>' + esc(text) + '</strong><span>等待执行…</span></div>';
      }).join(""),
      "</div>"
    ].join("");
    window.TataUI.modal({
      icon: "server",
      title: "自动故障转移",
      desc: "检测到主节点心跳丢失，正在执行选主与提升流程。",
      bodyHtml: body,
      wide: true,
      confirmText: "完成",
      cancelText: "关闭",
      onConfirm: function () {
        if (C.timers.failover) {
          clearInterval(C.timers.failover);
          C.timers.failover = null;
        }
        return true;
      }
    });
    var items = document.querySelectorAll("#foSteps .timeline-item");
    var index = 0;
    if (C.timers.failover) clearInterval(C.timers.failover);
    C.timers.failover = setInterval(function () {
      if (document.getElementById("modal").hidden) {
        clearInterval(C.timers.failover);
        C.timers.failover = null;
        return;
      }
      if (index >= items.length) {
        clearInterval(C.timers.failover);
        C.timers.failover = null;
        C.toast("故障转移完成，前端已连接新主节点");
        return;
      }
      items[index].classList.add("success");
      items[index].querySelector("span").textContent = "完成 · " + C.fmtDateTime(new Date().toISOString());
      index += 1;
    }, 620);
  }

  function recoverNode(id) {
    var result = window.TataDB.recoverNode(id);
    C.toast(result.message, result.ok ? "success" : "error");
    if (result.ok) {
      window.TataUI.refreshAll();
      renderServers();
    }
  }

  function connectNode(id) {
    var result = window.TataDB.connectNode(id);
    C.toast(result.message, result.ok ? (result.readOnly ? "warn" : "success") : "error");
  }

  C.registry.servers = renderServers;
  C.enter.servers = function () { C.startClusterHeartbeat(); };
  C.handlers.tick = function () {
    window.TataDB.tickCluster();
    C.toast("已刷新主备节点状态");
  };
  C.handlers.switch = manualSwitch;
})();
