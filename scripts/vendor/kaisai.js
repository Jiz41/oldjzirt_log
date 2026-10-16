// 複製元: /root/keirin-proxy/kaisai.js（Jiz41 keirin-proxy）／複製日: 2026-10-16。改変なし。
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// prettier-ignore
const VENUE_MAP = {
  'hakodate': '函館', 'aomori': '青森', 'iwakitaira': 'いわき平',
  'yahiko': '弥彦', 'maebashi': '前橋', 'toride': '取手',
  'utsunomiya': '宇都宮', 'omiya': '大宮', 'seibuen': '西武園',
  'keiokaku': '京王閣', 'tachikawa': '立川', 'matsudo': '松戸',
  'chiba': '千葉', 'kawasaki': '川崎', 'hiratsuka': '平塚',
  'odawara': '小田原', 'ito': '伊東', 'shizuoka': '静岡',
  'nagoya': '名古屋', 'gifu': '岐阜', 'ogaki': '大垣',
  'toyohashi': '豊橋', 'toyama': '富山', 'matsusaka': '松阪',
  'yokkaichi': '四日市', 'fukui': '福井', 'nara': '奈良',
  'mukomachi': '向日町', 'wakayama': '和歌山', 'kishiwada': '岸和田',
  'tamano': '玉野', 'hiroshima': '広島', 'hofu': '防府',
  'takamatsu': '高松', 'kochi': '高知', 'komatsushima': '小松島',
  'matsuyama': '松山', 'kokura': '小倉', 'kurume': '久留米',
  'takeo': '武雄', 'sasebo': '佐世保', 'beppu': '別府', 'kumamoto': '熊本'
};

async function getKaisai(date) {
  const year = date.slice(0, 4);
  const month = date.slice(4, 6);
  const day = date.slice(6, 8);
  const url = `https://keirin.kdreams.jp/kaisai/${year}/${month}/${day}/`;

  await sleep(1000);
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'PoliteKeirinBot/1.0 (on-demand only, no flood; say the word and I vanish; DM: https://x.com/kayoutouidou01)',
      'Accept': 'text/html',
      'Accept-Language': 'ja-JP'
    }
  });
  const body = await response.text();
  const $ = cheerio.load(body);

  const venues = [];

  // ナビリンクから slug→grade マップを作成
  // 例: "取手Ｇ３" → { toride: 'G3' }
  const gradeMap = {};
  $('a[href^="#k"]').each((i, a) => {
    const text = $(a).text().trim();
    const gradeMatch = text.match(/[GＧ][123１２３]|[FＦ][12１２]/);
    if (gradeMatch) {
      const grade = gradeMatch[0]
        .replace(/Ｇ/g, 'G').replace(/Ｆ/g, 'F')
        .replace(/１/g, '1').replace(/２/g, '2').replace(/３/g, '3');
      // テキストから場名を除いた残りがgradeなので、slug取得は venues.push時に使う
      // ここではhref="#k23"などの数字コードは使えないのでテキストベースで保持
      const venueName = text.replace(/[GＧFＦ][123１２３]/g, '').trim();
      gradeMap[venueName] = grade;
    }
  });

  $('.kaisai-list_contents').each((i, el) => {
    const days = [];

    $(el).find('.kaisai-program_table').each((j, table) => {
      // テーブルの直前要素から開催日ラベルを取得
      // テキストが長すぎる場合は、ナビゲーションリンクとみなしフォールバック
      const prevText = $(table).prev().text().trim();
      let label;

      // 「日」を含み、かつ長すぎない (15文字未満) テキストであれば採用
      if (prevText && prevText.includes('日') && prevText.length < 15) {
        label = prevText;
      } else {
        label = `${j + 1}日目`; // フォールバック
      }
      label = label.replace(/\s+/g, ''); // 内部の空白・改行も除去

      const races = [];

      $(table).find('a').each((k, a) => {
        const href = $(a).attr('href') || '';
        if (href.includes('/racedetail/')) {
          const parts = href.split('/');
          const raceId = parts[parts.length - 2];
          const raceNo = parseInt(raceId.slice(-2), 10);
          // 重複除去
          if (!races.find(r => r.raceId === raceId)) {
            races.push({ raceNo, raceId });
          }
        }
      });

      if (races.length > 0) {
        days.push({ label, races });
      }
    });

    // slugをracecard URLから取得
    let slug = '';
    $(el).find('a').each((k, a) => {
      const href = $(a).attr('href') || '';
      if (href.includes('/racecard/')) {
        slug = href.split('/')[3];
        return false;
      }
    });

    const jaName = VENUE_MAP[slug] || slug;
    const grade = gradeMap[jaName] || '';

    venues.push({ name: VENUE_MAP[slug] || slug, slug, grade: grade, days });
  });

  return { date, venues };
}

module.exports = { getKaisai };
