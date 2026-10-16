# oldjzirt_log — 真・自在律 シャドー台帳

競輪予想ツール oldjzirt（Jiz41/oldjzirt）の予想を、毎晩 GitHub Actions で全レース自動取得→再現計算→結果で精算し、JSONL に蓄積する台帳です。成績は `index.html`（GitHub Pages）で閲覧します。

## 構成

| パス | 役割 |
|---|---|
| `scripts/shadow_crawl.mjs` | 収集器。開催一覧→出走表→エンジン実行→判定・買い目→結果ページ→精算→JSONL |
| `scripts/vendor/kaisai.js`, `scripts/vendor/scraper.js` | keirin-proxy からの複製（改変なし。出典・複製日は各ファイル先頭） |
| `.github/workflows/shadow-crawl.yml` | 毎日 JST 23:50 に実行し、`shadow-data` ブランチへ追記 |
| `index.html` | 成績ページ。`shadow-data` の JSONL を raw.githubusercontent.com から読む |

エンジン（`keirin_logic.js`）・`decision_core.js`・`replay/harness.mjs`・`bankdata.json` は複製せず、実行時に Jiz41/oldjzirt を checkout して使います。

## 台帳の規律

- 台帳は**稼働日の翌日以降の初見データ専用**です。過去の探索データ（oldjzirt の `replay/` 配下）は台帳に入れません。
- 稼働日は `index.html` の `LIVE_FROM` 定数1か所で管理します（空のあいだは「稼働前」表示）。
- 同じ日付・場・レースの行は置換され、重複しません。結果未確定のレースは `finish:null` で書き、翌日以降の実行（直近3日を再走査）で埋めます。
- 書き込み先は `data/shadow/YYYYMM.jsonl`（出走日の月）。

## 脚質の決め方

直近4か月の決まり手回数で単独最多の脚質（逃→逃、捲→自、差・マの多い方→追）。全部0回の選手がいるレースは `style_undetermined`、最多が同数なら並び予想の位置で決め（番手以降→追、ライン先頭→前なら逃・後ろなら自、単騎→前なら追・後ろなら自。前後の境目は `STYLE_BOUNDARY`）、それでも決まらなければ `style_ambiguous` として予想を出さずに記録します。

## 載せない項目（公開リポジトリのため）

選手名・府県・コメント本文・予想紙名や印の文言・短評は出力しません。`wmark` はエンジン入力の印記号1文字のみ（自動取得では常に「無」）。

## 実行時刻と対象日

- schedule は JST 23:50。Actions の schedule は数十分遅れることがあり、日付が変わると「今日」がずれるため、`--date` 未指定時の対象日は「JST の(現在−2時間)の日付」です（23:50起動でも翌0:20起動でも同じ日を指す）。
- 1回の実行で、対象日の全レース＋直近3日の未確定行の補完を行います。

## 手動実行

GitHub の Actions タブ → `shadow-crawl` → `Run workflow`。`date` に `YYYYMMDD` を入れるとその日を対象にします（空なら上記の既定日）。

ローカル実行:

```
npm ci
node scripts/shadow_crawl.mjs --date 20261015 --out-dir /path/to/tmp --oldjzirt-dir /path/to/oldjzirt --dry
```

## 礼儀

全HTTPは3秒間隔の直列。403/429、または5xxの連続で即中断し、部分結果は書きません。開催があるのに1レースも取れなかった日も失敗扱いです。
