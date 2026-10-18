#!/usr/bin/env node
// oldjzirt シャドー台帳の収集器。
// kdreams から指定日の全レースを取得し、oldjzirt のエンジン（keirin_logic.js）と decision_core.js で
// 予想（買い目8点・ティア・確率）を再現計算し、結果ページで精算して data/shadow/YYYYMM.jsonl に書く。
//
// - 手入力画面→エンジン入力の変換規則は oldjzirt/paste-input.js の applyRaceData と同一
//   （脚質・直近3走・S/B首位・公式並び・級班→raceType・場→bankName・地元判定・W印は「無」）。
// - ラベル導出・ティア・確率は oldjzirt/decision_panel.js の computeDecisionData と同一手順
//   （晴天令スコア=snapshot.scores.final.seiten、実効風速=風速×bank.beta）。
//   上位3車と特異点Lはエンジン出力HTMLから取る（replay/explore/common.mjs の parseLabels と同一規約）。
// - エンジン・decision_core・harness・bankdata は --oldjzirt-dir から読むだけで、複製しない。
// - 台帳は稼働日の翌日以降の初見データ専用。過去の探索データ（replay/ 配下）は書かない。
// - 公開リポジトリのため、選手名・府県・コメント・予想紙名や印の文言は出力しない。

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const USER_AGENT =
  'PoliteKeirinBot/1.0 (on-demand only, no flood; say the word and I vanish; DM: https://x.com/kayoutouidou01)';
const HTTP_INTERVAL_MS = 3000;
const STAKE_PER_POINT = 100;
const RESCAN_DAYS = 3;

// ---------- paste-input.js 由来の対応表（同一内容） ----------

const SERIES_MAP = { 'S級': 's-kyu', 'A級': 'a-kyu', 'A級チャレンジ': 'a-chal', 'ガールズ': 'girls' };

const BANK_NAME_MAP = {
  '函館':'🦑函館', '青森':'🍎青森', 'いわき平':'🏝️いわき平',
  '弥彦':'⛩️弥彦', '前橋':'🏔️前橋', '取手':'🐓取手',
  '宇都宮':'🥟宇都宮', '大宮':'🌸大宮', '西武園':'🎡西武園',
  '京王閣':'🏦京王閣', '立川':'🏙️立川', '松戸':'🏰松戸',
  '川崎':'🏭川崎', '平塚':'🎋平塚', '小田原':'🏯小田原',
  '伊東':'♨️伊東', '静岡':'🗻静岡', '富山':'🐟富山',
  '名古屋':'🏯名古屋', '岐阜':'🎣岐阜', '大垣':'💧大垣',
  '豊橋':'🧨豊橋', '松阪':'🥩松阪', '四日市':'🌃四日市',
  '福井':'🦖福井', '奈良':'🦌奈良', '向日町':'🎋向日町',
  '和歌山':'🍊和歌山', '岸和田':'🏮岸和田', '玉野':'🛳️玉野',
  '広島':'🍁広島', '防府':'⛩️防府', '高松':'🍜高松',
  '小松島':'🦝小松島', '高知':'🐳高知', '松山':'🍊松山',
  '小倉':'🚂小倉', '久留米':'🍜久留米', '武雄':'♨️武雄',
  '佐世保':'🍔佐世保', '別府':'♨️別府', '熊本':'🏯熊本',
};

const VENUE_PREF_MAP = {
  '函館':'北海道', '青森':'青森', 'いわき平':'福島',
  '弥彦':'新潟', '前橋':'群馬', '取手':'茨城',
  '宇都宮':'栃木', '大宮':'埼玉', '西武園':'埼玉',
  '京王閣':'東京', '立川':'東京', '松戸':'千葉',
  '川崎':'神奈川', '平塚':'神奈川', '小田原':'神奈川',
  '伊東':'静岡', '静岡':'静岡', '富山':'富山',
  '名古屋':'愛知', '岐阜':'岐阜', '大垣':'岐阜',
  '豊橋':'愛知', '松阪':'三重', '四日市':'三重',
  '福井':'福井', '奈良':'奈良', '向日町':'京都',
  '和歌山':'和歌山', '岸和田':'大阪', '玉野':'岡山',
  '広島':'広島', '防府':'山口', '高松':'香川',
  '小松島':'徳島', '高知':'高知', '松山':'愛媛',
  '小倉':'福岡', '久留米':'福岡', '武雄':'佐賀',
  '佐世保':'長崎', '別府':'大分', '熊本':'熊本',
};

const VENUE_LATLNG = {
  '🦑函館':     [41.7686, 140.7288],
  '🍎青森':     [40.7822, 140.7380],
  '🏝️いわき平': [37.0574, 140.8877],
  '⛩️弥彦':     [37.6517, 138.8272],
  '🏔️前橋':     null,
  '🐓取手':     [35.9103, 140.0780],
  '🥟宇都宮':   [36.5658, 139.8836],
  '🌸大宮':     [35.9065, 139.6244],
  '🎡西武園':   [35.7897, 139.4731],
  '🏦京王閣':   [35.6297, 139.4503],
  '🏙️立川':     [35.7042, 139.4139],
  '🏰松戸':     [35.7878, 139.9026],
  '🏭川崎':     [35.5308, 139.7032],
  '🎋平塚':     [35.3303, 139.3497],
  '🏯小田原':   [35.2481, 139.1542],
  '♨️伊東':     [34.9657, 139.0991],
  '🗻静岡':     [34.9756, 138.3831],
  '🐟富山':     [36.6953, 137.2113],
  '🏯名古屋':   [35.1815, 136.9066],
  '🎣岐阜':     [35.4231, 136.7608],
  '💧大垣':     [35.3597, 136.6194],
  '🧨豊橋':     [34.7694, 137.3917],
  '🥩松阪':     [34.5781, 136.5272],
  '🌃四日市':   [34.9731, 136.6242],
  '🦖福井':     [36.0641, 136.2197],
  '🦌奈良':     [34.6853, 135.8326],
  '🎋向日町':   [34.9408, 135.7103],
  '🍊和歌山':   [34.2261, 135.1669],
  '🏮岸和田':   [34.4608, 135.3628],
  '🛳️玉野':     [34.4878, 133.9458],
  '🍁広島':     [34.3853, 132.4733],
  '⛩️防府':     [34.0531, 131.5617],
  '🍜高松':     [34.3403, 134.0461],
  '🦝小松島':   [33.9778, 134.5897],
  '🐳高知':     [33.5597, 133.5317],
  '🍊松山':     [33.8331, 132.7658],
  '🚂小倉':     null,
  '🍜久留米':   [33.3197, 130.5081],
  '♨️武雄':     [33.1928, 130.0194],
  '🍔佐世保':   [33.1597, 129.7186],
  '♨️別府':     [33.2797, 131.4975],
  '🏯熊本':     [32.7903, 130.7419],
};

export function degToDirection(deg) {
  const dirs = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
  return dirs[Math.round(deg / 45) % 8];
}

export function kmhToMs(kmh) {
  return Math.round((kmh / 3.6) * 2) / 2;
}

// ---------- HTTP（全リクエスト直列・3秒間隔・異常ステータスで中断） ----------

export class HttpAbort extends Error {}

let lastRequestAt = 0;
let consecutiveBad = 0;
let requestCount = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const realFetch = require('node-fetch');
const racecardHtml = new Map();

export async function politeFetch(url, opts = {}) {
  const headers = { 'User-Agent': USER_AGENT, ...(opts.headers || {}) };
  let res;
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequestAt + HTTP_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    requestCount++;
    try {
      res = await realFetch(url, { timeout: 30000, ...opts, headers });
      break;
    } catch (err) {
      // 通信断・タイムアウトは1回だけ再試行（間隔は通常どおり3秒以上空く）
      if (attempt >= 1) throw err;
    }
  }
  // 出走表（racedetail、pageType無し）の本文を控える。決まり手回数は vendor の scraper.js が外へ出さないため、
  // 同じHTMLを shadow_crawl 側で読む（追加のHTTPは出さない）。
  if (/\/racedetail\/\d+\/$/.test(url) && res.ok) {
    const body = await res.text();
    racecardHtml.set(url, body);
    res = new realFetch.Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  }
  const s = res.status;
  if (s === 403 || s === 429) {
    throw new HttpAbort(`HTTP ${s}: ${url}`);
  }
  if (s >= 500) {
    consecutiveBad++;
    if (consecutiveBad >= 2) throw new HttpAbort(`HTTP ${s} が連続: ${url}`);
  } else {
    consecutiveBad = 0;
  }
  return res;
}

// vendor の kaisai.js / scraper.js は require('node-fetch') を直接使う。改変せずに礼儀を守らせるため、
// 読み込み前に node-fetch のモジュールキャッシュを politeFetch に差し替える。
const nodeFetchPath = require.resolve('node-fetch');
require(nodeFetchPath);
require.cache[nodeFetchPath].exports = Object.assign(politeFetch, realFetch);
const { getKaisai } = require('./vendor/kaisai.js');
const cheerio = require('cheerio');
const { scrapeRace } = require('./vendor/scraper.js');

// scraper.js の VENUE_MAP と同一（結果ページURL用）
const SLUG_BY_CODE = {
  '11': 'hakodate', '12': 'aomori', '13': 'iwakitaira', '21': 'yahiko', '22': 'maebashi',
  '23': 'toride', '24': 'utsunomiya', '25': 'omiya', '26': 'seibuen', '27': 'keiokaku',
  '28': 'tachikawa', '31': 'matsudo', '32': 'chiba', '34': 'kawasaki', '35': 'hiratsuka',
  '36': 'odawara', '37': 'ito', '38': 'shizuoka', '42': 'nagoya', '43': 'gifu',
  '44': 'ogaki', '45': 'toyohashi', '46': 'toyama', '47': 'matsusaka', '48': 'yokkaichi',
  '51': 'fukui', '53': 'nara', '54': 'mukomachi', '55': 'wakayama', '56': 'kishiwada',
  '61': 'tamano', '62': 'hiroshima', '63': 'hofu', '71': 'takamatsu', '73': 'komatsushima',
  '74': 'kochi', '75': 'matsuyama', '81': 'kokura', '83': 'kurume', '84': 'takeo',
  '85': 'sasebo', '86': 'beppu', '87': 'kumamoto',
};

// ---------- 日付 ----------

function jstCompact(d) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(d).replace(/-/g, '');
}

// Actions の schedule は数十分遅れることがあるため、既定日は「JSTの(現在−2時間)の日付」とする
// （23:50起動でも翌0:20起動でも同じ日を指す）。
export function defaultTargetDate(now = new Date()) {
  return jstCompact(new Date(now.getTime() - 2 * 60 * 60 * 1000));
}

function toUtcNoon(c) {
  return new Date(Date.UTC(+c.slice(0, 4), +c.slice(4, 6) - 1, +c.slice(6, 8), 12));
}
function fromUtc(d) {
  return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
}
export function addDays(c, n) {
  return fromUtc(new Date(toUtcNoon(c).getTime() + n * 86400000));
}
export function dash(c) {
  return `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}`;
}

// raceId = 場コード(2) + 開催初日YYYYMMDD(8) + 日目(2) + R(2)。出走日 = 初日 + (日目−1)。
export function raceDateOf(raceId) {
  return addDays(raceId.slice(2, 10), parseInt(raceId.slice(10, 12), 10) - 1);
}

// ---------- 結果ページ（gg_snjzirt_fetch.gs の parseResult / parseRefundTable を移植） ----------

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '').trim();
}

function extractAmount(str) {
  const cleaned = str.replace(/<span>[\s\S]*?<\/span>/g, '').replace(/[^\d,]/g, '').replace(/,/g, '');
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? null : n;
}

function parseRefundTable(html) {
  const result = { sanrentan: null, sanrenpuku: null, nisyatan: null };
  const areaIdx = html.indexOf('refund_table_area');
  if (areaIdx === -1) return result;
  const tableStart = html.indexOf('<table', areaIdx);
  if (tableStart === -1) return result;
  const tableEnd = html.indexOf('</table>', tableStart);
  if (tableEnd === -1) return result;
  const tbl = html.substring(tableStart, tableEnd + 8);
  const trs = tbl.match(/<tr[\s\S]*?<\/tr>/g) || [];
  if (trs.length < 2) return result;

  const tr1Cells = trs[0].match(/<th[\s\S]*?<\/th>|<td[\s\S]*?<\/td>/g) || [];
  const betTypeOrder = [];
  const fukuMap = {};
  let i = 0;
  while (i < tr1Cells.length) {
    if (tr1Cells[i].startsWith('<th')) {
      const betType = tr1Cells[i].replace(/<[^>]+>/g, '').replace(/\s/g, '');
      betTypeOrder.push(betType);
      if (i + 2 < tr1Cells.length) {
        const subType = tr1Cells[i + 1].replace(/<[^>]+>/g, '').replace(/\s/g, '');
        if (subType === '複') {
          const dd = tr1Cells[i + 2].match(/<dd>([\s\S]*?)<\/dd>/);
          if (dd) fukuMap[betType] = extractAmount(dd[1]);
        }
      }
      i += 3;
    } else {
      i++;
    }
  }

  const tanOrder = betTypeOrder.filter((b) => b !== 'ワイド');
  const tr2Cells = trs[1].match(/<td[\s\S]*?<\/td>/g) || [];
  const tanMap = {};
  let tanIdx = 0;
  let j = 0;
  while (j < tr2Cells.length && tanIdx < tanOrder.length) {
    const text = tr2Cells[j].replace(/<[^>]+>/g, '').replace(/\s/g, '');
    if (text === '単') {
      if (j + 1 < tr2Cells.length) {
        const dd = tr2Cells[j + 1].match(/<dd>([\s\S]*?)<\/dd>/);
        if (dd) tanMap[tanOrder[tanIdx]] = extractAmount(dd[1]);
        tanIdx++;
        j += 2;
      } else {
        j++;
      }
    } else {
      j++;
    }
  }

  result.sanrentan = tanMap['3連勝'] !== undefined ? tanMap['3連勝'] : null;
  result.sanrenpuku = fukuMap['3連勝'] !== undefined ? fukuMap['3連勝'] : null;
  result.nisyatan = tanMap['2車連'] !== undefined ? tanMap['2車連'] : null;
  return result;
}

// 着順・決まり手・払戻・発走予定時刻。着順が3着まで揃わなければ finish=null（未確定）。
export function parseResultPage(html) {
  const out = { finish: null, kimarite: null, payouts: null, startTime: null };
  const st = html.match(/<dt class="start">発走予定<\/dt>\s*<dd>\s*(\d{1,2}):(\d{2})\s*<\/dd>/);
  if (st) out.startTime = `${st[1].padStart(2, '0')}:${st[2]}`;

  const tenhouIdx = html.indexOf('天候');
  if (tenhouIdx === -1) return out;
  const tableMatch = html.substring(tenhouIdx).match(/<table[\s\S]*?<\/table>/);
  if (!tableMatch) return out;
  const rows = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/g) || [];
  const chakujunMap = {};
  let kimarite = null;
  for (const row of rows) {
    const cells = row.match(/<td[\s\S]*?<\/td>/g) || [];
    if (cells.length < 7) continue;
    const order = stripTags(cells[1]);
    const carNum = stripTags(cells[2]);
    const kima = stripTags(cells[6]);
    const orderNum = parseInt(order, 10);
    if (orderNum >= 1 && orderNum <= 3 && /^\d+$/.test(carNum)) {
      chakujunMap[orderNum] = parseInt(carNum, 10);
      if (orderNum === 1 && kima) kimarite = kima;
    }
  }
  if (!chakujunMap[1] || !chakujunMap[2] || !chakujunMap[3]) return out;
  out.finish = [chakujunMap[1], chakujunMap[2], chakujunMap[3]];
  out.kimarite = kimarite;
  const p = parseRefundTable(html);
  out.payouts = { nisyatan: p.nisyatan, sanrentan: p.sanrentan };
  return out;
}

export async function fetchResult(raceId) {
  const slug = SLUG_BY_CODE[raceId.slice(0, 2)];
  const url = `https://keirin.kdreams.jp/${slug}/racedetail/${raceId}/?pageType=result`;
  const res = await politeFetch(url, { headers: { Accept: 'text/html', 'Accept-Language': 'ja-JP' } });
  if (!res.ok) return { finish: null, kimarite: null, payouts: null, startTime: null, httpStatus: res.status };
  return parseResultPage(await res.text());
}

// ---------- 風（Open-Meteo historical-forecast） ----------

const windCache = new Map();

export async function fetchWind(bankName, compactDate, startTime) {
  const latlng = VENUE_LATLNG[bankName];
  if (latlng === null) return { speed: 0, direction: 'none', source: 'no_latlng' };
  if (!latlng || !startTime) return null;
  const key = bankName + '|' + compactDate;
  let hourly = windCache.get(key);
  if (!hourly) {
    const d = dash(compactDate);
    const url =
      `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${latlng[0]}&longitude=${latlng[1]}` +
      `&hourly=wind_speed_10m,wind_direction_10m&timezone=Asia%2FTokyo&start_date=${d}&end_date=${d}`;
    let json;
    try {
      const res = await politeFetch(url);
      if (!res.ok) return null;
      json = await res.json();
    } catch (err) {
      if (err instanceof HttpAbort) throw err;
      return null; // 風が取れないレースは wind_unavailable として記録する（レース自体は落とさない）
    }
    if (!json.hourly || !Array.isArray(json.hourly.time)) return null;
    hourly = json.hourly;
    windCache.set(key, hourly);
  }
  const target = `${dash(compactDate)}T${startTime.slice(0, 2)}:00`;
  const idx = hourly.time.indexOf(target);
  if (idx < 0) return null;
  const kmh = hourly.wind_speed_10m[idx];
  const deg = hourly.wind_direction_10m[idx];
  if (typeof kmh !== 'number' || typeof deg !== 'number') return null;
  const speed = kmhToMs(kmh);
  return { speed, direction: speed < 1.0 ? 'none' : degToDirection(deg), source: 'open-meteo', hour: target };
}

// ---------- 脚質の決定（利用者の運用ルール） ----------
// (1) 直近4か月の決まり手回数で決める: 逃→逃、捲→自、差とマークの多い方→追。単独最多なら採用（scraper.js resolveStyle と同じ）。
// (2) 全部0回 → (3)と同じ位置規則で決める（候補の制限なし）。並びに居ない等で決まらなければ style_undetermined。
// (3) 最多が同数 → 並び予想の位置で決める（同数の候補に含まれる場合のみ採用）:
//     ライン2番手以降→追／ライン先頭→前の方のラインなら逃・後ろの方なら自／単騎→前の方なら追・後ろの方なら自。
// (4) それでも決まらない → style_ambiguous で skipped。
// 前/後ろの境目（ライン順位 r=0始まり, ライン数 L）。過去の利用者入力との一致で選んだ案を STYLE_BOUNDARY に置く。
export const BOUNDARIES = {
  half_floor: (r, L) => r < Math.floor(L / 2), // 前半（奇数の真ん中は後ろ）
  half_ceil: (r, L) => r < Math.ceil(L / 2),   // 前半（奇数の真ん中は前）
  first_only: (r) => r === 0,                  // 先頭ラインだけ前
  all_but_last: (r, L) => r < L - 1,           // 最後のラインだけ後ろ
};
export const STYLE_BOUNDARY = 'first_only'; // ゲートC 60件の同数29人で一致が最多（14/21）。標本が小さいので要再評価

// 出走表HTMLから 車番→{逃,捲,差,マ}（scraper.js と同じ表・同じ列: td[12..15]+indexOffset）
export function parseKimarite(html) {
  const $ = cheerio.load(html);
  const map = {};
  let raceTable = null;
  $('table').each((i, table) => {
    const thText = $(table).find('th').first().text();
    if (thText.includes('予想') && !thText.includes('周回')) { raceTable = table; return false; }
  });
  if (!raceTable) return map;
  $(raceTable).find('tbody tr').each((i, el) => {
    if ($(el).text().includes('誘導員')) return;
    const tds = $(el).find('td');
    if (tds.length === 0) return;
    const off = tds.length <= 22 ? -1 : 0;
    let number = null;
    const n = parseInt($(tds[4 + off]).text().trim(), 10);
    if (!isNaN(n) && n > 0 && n < 10) number = n;
    if (number === null) {
      tds.each((j, td) => { const t = $(td).text().trim(); if (/^[1-9]$/.test(t)) { number = parseInt(t, 10); return false; } });
    }
    if (number === null) return;
    const v = (k) => parseInt($(tds[k + off]).text().trim(), 10) || 0;
    map[number] = { 逃: v(12), 捲: v(13), 差: v(14), マ: v(15) };
  });
  return map;
}

// pos: { lineIdx, idxInLine, lineSize, numLines } または null
export function decideStyle(k, pos, boundary = STYLE_BOUNDARY) {
  if (!k) return { style: null, how: 'no_counts' };
  const g = { 逃: k.逃 || 0, 自: k.捲 || 0, 追: Math.max(k.差 || 0, k.マ || 0) };
  const max = Math.max(g.逃, g.自, g.追);
  const tied = Object.keys(g).filter((x) => g[x] === max);
  if (max > 0 && tied.length === 1) return { style: tied[0], how: 'counts' };
  if (!pos) return { style: null, how: max === 0 ? 'all_zero' : 'ambiguous', tied };
  const front = BOUNDARIES[boundary](pos.lineIdx, pos.numLines);
  let want;
  if (pos.lineSize >= 2 && pos.idxInLine >= 1) want = '追';
  else if (pos.lineSize >= 2) want = front ? '逃' : '自';
  else want = front ? '追' : '自';
  if (max === 0) return { style: want, how: 'position', tied: [] }; // 全0は候補が無いので位置の結果をそのまま採用
  if (tied.includes(want)) return { style: want, how: 'position', tied };
  return { style: null, how: 'ambiguous', tied, want };
}

export function linePositions(lines) {
  const pos = {};
  lines.forEach((line, li) => line.forEach((car, i) => {
    pos[car] = { lineIdx: li, idxInLine: i, lineSize: line.length, numLines: lines.length };
  }));
  return pos;
}

// ---------- WINTICKET の予想印（W印の自動入力） ----------
// 利用者は手入力時代、WINTICKET の予想印を見て W印を付けていた。レースページ埋め込みの
// window.__PRELOADED_STATE__ から 車番→predictionMark（数字）だけを取り出す（コメント等は読まない・残さない）。
// URL は kdreams の raceId から組み立てる: cupId = 開催初日YYYYMMDD + 場コード、日目、R（場コードは両サイト共通）。
const WT_SLUG_OVERRIDE = { '13': 'iwakidaira' }; // WINTICKET 側の slug が kdreams と違う場
// 予想印の数字 → W印。ゲートCの実データ（利用者の過去入力との混同行列）で決めた対応。
export const WM_MAP = { 1: '◎', 2: '〇', 3: '△', 4: '✕' };

export function extractPreloadedState(html) {
  const i = html.indexOf('__PRELOADED_STATE__');
  if (i < 0) return null;
  const start = html.indexOf('{', i);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, j + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

export function winticketUrl(raceId) {
  const code = raceId.slice(0, 2);
  const slug = WT_SLUG_OVERRIDE[code] || SLUG_BY_CODE[code];
  return `https://www.winticket.jp/keirin/${slug}/racecard/${raceId.slice(2, 10)}${code}/${parseInt(raceId.slice(10, 12), 10)}/${parseInt(raceId.slice(-2), 10)}`;
}

// 戻り値: { 車番: 印の数字 } または null（取れない・印が無い）
export async function fetchWinticketMarks(raceId) {
  const res = await politeFetch(winticketUrl(raceId), { headers: { Accept: 'text/html', 'Accept-Language': 'ja-JP' } });
  if (!res.ok) return null;
  const st = extractPreloadedState(await res.text());
  const qs = st && st.tanStackQuery && Array.isArray(st.tanStackQuery.queries) ? st.tanStackQuery.queries : [];
  const q = qs.find((x) => Array.isArray(x.queryKey) && x.queryKey[0] === 'keirin/race/common');
  const d = q && q.state && q.state.data;
  if (!d || !Array.isArray(d.entries) || !Array.isArray(d.records)) return null;
  const byPlayer = new Map(d.records.map((r) => [r.playerId, r.predictionMark]));
  const out = {};
  let any = false;
  for (const e of d.entries) {
    if (e.absent) continue;
    const m = byPlayer.get(e.playerId);
    out[e.number] = typeof m === 'number' ? m : null;
    if (typeof m === 'number' && m > 0) any = true;
  }
  return any ? out : null;
}

// ---------- scrapeRace → エンジン入力（paste-input.js applyRaceData と同一規則） ----------

export function buildFixture(data, raceId, compactDate) {
  const raceType = SERIES_MAP[data.series] || null;
  const bankName = BANK_NAME_MAP[data.venue] || null;
  if (!raceType) return { skip: 'unknown_series' };
  if (!bankName) return { skip: 'unsupported_bank' };

  const activeRiders = data.riders.filter((r) => !r.isScratched);
  if (activeRiders.length === 0) return { skip: 'no_riders' };
  if (activeRiders.length > 7) return { skip: 'nine_cars' };

  const venuePref = VENUE_PREF_MAP[data.venue] || null;
  const activeNos = new Set(activeRiders.map((r) => r.number));
  const warnings = [];
  const players = [];

  if (!(data.lineup && data.lineup.source === 'official' && Array.isArray(data.lineup.lines))) {
    return { skip: 'no_lineup' };
  }
  const lines = data.lineup.lines.map((l) => l.filter((no) => activeNos.has(no))).filter((l) => l.length > 0);
  if (lines.length === 0) return { skip: 'no_lineup' };
  const positions = linePositions(lines);
  const kimarite = data.kimarite || {};
  const styleSkips = [];
  let sBestNo = null, sBestVal = -Infinity, sTie = false;
  let bBestNo = null, bBestVal = -Infinity, bTie = false;

  for (const rider of data.riders) {
    if (rider.isScratched) continue;
    if (rider.score === null) return { skip: 'no_score' };
    const ds = decideStyle(kimarite[rider.number], positions[rider.number] || null);
    if (!ds.style) {
      styleSkips.push({ car: rider.number, how: ds.how });
      continue;
    }
    const style = ds.style;
    if (ds.how === 'position') warnings.push(`style_by_position:${rider.number}`);
    let recent;
    if (rider.recent3 !== null && rider.recent3 !== undefined) {
      recent = String(rider.recent3).replace(/[^0-9]/g, '9');
    } else {
      recent = '';
      warnings.push(`recent_missing:${rider.number}`);
    }
    // InputGuard(getRecent) と同一の正規化（不足は9で補填、先頭3桁）
    while (recent.length < 3) recent += '9';
    recent = recent.slice(0, 3);

    const isLocal = !!(venuePref && rider.pref && (rider.pref.includes(venuePref) || venuePref.includes(rider.pref)));

    if (typeof rider.sCount === 'number') {
      if (rider.sCount > sBestVal) { sBestVal = rider.sCount; sBestNo = rider.number; sTie = false; }
      else if (rider.sCount === sBestVal) sTie = true;
    }
    if (typeof rider.bCount === 'number') {
      if (rider.bCount > bBestVal) { bBestVal = rider.bCount; bBestNo = rider.number; bTie = false; }
      else if (rider.bCount === bBestVal) bTie = true;
    }

    players.push({
      id: rider.number,
      name: '',
      isScratch: false,
      score: Math.min(130, Math.max(0, rider.score)),
      recent,
      style,
      wmark: '無', // 既定は「無」。WINTICKET の予想印が取れたら crawlRace で上書きする
      isLocal,
      isGoldCap: false,
      // 以下はエンジン入力ではなく記録用
      _meta: { sCount: rider.sCount, bCount: rider.bCount, age: rider.age, term: rider.term, grade: rider.grade, recent3: rider.recent3 },
    });
  }
  if (styleSkips.length > 0) {
    // 全0が1人でもいれば style_undetermined、それ以外は style_ambiguous
    const reason = styleSkips.some((x) => x.how === 'all_zero' || x.how === 'no_counts') ? 'style_undetermined' : 'style_ambiguous';
    return { skip: reason, styleSkips };
  }
  if (sTie) warnings.push('s1_tie');
  if (bTie) warnings.push('b1_tie');

  const lineInput = lines.map((l) => l.join('')).join(',');

  return {
    fixture: {
      race_id: raceId,
      date: dash(compactDate),
      bankName,
      raceType,
      lines,
      lineInput,
      players,
      radio: { s1Id: sBestNo, b1Id: bBestNo },
      wind: { speed: 0, direction: 'none' },
    },
    warnings,
  };
}

// ---------- エンジン実行 → ラベル・買い目・ティア（decision_panel.js computeDecisionData と同一手順） ----------

function firstUlItems(html, label) {
  const idx = (html || '').indexOf(label);
  if (idx < 0) return null;
  const m = html.slice(idx).match(/<ul>(.*?)<\/ul>/s);
  if (!m) return null;
  return [...m[1].matchAll(/<li>(.*?)<\/li>/g)].map((x) => x[1]);
}

export async function loadOldjzirt(dir) {
  const harness = await import(pathToFileURL(path.join(dir, 'replay', 'harness.mjs')).href);
  const DecisionCore = require(path.join(dir, 'decision_core.js'));
  const enginePath = path.join(dir, 'keirin_logic.js');
  const engine = harness.createEngine(enginePath, path.join(dir, 'bankdata.json'));
  const vm = readFileSync(enginePath, 'utf8').match(/LOGIC_VERSION\s*=\s*'([^']+)'/);
  let commit = null;
  try {
    commit = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { commit = null; }
  return { engine, DecisionCore, engineVersion: vm ? vm[1] : null, commit };
}

export async function predict(oj, fixture) {
  const engineFixture = { ...fixture, players: fixture.players.map(({ _meta, ...p }) => p) };
  const { seitenHtml, koutenHtml, snapshot } = await oj.engine.runRace(engineFixture);
  const snap = snapshot || {};
  const base = (snap.scores && snap.scores.base) || [];
  const seitenScores = (snap.scores && snap.scores.final && snap.scores.final.seiten) || {};
  const lines = snap.lines || [];
  if (base.length === 0 || Object.keys(seitenScores).length === 0) return { error: 'engine_no_output' };

  const items = firstUlItems(seitenHtml, '三連複');
  const top3CarIds = items && items[0] ? items[0].split('=').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n)) : [];
  const tm = (koutenHtml || '').match(/特異点[:：]\s*([0-9]+)/);
  const lCarId = tm ? parseInt(tm[1], 10) : null;

  const DC = oj.DecisionCore;
  const labelToCar = DC.deriveLabels({
    activePlayerIds: base.map((p) => p.id),
    seitenScores,
    top3CarIds,
    lCarId,
  });
  const tickets = DC.buildTickets(labelToCar, lines);
  const o1Tail = typeof DC.isTailOfThreeCarLine === 'function' ? DC.isTailOfThreeCarLine(lines, labelToCar.o1) : null;

  const windSpeed = fixture.wind.speed || 0;
  const beta = snap.bank && snap.bank.beta ? snap.bank.beta : 1.0;
  const effWindSpeed = windSpeed * beta;
  const s1Player = base.find((p) => p.id === labelToCar.s1);
  const lLine = lines.find((line) => line.indexOf(labelToCar.L) !== -1);
  const lIsSingle = labelToCar.L === null ? true : lLine ? lLine.length === 1 : true;
  const numLines = lines.filter((line) => line.length > 0).length;
  const tierResult = DC.judgeTier({
    s1Style: s1Player ? s1Player.style : null,
    lIsSingle,
    grade: fixture.raceType,
    numLines,
    windSpeed: effWindSpeed,
  });
  const prob = DC.computeProbabilities(seitenScores, fixture.raceType, tickets);
  const ranked = Object.keys(seitenScores).map(Number).sort((a, b) => seitenScores[String(b)] - seitenScores[String(a)]);

  return {
    labelToCar,
    tickets: tickets.map((t) => ({ type: t.type, cars: t.cars })),
    tier: tierResult.letter,
    tier_detail: tierResult.tier,
    prob_total: Math.round(prob.totalProb * 1e6) / 1e6,
    ranked,
    eff_speed: Math.round(effWindSpeed * 1000) / 1000,
    num_lines: numLines,
    o1_tail: o1Tail,
  };
}

// ---------- 精算 ----------

export function settle(rec) {
  const settled = Array.isArray(rec.finish) && rec.payouts && rec.payouts.sanrentan != null && rec.payouts.nisyatan != null;
  if (!settled || !Array.isArray(rec.tickets)) {
    return { hit_bets: null, stake: null, payout: null, recovery: null };
  }
  const f = rec.finish;
  const hits = [];
  let payout = 0;
  for (const t of rec.tickets) {
    if (t.type === 'sanrentan' && t.cars[0] === f[0] && t.cars[1] === f[1] && t.cars[2] === f[2]) {
      hits.push(t.cars.join('-'));
      payout += rec.payouts.sanrentan;
    } else if (t.type === 'nisyatan' && t.cars[0] === f[0] && t.cars[1] === f[1]) {
      hits.push(t.cars.join('-'));
      payout += rec.payouts.nisyatan;
    }
  }
  const stake = rec.tickets.length * STAKE_PER_POINT;
  return { hit_bets: hits, stake, payout, recovery: stake > 0 ? Math.round((payout / stake) * 10000) / 10000 : null };
}

// ---------- 1レース分のレコード ----------

export async function crawlRace(oj, raceId, compactDate, meetingSeries, opts = {}) {
  const venue = SLUG_BY_CODE[raceId.slice(0, 2)] || null;
  const base = {
    schema: 1,
    date: dash(compactDate),
    venue,
    venue_name: null,
    race: parseInt(raceId.slice(-2), 10),
    race_id: raceId,
    meeting_series: meetingSeries || null,
    engine_version: oj.engineVersion,
    oldjzirt_commit: oj.commit,
  };
  const data = await scrapeRace(raceId);
  if (!data || !Array.isArray(data.riders) || data.riders.length === 0) {
    return { rec: { ...base, skipped: 'racecard_unavailable', crawled_at: new Date().toISOString() }, scraped: false };
  }
  base.venue_name = data.venue || null;
  const slugForCard = SLUG_BY_CODE[raceId.slice(0, 2)];
  const cardHtml = racecardHtml.get(`https://keirin.kdreams.jp/${slugForCard}/racedetail/${raceId}/`);
  racecardHtml.clear();
  data.kimarite = cardHtml ? parseKimarite(cardHtml) : {};
  const built = buildFixture(data, raceId, compactDate);
  const result = await fetchResult(raceId);

  if (built.skip) {
    return {
      rec: {
        ...base, grade: SERIES_MAP[data.series] || null, skipped: built.skip,
        ...(built.styleSkips ? { style_skips: built.styleSkips } : {}),
        finish: result.finish, crawled_at: new Date().toISOString(),
      },
      scraped: true,
      data,
    };
  }
  const fx = built.fixture;
  let wmRaw = null;
  try {
    wmRaw = await fetchWinticketMarks(raceId);
  } catch (err) {
    if (err instanceof HttpAbort) throw err;
    wmRaw = null;
  }
  if (wmRaw) {
    for (const p of fx.players) p.wmark = WM_MAP[wmRaw[p.id]] || '無';
  } else {
    built.warnings.push('wmark_unavailable');
  }
  let wind;
  if (opts.windOverride) wind = opts.windOverride;
  else wind = await fetchWind(fx.bankName, compactDate, result.startTime);
  const warnings = [...built.warnings];
  if (!wind) {
    wind = { speed: 0, direction: 'none' };
    warnings.push('wind_unavailable');
  }
  fx.wind = { speed: wind.speed, direction: wind.direction };

  const pred = await predict(oj, fx);
  if (pred.error) {
    return { rec: { ...base, grade: fx.raceType, skipped: pred.error, finish: result.finish, crawled_at: new Date().toISOString() }, scraped: true, fixture: fx };
  }

  const rec = {
    ...base,
    grade: fx.raceType,
    start_time: result.startTime,
    wind: { speed: fx.wind.speed, direction: fx.wind.direction, eff_speed: pred.eff_speed },
    num_lines: pred.num_lines,
    lines: fx.lines,
    players: fx.players.map((p) => ({
      car: p.id,
      score: p.score,
      style: p.style,
      wmark: p.wmark,
      recent3: p.recent,
      sCount: p._meta.sCount,
      bCount: p._meta.bCount,
      age: p._meta.age,
      term: p._meta.term,
      grade: p._meta.grade,
    })),
    wm_raw: wmRaw,
    s1_id: fx.radio.s1Id,
    b1_id: fx.radio.b1Id,
    labelToCar: pred.labelToCar,
    ranked: pred.ranked,
    tickets: pred.tickets,
    tier: pred.tier,
    tier_detail: pred.tier_detail,
    prob_total: pred.prob_total,
    input_warnings: warnings,
    finish: result.finish,
    kimarite: result.kimarite,
    payouts: result.payouts,
    o1_tail: pred.o1_tail,
  };
  Object.assign(rec, settle(rec), { crawled_at: new Date().toISOString() });
  return { rec, scraped: true, fixture: fx, data };
}

// ---------- 台帳 I/O ----------

function keyOf(r) {
  return `${r.date}|${r.venue}|${r.race}`;
}

function loadMonth(dir, month) {
  const fp = path.join(dir, month + '.jsonl');
  const rows = [];
  if (!existsSync(fp)) return rows;
  for (const line of readFileSync(fp, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { rows.push(JSON.parse(t)); } catch { /* 壊れた行は捨てずに残せないため無視 */ }
  }
  return rows;
}

function saveMonth(dir, month, rows) {
  rows.sort((a, b) => (a.date + a.venue + String(a.race).padStart(2, '0')).localeCompare(b.date + b.venue + String(b.race).padStart(2, '0')));
  writeFileSync(path.join(dir, month + '.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}

function earliestLedgerDate(dir) {
  if (!existsSync(dir)) return null;
  let min = null;
  for (const fn of readdirSync(dir).filter((f) => /^\d{6}\.jsonl$/.test(f)).sort()) {
    for (const r of loadMonth(dir, fn.slice(0, 6))) {
      const c = typeof r.date === 'string' ? r.date.replace(/-/g, '') : null;
      if (c && (!min || c < min)) min = c;
    }
    if (min) return min;
  }
  return min;
}

// ---------- メイン ----------

function parseArgs(argv) {
  const a = { date: null, outDir: 'data/shadow', oldjzirtDir: './oldjzirt', dry: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--date') a.date = argv[++i];
    else if (k === '--out-dir') a.outDir = argv[++i];
    else if (k === '--oldjzirt-dir') a.oldjzirtDir = argv[++i];
    else if (k === '--dry') a.dry = true;
    else throw new Error('未知の引数: ' + k);
  }
  if (a.date && !/^\d{8}$/.test(a.date)) throw new Error('--date は YYYYMMDD');
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args.date || defaultTargetDate();
  const outDir = path.resolve(args.outDir);
  const oj = await loadOldjzirt(path.resolve(args.oldjzirtDir));
  // 書き込みは全取得が終わってから（途中中断時は何も書かない）
  const months = new Map();
  const getMonth = (m) => { if (!months.has(m)) months.set(m, loadMonth(outDir, m)); return months.get(m); };
  const upsert = (rec) => {
    const m = rec.date.replace(/-/g, '').slice(0, 6);
    const rows = getMonth(m);
    const i = rows.findIndex((r) => keyOf(r) === keyOf(rec));
    if (i >= 0) rows[i] = rec; else rows.push(rec);
  };
  // 取り直す価値のある skipped（一時的な取得失敗）。それ以外の skipped（9車・並びなし等）は確定扱い。
  const RETRY_SKIPS = new Set(['racecard_unavailable', 'engine_no_output']);

  // 直近3日（未確定行の補完と、前夜の失敗等で欠けたレースの回収）→ 対象日 の順に同じ処理をかける。
  // 確定済みの行はHTTPを出さずに飛ばし、未確定の行は結果ページだけ取り直す。
  // 台帳より前の日付には遡らない（初回実行時は対象日のみ。稼働前のデータを台帳に入れないため）。
  const ledgerStart = earliestLedgerDate(outDir);
  const dates = [];
  for (let d = RESCAN_DAYS; d >= 1; d--) {
    const c = addDays(target, -d);
    if (ledgerStart && c >= ledgerStart) dates.push(c);
  }
  dates.push(target);
  const allStats = [];

  for (const c of dates) {
    const st = { date: c, races_listed: 0, scraped: 0, new_rows: 0, refilled: 0, still_pending: 0, already_settled: 0, skipped: {}, tier: {} };
    allStats.push(st);
    const kaisai = await getKaisai(c);
    const existing = new Map(getMonth(c.slice(0, 6)).filter((r) => r.date === dash(c)).map((r) => [keyOf(r), r]));
    for (const v of kaisai.venues || []) {
      for (const day of v.days || []) {
        for (const race of day.races || []) {
          if (raceDateOf(race.raceId) !== c) continue;
          st.races_listed++;
          const k = `${dash(c)}|${SLUG_BY_CODE[race.raceId.slice(0, 2)]}|${parseInt(race.raceId.slice(-2), 10)}`;
          const prev = existing.get(k);
          if (prev && prev.skipped && !RETRY_SKIPS.has(prev.skipped)) {
            st.scraped++;
            st.skipped[prev.skipped] = (st.skipped[prev.skipped] || 0) + 1;
            continue;
          }
          if (prev && !prev.skipped) {
            st.scraped++;
            st.tier[prev.tier] = (st.tier[prev.tier] || 0) + 1;
            if (prev.stake !== null) { st.already_settled++; continue; }
            const res = await fetchResult(race.raceId);
            if (res.finish) {
              const rec = { ...prev, finish: res.finish, kimarite: res.kimarite, payouts: res.payouts };
              Object.assign(rec, settle(rec), { crawled_at: new Date().toISOString() });
              upsert(rec);
              if (rec.stake !== null) st.refilled++; else st.still_pending++;
            } else st.still_pending++;
            continue;
          }
          const { rec, scraped } = await crawlRace(oj, race.raceId, c, v.grade);
          if (scraped) st.scraped++;
          upsert(rec);
          st.new_rows++;
          if (rec.skipped) st.skipped[rec.skipped] = (st.skipped[rec.skipped] || 0) + 1;
          else {
            st.tier[rec.tier] = (st.tier[rec.tier] || 0) + 1;
            if (rec.stake === null) st.still_pending++;
          }
        }
      }
    }
    console.log('shadow_crawl:', JSON.stringify(st));
  }

  console.log('HTTPリクエスト数:', requestCount);
  const t = allStats[allStats.length - 1];
  if (t.races_listed > 0 && t.scraped === 0) {
    console.error('失敗: 開催があるのに1レースも取得できませんでした。何も書きません。');
    process.exit(2);
  }
  if (args.dry) {
    console.log('--dry: 書き込みなし');
    return;
  }
  mkdirSync(outDir, { recursive: true });
  for (const [m, rows] of months) {
    if (rows.length === 0 && !existsSync(path.join(outDir, m + '.jsonl'))) continue;
    saveMonth(outDir, m, rows);
  }
  console.log('出力先:', outDir);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof HttpAbort ? '中断（相手側の拒否・障害）: ' + err.message : '致命的エラー:', err instanceof HttpAbort ? '' : err);
    console.error('部分結果は書いていません。');
    process.exit(1);
  });
}
