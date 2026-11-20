// ===== JMODタブ（確率モデル試作の進捗） =====
// 純関数（データ→HTML文字列）と、取得して描く部分を分離。純関数は node から module.exports で呼べる。
var JmodTab = (function () {
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  function fmtPct2(v) {
    if (v === null || v === undefined) return "—";
    return Number(v).toFixed(2) + "%";
  }

  // 帯グラフ: 横軸=当てやすさ(%)、0起点。points=[{key,label,pct}...]
  function bandSvg(points) {
    if (!points || !points.length) return "<p class='subhead'>データがありません。</p>";
    var W = 600, H = 120, padL = 16, padR = 16;
    var maxV = 0;
    for (var i = 0; i < points.length; i++) { if (points[i].pct > maxV) maxV = points[i].pct; }
    var axisMax = maxV * 1.1;
    if (axisMax <= 0) axisMax = 1;
    function x(v) { return padL + (W - padL - padR) * (v / axisMax); }

    // ラベル重なり回避: x座標が近い点(閾値以内)を上下にずらす
    var sorted = points.map(function (p, idx) { return { p: p, idx: idx, x: x(p.pct) }; }).sort(function (a, b) { return a.x - b.x; });
    var THRESH = 60;
    var rowAt = [];
    for (var i = 0; i < sorted.length; i++) {
      var row = 0;
      if (i > 0 && (sorted[i].x - sorted[i - 1].x) < THRESH) {
        row = (rowAt[i - 1] === 0) ? 1 : 0;
      }
      rowAt.push(row);
      sorted[i].row = row;
    }
    var rowY = { 0: 30, 1: 50 };
    var labelOrder = [];
    labelOrder[0] = null;
    sorted.forEach(function (s) { labelOrder[s.idx] = s; });

    var axisY = 80;
    var html = "<svg viewBox='0 0 " + W + " " + H + "' width='100%' height='" + H + "' preserveAspectRatio='none'>";
    html += "<line x1='" + padL + "' y1='" + axisY + "' x2='" + (W - padR) + "' y2='" + axisY + "' stroke='var(--grid-line)' stroke-width='1'/>";

    points.forEach(function (p, idx) {
      var px = x(p.pct).toFixed(1);
      var isFight = p.key === "fight";
      var color = isFight ? "var(--gold)" : (p.key === "jmod" ? "var(--neon-a)" : (p.key === "market" ? "var(--accent-2)" : "var(--text-dim)"));
      var s = labelOrder[idx];
      var ly = s.row === 1 ? rowY[1] : rowY[0];
      if (isFight) {
        html += "<line x1='" + px + "' y1='" + (axisY - 10) + "' x2='" + px + "' y2='" + (axisY + 10) + "' stroke='" + color + "' stroke-width='1.5' stroke-dasharray='3,3'/>";
      } else {
        html += "<circle cx='" + px + "' cy='" + axisY + "' r='4' fill='" + color + "'/>";
      }
      html += "<line x1='" + px + "' y1='" + (ly + 4) + "' x2='" + px + "' y2='" + (axisY - (isFight ? 10 : 4)) + "' stroke='" + color + "' stroke-width='1' stroke-dasharray='2,2'/>";
      html += "<text x='" + px + "' y='" + ly + "' font-size='10' fill='" + color + "' text-anchor='middle'>" + esc(p.label) + "</text>";
      html += "<text x='" + px + "' y='" + (ly + 12) + "' font-size='10' fill='" + color + "' text-anchor='middle'>" + esc(fmtPct2(p.pct)) + "</text>";
    });

    html += "</svg>";
    return html;
  }

  function milestoneTable(rows) {
    if (!rows || !rows.length) return "<p class='subhead'>データがありません。</p>";
    var html = "<div class='table-scroll'><table><thead><tr>" +
      "<th>日付</th><th>何を変えたか</th><th>当てやすさ</th><th>市場</th><th>1点以上当たったレース</th><th>確定払戻の回収</th><th>期間・R数</th>" +
      "</tr></thead><tbody>";
    rows.forEach(function (r) {
      html += "<tr>" +
        "<td>" + esc(r.date) + "</td>" +
        "<td>" + esc(r.change) + "</td>" +
        "<td>" + fmtPct2(r.readability_pct) + "</td>" +
        "<td>" + fmtPct2(r.market_pct) + "</td>" +
        "<td>" + fmtPct2(r.hit_race_pct) + "</td>" +
        "<td>" + fmtPct2(r.recovery_pct) + "</td>" +
        "<td>" + esc(r.period) + "・" + esc(String(r.races)) + "R</td>" +
        "</tr>";
    });
    html += "</tbody></table></div>";
    return html;
  }

  function render(data) {
    if (!data || !data.band || !data.rows) return "<div class='error'>データを読み込めません</div>";
    var html = "";
    html += "<section><h2>当てやすさの目盛り</h2><div class='chart-wrap'>" + bandSvg(data.band.points) + "</div>";
    html += "<p class='subhead'>" + esc(data.band.note || "") + "</p>";
    html += "<p class='subhead'>" + esc(data.band.logloss_note || "") + "</p>";
    html += "</section>";
    html += "<section><h2>マイルストーン</h2>" + milestoneTable(data.rows) +
      "<p class='subhead'>数字はすべて大きいほど良い向き。当てやすさ=実際の着順に付けた確率(1〜3着の組)。回収は確定払戻で計算。</p></section>";
    return html;
  }

  return { render: render, bandSvg: bandSvg, milestoneTable: milestoneTable, fmtPct2: fmtPct2 };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = JmodTab;
}

// ===== データ取得 → 描画（ブラウザのみ） =====
(function () {
  if (typeof document === "undefined") return;
  var JMOD_URL = "https://raw.githubusercontent.com/Jiz41/oldjzirt_log/shadow-data/data/jmod/jmod_milestones.json";
  var loaded = false;

  JmodTab.loadInto = function (elId) {
    var el = document.getElementById(elId);
    if (!el) return;
    if (loaded) return;
    loaded = true;
    el.innerHTML = "<div class='loading'>読み込み中…</div>";
    fetch(JMOD_URL, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (data) {
      el.innerHTML = JmodTab.render(data);
    }).catch(function (e) {
      loaded = false;
      el.innerHTML = "<div class='error'>データを読み込めません</div>";
    });
  };
})();
