#!/usr/bin/env node
// 既存の台帳レコードに ticket_probs（買い目ごとの的中確率）と odds（確定オッズ）だけを後から足す。
// 新しく足してよいのは ticket_probs, odds, backfill_status の3つのみ。既存フィールドは上書きしない。
//
// 処理手順（1レコードごと）:
//  a. すでに ticket_probs と odds がある行は何もしない。
//  b. レコードの players / lines / grade / wind / s1_id / b1_id / venue_name から predict() 用 fixture を再構成する。
//  c. isLocal は、そのレースの出走表ページ（scrapeRace 経由）から選手の pref を取って
//     buildFixture の isLocal 判定式をそのまま使って決める。
//  d. predict(oj, fixture) を実行し、labelToCar が保存済みと完全一致なら ticket_probs を書く。
//     不一致なら ticket_probs は書かず backfill_status: "label_mismatch" を足す。
//  e. 結果ページを取得して odds を書く。取得失敗は odds を書かず backfill_status: "odds_fetch_failed"。
//  f. 書き込みは全件処理が終わってから（途中中断時は何も書かない）。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// shadow_crawl.mjs を先に import することで、require('node-fetch') の politeFetch への
// 差し替えと、vendor/kaisai.js・vendor/scraper.js のロード（politeFetch を使った状態）が完了する。
import {
  loadOldjzirt,
  predict,
  fetchResult,
  buildOdds,
  VENUE_PREF_MAP,
  BANK_NAME_MAP,
} from './shadow_crawl.mjs';

const require = createRequire(import.meta.url);
// 上記 import で既に require.cache に載っている（politeFetch 差し替え済みの）同一インスタンスを取る。
// 追加のHTTPリクエストやfetch経路の新設は行わない。
const { scrapeRace } = require('./vendor/scraper.js');

function parseArgs(argv) {
  const a = { from: null, to: null, dataDir: null, oldjzirtDir: '/root/oldjzirt', dry: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--from') a.from = argv[++i];
    else if (k === '--to') a.to = argv[++i];
    else if (k === '--data-dir') a.dataDir = argv[++i];
    else if (k === '--oldjzirt-dir') a.oldjzirtDir = argv[++i];
    else if (k === '--dry-run') a.dry = true;
    else throw new Error('未知の引数: ' + k);
  }
  if (!a.from || !a.to) throw new Error('--from と --to は必須（YYYY-MM-DD）');
  if (!a.dataDir) throw new Error('--data-dir は必須（台帳jsonl置き場）');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.from) || !/^\d{4}-\d{2}-\d{2}$/.test(a.to)) {
    throw new Error('--from / --to は YYYY-MM-DD 形式');
  }
  return a;
}

function loadMonthFile(fp) {
  if (!existsSync(fp)) return [];
  const rows = [];
  for (const line of readFileSync(fp, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    rows.push(JSON.parse(t));
  }
  return rows;
}

function saveMonthFile(fp, rows) {
  writeFileSync(fp, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}

// レコードの players/lines/grade/wind/s1_id/b1_id/venue_name から predict() 用 fixture を再構成する
// （rebuild.mjs の実績ある書き方と同一。wmark も保存値をそのまま使う）。isLocal だけは呼び出し側で埋める。
function rebuildFixture(rec, isLocalByCar) {
  const players = rec.players.map((p) => ({
    id: p.car,
    name: '',
    isScratch: false,
    score: p.score,
    recent: String(p.recent3 || ''),
    style: p.style,
    wmark: p.wmark,
    isLocal: !!isLocalByCar[p.car],
    isGoldCap: false,
  }));
  return {
    race_id: rec.race_id,
    date: rec.date,
    bankName: BANK_NAME_MAP[rec.venue_name] || rec.venue_name,
    raceType: rec.grade,
    lines: rec.lines,
    lineInput: rec.lines.map((l) => l.join('')).join(','),
    players,
    radio: { s1Id: rec.s1_id, b1Id: rec.b1_id },
    wind: { speed: rec.wind.speed, direction: rec.wind.direction },
  };
}

// buildFixture(shadow_crawl.mjs:586〜) の isLocal 判定式と同一。
function isLocalCar(venuePref, riderPref) {
  return !!(venuePref && riderPref && (riderPref.includes(venuePref) || venuePref.includes(riderPref)));
}

async function backfillOne(oj, rec) {
  if (rec.ticket_probs && rec.odds) return { rec, status: 'already_done' };
  if (rec.skipped || !Array.isArray(rec.tickets) || !rec.labelToCar) {
    return { rec, status: 'not_applicable' }; // skipped行・買い目無し行は対象外（既存仕様どおり）
  }

  // c. 出走表ページから pref を取り、isLocal を決める。
  let isLocalByCar = {};
  let venuePref = VENUE_PREF_MAP[rec.venue_name] || null;
  try {
    const data = await scrapeRace(rec.race_id);
    for (const rider of data.riders || []) {
      if (rider.isScratched) continue;
      isLocalByCar[rider.number] = isLocalCar(venuePref, rider.pref);
    }
  } catch (err) {
    return { rec, status: 'racecard_fetch_failed' };
  }

  // b. fixture再構成 → d. predict() → labelToCar一致判定
  const fixture = rebuildFixture(rec, isLocalByCar);
  let pred;
  try {
    pred = await predict(oj, fixture);
  } catch (err) {
    return { rec, status: 'predict_error' };
  }
  if (pred.error) return { rec, status: 'predict_error' };

  const labelMatch = JSON.stringify(pred.labelToCar) === JSON.stringify(rec.labelToCar);
  const next = { ...rec };
  let status = null;
  if (labelMatch) {
    next.ticket_probs = pred.ticket_probs;
  } else {
    status = 'label_mismatch';
  }

  // 保存済み tickets は旧買い目(〜2026-10-19)の行があるため使わず、保存済み labelToCar から現行の新8点を作って
  // odds を引く（ticket_probs と同じ8点・同順になる。成績ページも labelToCar から新8点を作る）。
  const tickets8 = oj.DecisionCore.buildTickets(rec.labelToCar, rec.lines).map((t) => ({ type: t.type, cars: t.cars }));

  // e. 結果ページから odds を取得する。
  try {
    const result = await fetchResult(rec.race_id);
    if (result && result.oddsTables) {
      next.odds = buildOdds(tickets8, result.oddsTables);
    } else {
      status = status || 'odds_fetch_failed';
    }
  } catch (err) {
    status = status || 'odds_fetch_failed';
  }

  if (status) next.backfill_status = status;
  return { rec: next, status: status || 'ok' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const oj = await loadOldjzirt(path.resolve(args.oldjzirtDir));

  const months = new Set();
  for (let d = args.from; d <= args.to; ) {
    months.add(d.slice(0, 7).replace('-', ''));
    const dt = new Date(d + 'T00:00:00Z');
    dt.setUTCDate(dt.getUTCDate() + 1);
    d = dt.toISOString().slice(0, 10);
  }

  const statusCounts = {};
  const pending = []; // { fp, outRows } を全件処理後にまとめて書く（途中中断時は何も書かない）
  for (const month of months) {
    const fp = path.join(path.resolve(args.dataDir), month + '.jsonl');
    if (!existsSync(fp)) {
      console.log('対象ファイル無し:', fp);
      continue;
    }
    const rows = loadMonthFile(fp);
    const outRows = [];
    for (const rec of rows) {
      if (rec.date < args.from || rec.date > args.to) {
        outRows.push(rec);
        continue;
      }
      const { rec: newRec, status } = await backfillOne(oj, rec);
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      outRows.push(newRec);
    }
    pending.push({ fp, outRows });
  }
  console.log('status集計:', JSON.stringify(statusCounts));
  if (args.dry) {
    console.log('--dry-run: 書き込みなし');
    return;
  }
  for (const { fp, outRows } of pending) {
    saveMonthFile(fp, outRows);
    console.log('書き込み完了:', fp);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch((err) => {
    console.error('致命的エラー:', err);
    console.error('部分結果は書いていません。');
    process.exit(1);
  });
}
