const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.ORG_GRAPH_TOKEN || process.env.GITHUB_TOKEN;
const ORG = 'Platform-System';
const AUTHOR = 'Khanh-Hung';

// --- Helpers ---
function toDateString(date) {
  return date.toISOString().split('T')[0];
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function apiGet(path) {
  const results = [];
  let page = 1;

  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `https://api.github.com${path}${sep}per_page=100&page=${page}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'User-Agent': 'org-activity-graph',
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!res.ok) {
      console.warn(`  [WARN] ${res.status} for ${url}`);
      break;
    }

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    results.push(...data);

    const link = res.headers.get('link') || '';
    if (!link.includes('rel="next"')) break;
    page++;
  }

  return results;
}

// --- SVG Generator ---
function generateSVG(commitsByDay, startDate, endDate, total) {
  const CELL = 11;
  const GAP = 2;
  const WEEKS = 53;
  const DAYS = 7;
  const PAD = { top: 40, right: 16, bottom: 24, left: 36 };

  const W = PAD.left + WEEKS * (CELL + GAP) + PAD.right;
  const H = PAD.top + DAYS * (CELL + GAP) + PAD.bottom;

  const COLORS = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'];
  const getColor = (n) =>
    n === 0 ? COLORS[0] : n <= 2 ? COLORS[1] : n <= 4 ? COLORS[2] : n <= 7 ? COLORS[3] : COLORS[4];

  // Grid start: Sunday before startDate
  const gridStart = new Date(startDate);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS_LBL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  let cells = '';
  let monthLbls = '';
  let lastMonth = -1;

  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < DAYS; d++) {
      const date = addDays(gridStart, w * 7 + d);
      if (date < startDate || date > endDate) continue;

      const ds = toDateString(date);
      const n = commitsByDay[ds] || 0;
      const x = PAD.left + w * (CELL + GAP);
      const y = PAD.top + d * (CELL + GAP);

      cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${getColor(n)}"><title>${ds}: ${n} commit${n !== 1 ? 's' : ''}</title></rect>`;

      if (d === 0 && date.getMonth() !== lastMonth) {
        lastMonth = date.getMonth();
        monthLbls += `<text x="${x}" y="${PAD.top - 6}" fill="#8b949e" font-size="10" font-family="monospace">${MONTHS[date.getMonth()]}</text>`;
      }
    }
  }

  const dayLbls = [1, 3, 5]
    .map((i) => {
      const y = PAD.top + i * (CELL + GAP) + CELL * 0.8;
      return `<text x="${PAD.left - 6}" y="${y}" fill="#8b949e" font-size="9" font-family="monospace" text-anchor="end">${DAYS_LBL[i]}</text>`;
    })
    .join('');

  // Legend
  const legendX = W - PAD.right - 5 * (CELL + GAP) - 40;
  const legendY = H - 4;
  const legend = `
    <text x="${legendX - 4}" y="${legendY}" fill="#8b949e" font-size="9" font-family="monospace" text-anchor="end">Less</text>
    ${COLORS.map((c, i) => `<rect x="${legendX + i * (CELL + GAP)}" y="${legendY - CELL}" width="${CELL}" height="${CELL}" rx="2" fill="${c}"/>`).join('')}
    <text x="${legendX + 5 * (CELL + GAP) + 2}" y="${legendY}" fill="#8b949e" font-size="9" font-family="monospace">More</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="100%" height="100%" fill="#0d1117" rx="8"/>
  <text x="${PAD.left}" y="18" fill="#e6edf3" font-size="12" font-weight="600" font-family="monospace">🚀 Platform-System · ${total} org commits in the last year</text>
  ${monthLbls}
  ${dayLbls}
  ${cells}
  ${legend}
</svg>`;
}

// --- Main ---
async function main() {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 1);
  const since = startDate.toISOString();

  console.log(`Fetching repos for ${ORG}...`);
  const repos = await apiGet(`/orgs/${ORG}/repos?type=all`);
  console.log(`  Found ${repos.length} repos`);

  const commitsByDay = {};

  for (const repo of repos) {
    // Skip the .github profile repo - not a code service repo
    if (repo.name === '.github') {
      console.log(`  Skipping ${repo.name} (profile repo)`);
      continue;
    }
    console.log(`  Scanning ${repo.name}...`);
    try {
      const commits = await apiGet(
        `/repos/${ORG}/${repo.name}/commits?author=${AUTHOR}&since=${since}`
      );
      for (const c of commits) {
        const day = c.commit.author.date.split('T')[0];
        commitsByDay[day] = (commitsByDay[day] || 0) + 1;
      }
    } catch (e) {
      console.warn(`  [SKIP] ${repo.name}: ${e.message}`);
    }
  }

  const total = Object.values(commitsByDay).reduce((a, b) => a + b, 0);
  console.log(`Total commits: ${total}`);

  const svg = generateSVG(commitsByDay, startDate, endDate, total);

  const outDir = path.join('generated');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'org-activity.svg'), svg);
  console.log('✅ Generated: generated/org-activity.svg');

  // Also generate a small badge SVG for the table total row
  const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="20" viewBox="0 0 72 20">
  <rect width="72" height="20" rx="3" fill="#008080"/>
  <text x="36" y="14" fill="#fff" font-size="11" font-family="monospace" text-anchor="middle" font-weight="600">${total} commits</text>
</svg>`;
  fs.writeFileSync(path.join(outDir, 'total-badge.svg'), badge);
  console.log('✅ Generated: generated/total-badge.svg');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
