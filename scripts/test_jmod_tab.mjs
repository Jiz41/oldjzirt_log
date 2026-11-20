import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = (await import("module")).createRequire(import.meta.url);
const JmodTab = require(path.join(__dirname, "..", "jmod.js"));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log("PASS: " + msg); }
  else { fail++; console.log("FAIL: " + msg); }
}

const dataPath = "/root/odds_probe/jmod/esn/jmod_milestones.json";
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

// 1. 点4つの位置が pct の大小順に左→右
{
  const html = JmodTab.bandSvg(data.band.points);
  const circles = [...html.matchAll(/<(?:circle|line stroke-dasharray)[^>]*/g)]; // not reliable; instead check via cx attrs
  const cxMatches = [...html.matchAll(/cx='([\d.]+)'/g)].map(m => parseFloat(m[1]));
  // fight point uses a dashed line not circle, so compute all x positions directly via fmtPct2 markers order check differently:
  // recompute expected order from data
  const sortedPts = [...data.band.points].sort((a, b) => a.pct - b.pct);
  const sortedKeys = sortedPts.map(p => p.key);
  const origOrderPct = data.band.points.map(p => p.pct);
  const isAscending = origOrderPct.every((v, i, arr) => i === 0 || arr[i - 1] <= v);
  ok(isAscending, "入力データのpointsがpct昇順である前提(line1<JMOD<市場<戦えるライン)");
  ok(cxMatches.length === 3, "circle(通常点)が3つ描画される(fight以外)");
  if (cxMatches.length === 3) {
    ok(cxMatches[0] <= cxMatches[1] && cxMatches[1] <= cxMatches[2], "circleのx座標がpct順に左→右");
  }
}

// 2. 行数=JSONの行数
{
  const html = JmodTab.milestoneTable(data.rows);
  const tbodyMatch = html.match(/<tbody>([\s\S]*)<\/tbody>/);
  const trCount = tbodyMatch ? [...tbodyMatch[1].matchAll(/<tr>/g)].length : 0;
  ok(trCount === data.rows.length, "表の行数(" + trCount + ")がJSONのrows件数(" + data.rows.length + ")と一致");
}

// 3. nullが「—」
{
  ok(JmodTab.fmtPct2(null) === "—", "readability_pct=null は「—」になる");
  const html = JmodTab.milestoneTable(data.rows);
  const hasNullRow = data.rows.some(r => r.readability_pct === null);
  if (hasNullRow) {
    ok(html.indexOf("—") !== -1, "表内にnull行の「—」が出現する");
  } else {
    console.log("INFO: テストデータにnull行なし、別途fmtPct2単体で検証済み");
  }
}

// 4. 数値の書式(小数2桁+%)
{
  ok(JmodTab.fmtPct2(1.4) === "1.40%", "fmtPct2(1.4) => 1.40%");
  ok(JmodTab.fmtPct2(29.51) === "29.51%", "fmtPct2(29.51) => 29.51%");
}

// 5. エスケープ: <script>を含む文字列を change に入れても生タグが出ない
{
  const evilRows = [
    { date: "2026-11-20", change: "<script>alert(1)</script>", readability_pct: 1.1, market_pct: 1.2, hit_race_pct: 30, recovery_pct: 70, period: "11/12〜11/18", races: 427 }
  ];
  const html = JmodTab.milestoneTable(evilRows);
  ok(html.indexOf("<script>alert(1)</script>") === -1, "change内の<script>タグが生のまま出力されない");
  ok(html.indexOf("&lt;script&gt;") !== -1, "change内の<script>タグがエスケープされて出力される");
}

// 6. 点が近接してもラベル位置が重ならない計算になっていること
{
  const closePoints = [
    { key: "line1", label: "line1", pct: 1.0 },
    { key: "jmod", label: "JMOD", pct: 1.02 },
    { key: "market", label: "市場", pct: 1.04 },
    { key: "fight", label: "戦えるライン(計算値)", pct: 1.06 }
  ];
  const html = JmodTab.bandSvg(closePoints);
  const ys = [...html.matchAll(/<text x='[\d.]+' y='(\d+)'[^>]*text-anchor='middle'>(line1|JMOD|市場|戦)/g)].map(m => m[1]);
  const uniqueYs = new Set(ys);
  ok(uniqueYs.size >= 2, "近接点のラベルが複数のy座標(行)に分かれて配置される(重なり回避)");
}

// 7. render() 全体が band/rows を含みエラーにならない
{
  const html = JmodTab.render(data);
  ok(html.indexOf("マイルストーン") !== -1 && html.indexOf("当てやすさの目盛り") !== -1, "render()が帯とマイルストーン両セクションを含む");
}

// 8. データ欠損時のフォールバック
{
  const html = JmodTab.render(null);
  ok(html.indexOf("データを読み込めません") !== -1, "data=nullでエラーメッセージを返す");
}

console.log("\n=== RESULT: " + pass + " PASS / " + fail + " FAIL ===");
process.exit(fail > 0 ? 1 : 0);
