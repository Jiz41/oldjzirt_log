// 複製元: /root/keirin-proxy/scraper.js（Jiz41 keirin-proxy）／複製日: 2026-10-16。改変: 出走表の脚質列(td[7])を rider.styleColumn として追加で返す（それ以外は原本どおり）。
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const VENUE_MAP = {
  '11': 'hakodate',
  '12': 'aomori',
  '13': 'iwakitaira',
  '21': 'yahiko',
  '22': 'maebashi',
  '23': 'toride',
  '24': 'utsunomiya',
  '25': 'omiya',
  '26': 'seibuen',
  '27': 'keiokaku',
  '28': 'tachikawa',
  '31': 'matsudo',
  '32': 'chiba',
  '34': 'kawasaki',
  '35': 'hiratsuka',
  '36': 'odawara',
  '37': 'ito',
  '38': 'shizuoka',
  '42': 'nagoya',
  '43': 'gifu',
  '44': 'ogaki',
  '45': 'toyohashi',
  '46': 'toyama',
  '47': 'matsusaka',
  '48': 'yokkaichi',
  '51': 'fukui',
  '53': 'nara',
  '54': 'mukomachi',
  '55': 'wakayama',
  '56': 'kishiwada',
  '61': 'tamano',
  '62': 'hiroshima',
  '63': 'hofu',
  '71': 'takamatsu',
  '73': 'komatsushima',
  '74': 'kochi',
  '75': 'matsuyama',
  '81': 'kokura',
  '83': 'kurume',
  '84': 'takeo',
  '85': 'sasebo',
  '86': 'beppu',
  '87': 'kumamoto'
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function buildCommentMap($, commentTable) {
  const map = {};
  if (!commentTable) return map;
  $(commentTable).find('tbody tr').each((i, row) => {
    const rowText = $(row).text();
    if (rowText.includes('誘導員')) return;
    const numberText = $(row).find('td.num span').first().text().trim();
    const num = parseInt(numberText, 10);
    if (isNaN(num) || num <= 0 || num >= 10) return;
    const commentText = $(row).find('td.comment').text().trim();
    map[num] = commentText || null;
  });
  return map;
}

// 選手の「直近4ヶ月の成績」より前の過去走の着順（今場所/前場所/前々場所の各ul>liを
// 前々場所→前場所→今場所の順（古い→新しい）に平坦化し、直近3走を新しい順に抜き出す。
// 数字以外の着順（故・落等）は oldjzirt 側の getRecent() と同じ規約で '9' に変換する。
function buildRecentMap($, pastTable) {
  const map = {};
  if (!pastTable) return map;
  $(pastTable).find('tbody tr').each((i, row) => {
    const rowText = $(row).text();
    if (rowText.includes('誘導員')) return;
    const tds = $(row).find('td');
    // 枠番セルは rowspan で同枠の2人目の行には無い（7車立ての7番車など）。その行は td が1つ少なく列が1つ左にずれる。
    if (tds.length < 6 || tds.length > 7) return;
    const off = tds.length - 7;
    const numberText = $(tds[1 + off]).find('span').first().text().trim();
    const num = parseInt(numberText, 10);
    if (isNaN(num) || num <= 0 || num >= 10) return;

    const chronologicalCols = [tds[6 + off], tds[5 + off], tds[4 + off]]; // 前々場所, 前場所, 今場所
    const seq = [];
    chronologicalCols.forEach((col) => {
      $(col).find('li').each((j, li) => {
        const spans = $(li).find('span');
        if (spans.length >= 3) {
          seq.push($(spans[2]).text().trim());
        }
      });
    });

    if (seq.length === 0) {
      map[num] = null;
      return;
    }

    const last3 = seq.slice(-3).reverse();
    let str = last3.map((r) => {
      const digitMatch = r.match(/^(\d)/);
      return digitMatch ? digitMatch[1] : '9';
    }).join('');
    while (str.length < 3) str += '9';
    str = str.slice(0, 3);
    map[num] = str;
  });
  return map;
}

function parseLineup($) {
  const lineup = { source: null, lines: null, roles: null, providedBy: null };

  const lineupDl = $('dl.racecard_footer-contents').filter((i, el) => {
    return $(el).find('dt').first().text().trim() === '並び予想';
  }).first();

  if (lineupDl.length) {
    const icons = $(lineupDl).find('.line_position > span.icon_p');
    const lines = [];
    const roles = {};
    let current = [];

    icons.each((i, el) => {
      if ($(el).hasClass('space')) {
        if (current.length) {
          lines.push(current);
          current = [];
        }
        return;
      }
      const spans = $(el).find('span');
      if (spans.length === 0) return;
      const carNum = parseInt($(spans[0]).text().trim(), 10);
      if (isNaN(carNum) || carNum <= 0 || carNum >= 10) return; // 方向アイコン(←)等を除外
      current.push(carNum);
      if (spans.length > 1) {
        const roleText = $(spans[1]).text().trim();
        if (roleText) roles[carNum] = roleText;
      }
    });
    if (current.length) lines.push(current);

    if (lines.length > 0) {
      lineup.source = 'official';
      lineup.lines = lines;
      lineup.roles = Object.keys(roles).length > 0 ? roles : null;
    }
  }

  const tipsterDl = $('dl.tipster');
  if (tipsterDl.length) {
    tipsterDl.find('dt').each((i, dt) => {
      const label = $(dt).text().trim().replace('：', '');
      if (label === '並び提供') {
        const text = $(dt).next('dd').text().trim();
        if (text) lineup.providedBy = text;
      }
    });
  }

  return lineup;
}

function resolveStyle(kimatete) {
  const nige  = kimatete['逃'] || 0;
  const maku  = kimatete['捲'] || 0;
  const sashi = kimatete['差'] || 0;
  const ma    = kimatete['マ'] || 0;

  const groups = [
    { value: '逃', score: nige },
    { value: '自', score: maku },
    { value: '追', score: Math.max(sashi, ma) },
  ];

  groups.sort((a, b) => b.score - a.score);

  if (groups[0].score === 0) return { value: null, warn: true };
  if (groups[0].score === groups[1].score) return { value: null, warn: true };
  return { value: groups[0].value, warn: false };
}

async function scrapeRace(raceId) {
  const venueCode = raceId.slice(0, 2);
  const slug = VENUE_MAP[venueCode];
  if (!slug) {
    throw new Error('Invalid venue code');
  }

  const url = `https://keirin.kdreams.jp/${slug}/racedetail/${raceId}/`;

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

  const titleText = $('title').text();
  const venueMatch = titleText.match(/(.+)競輪 レース詳細/);
  const venue = venueMatch ? venueMatch[1] : '';

  const riders = [];
  let raceTable = null;
  let commentTable = null;
  let pastTable = null;

  $('table').each((i, table) => {
      const thText = $(table).find('th').first().text();
      if (thText.includes('予想') && !thText.includes('周回')) {
          raceTable = table;
          return false;
      }
  });

  $('table').each((i, table) => {
      const allThText = $(table).find('th').text();
      if (!commentTable && allThText.includes('選手コメント')) commentTable = table;
      if (!pastTable && allThText.includes('前々場所成績')) pastTable = table;
  });

  const commentMap = buildCommentMap($, commentTable);
  const recentMap = buildRecentMap($, pastTable);

  if (raceTable) {
    $(raceTable).find('tbody tr').each((i, el) => {
      const rowText = $(el).text();
      if (rowText.includes('誘導員')) return;

      const tds = $(el).find('td');
      if (tds.length === 0) return;

      let number = null;
      const indexOffset = tds.length <= 22 ? -1 : 0;
      const numberCellIndex = 4 + indexOffset;
      if (tds[numberCellIndex]) {
          const numText = $(tds[numberCellIndex]).text().trim();
          const parsedNum = parseInt(numText, 10);
          if (!isNaN(parsedNum) && parsedNum > 0 && parsedNum < 10) {
              number = parsedNum;
          }
      }

      if (number === null) {
          tds.each((j, td) => {
              const cellText = $(td).text().trim();
              if (/^[1-9]$/.test(cellText)) {
                  number = parseInt(cellText, 10);
                  return false;
              }
          });
      }

      if (number === null) return;

      const isScratched = rowText.includes('（欠車）') || rowText.includes('欠');

      let rider = {
          mark: "", bracket: null, number: number,
          name: '', pref: null, age: null, term: null,
          grade: '', style: null, styleWarn: false,
          gear: null, score: null, isScratched: isScratched,
          sCount: null, bCount: null, recent3: null, comment: null,
          styleColumn: null
      };

      try {
        const nameCellIndex = 5 + indexOffset;
        const nameCellText = tds[nameCellIndex] ? $(tds[nameCellIndex]).text().replace(/　/g, ' ').trim() : '';
        const bracketCellIndex = 3 + indexOffset;
        if(tds[bracketCellIndex]){
            const bracket = parseInt($(tds[bracketCellIndex]).text().trim());
            rider.bracket = isNaN(bracket) ? null : bracket;
        }

        if (isScratched) {
            rider.name = nameCellText.replace('（欠車）', '').replace(/\s+/g, ' ').trim();
        } else {
            rider.mark = indexOffset === 0 && tds[0] ? $(tds[0]).text().trim() : "";
            const detailRegex = /([^\s/]+(?:\s[^\s/]+)?)\s*\/\s*(\d+)\s*\/\s*(\d+)/;
            const detailMatch = nameCellText.match(detailRegex);
            if (detailMatch) {
                rider.name = nameCellText.substring(0, detailMatch.index).replace(/\s+/g, ' ').trim();
                rider.pref = (detailMatch[1] || '').replace(/\s/g, '');
                rider.age = parseInt(detailMatch[2]) || null;
                rider.term = parseInt(detailMatch[3]) || null;
            } else {
                rider.name = nameCellText.replace(/\s+/g, ' ').trim();
            }
            rider.grade = tds[6 + indexOffset] ? $(tds[6 + indexOffset]).text().trim() : '';
            rider.styleColumn = tds[7 + indexOffset] ? ($(tds[7 + indexOffset]).text().trim() || null) : null;
            const kimatete = {
              '逃': parseInt($(tds[12 + indexOffset]).text().trim(), 10) || 0,
              '捲': parseInt($(tds[13 + indexOffset]).text().trim(), 10) || 0,
              '差': parseInt($(tds[14 + indexOffset]).text().trim(), 10) || 0,
              'マ': parseInt($(tds[15 + indexOffset]).text().trim(), 10) || 0,
            };
            const styleResult = resolveStyle(kimatete);
            rider.style = styleResult.value;
            if (styleResult.warn) rider.styleWarn = true;
            const gearVal = parseFloat(tds[8 + indexOffset] ? $(tds[8 + indexOffset]).text().trim() : '');
            rider.gear = isNaN(gearVal) ? null : gearVal;
            const scoreVal = parseFloat(tds[9 + indexOffset] ? $(tds[9 + indexOffset]).text().trim() : '');
            rider.score = isNaN(scoreVal) ? null : scoreVal;

            const sVal = parseInt(tds[10 + indexOffset] ? $(tds[10 + indexOffset]).text().trim() : '', 10);
            rider.sCount = isNaN(sVal) ? null : sVal;
            const bVal = parseInt(tds[11 + indexOffset] ? $(tds[11 + indexOffset]).text().trim() : '', 10);
            rider.bCount = isNaN(bVal) ? null : bVal;

            rider.recent3 = recentMap[number] !== undefined ? recentMap[number] : null;
            rider.comment = commentMap[number] !== undefined ? commentMap[number] : null;
        }
      } catch (e) {
          console.error(`Error parsing row for rider #${number} in race ${raceId}. Error: ${e.message}`);
      }

      riders.push(rider);
    });
  }

  const grades = riders.filter(r => !r.isScratched).map(r => r.grade);
  let series = 'A級';
  if (grades.some(g => g === 'L1')) series = 'ガールズ';
  else if (grades.some(g => g && g.startsWith('S'))) series = 'S級';
  else if (grades.some(g => g === 'A3')) series = 'A級チャレンジ';

  const lineup = parseLineup($);

  return { raceId, venue, series, riders, lineup };
}

module.exports = { scrapeRace };
