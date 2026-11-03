// Generates dist/stats.svg — neon "portfolio" card from GitHub GraphQL. No deps (Node 20+).
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";

const USER = process.env.GH_USER;
const TOKEN = process.env.GH_TOKEN;
const FONT = "'JetBrains Mono','Fira Code','SF Mono',Consolas,'Courier New',monospace";

const query = `query($login:String!){
  user(login:$login){
    followers{totalCount}
    pullRequests{totalCount}
    repositories(ownerAffiliations:OWNER,isFork:false,first:100,orderBy:{field:STARGAZERS,direction:DESC}){
      totalCount
      nodes{ stargazerCount languages(first:10,orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name color } } } }
    }
    contributionsCollection{
      totalCommitContributions totalPullRequestContributions totalPullRequestReviewContributions restrictedContributionsCount
      contributionCalendar{ totalContributions weeks{ contributionDays{ contributionCount date } } }
    }
  }
}`;

async function load() {
  if (process.env.MOCK) return JSON.parse(readFileSync(process.env.MOCK, "utf8"));
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-stats" },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data.user;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n));

const u = await load();
const cc = u.contributionsCollection;
const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
const total = cc.contributionCalendar.totalContributions;
const stars = u.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0);

// streaks (today with 0 doesn't break the current streak yet)
let longest = 0, run = 0;
for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
let current = 0, i = days.length - 1;
if (days[i] && days[i].contributionCount === 0) i--;
for (; i >= 0 && days[i].contributionCount > 0; i--) current++;

// languages
const langs = {};
for (const r of u.repositories.nodes) for (const e of r.languages.edges) {
  const k = e.node.name; langs[k] = langs[k] || { size: 0, color: e.node.color || "#8b98b8" }; langs[k].size += e.size;
}
const langTotal = Object.values(langs).reduce((a, l) => a + l.size, 0) || 1;
const top = Object.entries(langs).sort((a, b) => b[1].size - a[1].size).slice(0, 6)
  .map(([name, l]) => ({ name, color: l.color, pct: (l.size / langTotal) * 100 }));

// 90-day chart
const raw = days.slice(-92);
const last = raw.slice(2).map((d, k) => ({ ...d, v: (raw[k].contributionCount + raw[k + 1].contributionCount + d.contributionCount) / 3 }));
const max = Math.max(1, ...last.map((d) => d.v));
const CX = 50, CW = 570, CY = 330, CH = 120;
const pts = last.map((d, k) => [CX + (k / (last.length - 1)) * CW, CY - (d.v / max) * CH]);
const line = pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ");
const area = `${CX},${CY} ${line} ${CX + CW},${CY}`;
const peak = last.reduce((a, d) => (d.contributionCount > a.contributionCount ? d : a), last[0]);
const lastPt = pts[pts.length - 1];

const kpis = [
  ["CONTRIBUTIONS · 1Y", fmt(total), "#00f5d4"],
  ["COMMITS", fmt(cc.totalCommitContributions), "#00bbf9"],
  ["PRs + REVIEWS", fmt(cc.totalPullRequestContributions + cc.totalPullRequestReviewContributions), "#9b5de5"],
  ["STARS · REPOS", `${fmt(stars)} · ${u.repositories.totalCount}`, "#f15bb5"],
  ["STREAK · BEST", `${current}d · ${longest}d`, "#00f5a0"],
];
const kw = 178.4, kg = 12;
const kpiSvg = kpis.map(([label, val, col], k) => {
  const x = 30 + k * (kw + kg);
  return `<g class="up" style="animation-delay:${0.15 + k * 0.1}s">
    <rect x="${x}" y="70" width="${kw}" height="78" rx="10" fill="#0b1220" stroke="#1e2a45"/>
    <rect x="${x}" y="70" width="3" height="78" rx="1.5" fill="${col}"/>
    <text x="${x + 16}" y="96" class="lbl">${label}</text>
    <text x="${x + 16}" y="132" class="val" fill="${col}" filter="url(#glow)">${esc(val)}</text>
  </g>`;
}).join("");

let off = 0;
const BX = 670, BW = 300;
const barSvg = top.map((l, k) => {
  const w = (l.pct / top.reduce((a, t) => a + t.pct, 0)) * BW;
  const s = `<rect class="grow" style="animation-delay:${0.6 + k * 0.08}s" x="${(BX + off).toFixed(1)}" y="200" width="${Math.max(2, w - 2).toFixed(1)}" height="12" rx="3" fill="${l.color}"/>`;
  off += w; return s;
}).join("");
const listSvg = top.map((l, k) => {
  const col = k % 2, row = Math.floor(k / 2);
  const x = BX + col * 152, y = 248 + row * 30;
  return `<g class="up" style="animation-delay:${0.8 + k * 0.08}s"><circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${l.color}"/>
    <text x="${x + 16}" y="${y}" class="txt">${esc(l.name)}</text><text x="${x + 140}" y="${y}" class="txt dim" text-anchor="end">${l.pct.toFixed(1)}%</text></g>`;
}).join("");

const today = new Date().toISOString().slice(0, 10);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 370" width="1000" height="370">
<defs>
  <linearGradient id="n" x1="0" x2="1"><stop offset="0" stop-color="#00f5d4"/><stop offset=".5" stop-color="#9b5de5"/><stop offset="1" stop-color="#f15bb5"/></linearGradient>
  <linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9b5de5" stop-opacity=".45"/><stop offset="1" stop-color="#9b5de5" stop-opacity="0"/></linearGradient>
  <filter id="glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#fff" stroke-opacity=".04"/></pattern>
</defs>
<style>
  text{font-family:${FONT}}
  .lbl{font-size:10.5px;fill:#6e7681;letter-spacing:1.5px}
  .val{font-size:26px;font-weight:800}
  .txt{font-size:12.5px;fill:#c9d1d9} .dim{fill:#6e7681}
  .h{font-size:11px;fill:#8b98b8;letter-spacing:2px}
  .up{opacity:0;animation:up .5s ease-out forwards}
  @keyframes up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  .draw{stroke-dasharray:8000;stroke-dashoffset:8000;animation:draw 3s .5s ease-out forwards}
  @keyframes draw{to{stroke-dashoffset:0}}
  .fade{opacity:0;animation:fade 1s 1.8s forwards} @keyframes fade{to{opacity:1}}
  .grow{transform-box:fill-box;transform-origin:left;animation:grow .8s ease-out both}
  @keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  .pulse{animation:p 1.4s ease-in-out infinite} @keyframes p{50%{opacity:.3}}
</style>
<rect width="1000" height="370" rx="18" fill="#070b14"/><rect width="1000" height="370" rx="18" fill="url(#grid)"/>
<rect x=".5" y=".5" width="999" height="369" rx="18" fill="none" stroke="#1e2a45"/>
<text x="30" y="42" font-size="16" font-weight="800" fill="url(#n)" letter-spacing="2" filter="url(#glow)">PORTFOLIO · @${esc(USER)}</text>
<circle class="pulse" cx="${30 + (13 + USER.length) * 11.8 + 16}" cy="37" r="4" fill="#00f5a0"/>
<text x="${30 + (13 + USER.length) * 11.8 + 26}" y="41" class="lbl">LIVE</text>
<text x="970" y="41" class="lbl" text-anchor="end">updated ${today}</text>
${kpiSvg}
<rect x="30" y="168" width="610" height="182" rx="10" fill="#0b1220" stroke="#1e2a45"/>
<text x="50" y="192" class="h">ACTIVITY · 90D</text>
<text x="620" y="192" class="lbl" text-anchor="end">peak ${peak.contributionCount} · ${peak.date}</text>
<g stroke="#fff" stroke-opacity=".05">${[0, 1, 2, 3].map((k) => `<line x1="${CX}" x2="${CX + CW}" y1="${CY - k * 40}" y2="${CY - k * 40}"/>`).join("")}</g>
<polygon class="fade" points="${area}" fill="url(#a)"/>
<polyline class="draw" points="${line}" fill="none" stroke="url(#n)" stroke-width="2" stroke-linejoin="round" filter="url(#glow)"/>
<circle class="pulse" cx="${lastPt[0].toFixed(1)}" cy="${lastPt[1].toFixed(1)}" r="4.5" fill="#00f5d4" filter="url(#glow)"/>
<rect x="650" y="168" width="320" height="182" rx="10" fill="#0b1220" stroke="#1e2a45"/>
<text x="670" y="192" class="h">ALLOCATION · LANGUAGES</text>
${barSvg}${listSvg}
</svg>`;

mkdirSync("dist", { recursive: true });
writeFileSync("dist/stats.svg", svg);
console.log("dist/stats.svg written");
