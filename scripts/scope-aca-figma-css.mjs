import fs from 'node:fs';

const rawPath = new URL('../src/features/ai-chart-analysis/ai-chart-analysis-figma.raw.css', import.meta.url);
const outPath = new URL('../src/features/ai-chart-analysis/ai-chart-analysis-figma.css', import.meta.url);

const raw = fs.readFileSync(rawPath, 'utf8');
const base = raw.split('\n')[0].split('@media')[0];
const v2 = raw.match(/\.pageHeading\{[\s\S]*?\.evidenceGrid\{margin-top:10px\}/);
let css = (v2 ? v2[0] : '') + base;

function prefixSelectors(sel) {
  return sel
    .split(',')
    .map((s) => {
      s = s.trim();
      if (!s || s.startsWith('.aca-figma')) return s;
      return `.aca-figma ${s}`;
    })
    .join(', ');
}

css = css.replace(/(^|})(\s*)([^{@][^{]*?)\s*\{/g, (m, br, ws, sel) => {
  if (!sel.trim()) return m;
  return `${br}${ws}${prefixSelectors(sel)}{`;
});

const head = `.aca-figma{font-size:13px;color:#dbe7f5;min-width:0}
.aca-figma-page{padding:4px 0 32px}
.aca-figma-banner{padding:12px 14px;border-radius:8px;border:1px solid #192a40;background:#08121f;margin-bottom:12px}
.aca-figma-banner.err{border-color:#62303a;color:#ff8290}
.aca-figma-empty{padding:48px;text-align:center;color:#627994}
.aca-figma .iconBtn{background:none;border:0;color:#8ea8c0;cursor:pointer;padding:0;display:flex}
.aca-figma .rightTabs>*{cursor:pointer;background:none;border:0;color:inherit;font:inherit}
.aca-figma .rightTabs .on{color:#d8eaff;border-bottom:3px solid #168ff3}
.aca-figma .subTabs>*{cursor:pointer;background:none;border:0;color:inherit;font:inherit}
.aca-figma .subTabs .on{color:#dff0ff;border-bottom:2px solid #1597ff}
.aca-figma .refresh{cursor:pointer}
.aca-figma .spin{animation:acaSpin .8s linear infinite}
@keyframes acaSpin{to{transform:rotate(360deg)}}
.aca-figma h1,.aca-figma .pageHeading h1,.aca-figma .titleRow h1{color:#e8f2ff}
@media (max-width:1450px){.aca-figma .analysisGrid{grid-template-columns:1fr}.aca-figma .toolbar.pro{grid-template-columns:repeat(4,1fr)}.aca-figma .idbox{border-left:0}}
@media (max-width:1200px){.aca-figma .libraryLayout{grid-template-columns:1fr}.aca-figma .tfstrip{overflow-x:auto;grid-template-columns:repeat(9,130px)}.aca-figma .evidenceGrid{grid-template-columns:1fr}.aca-figma .chain{overflow-x:auto;grid-template-columns:repeat(9,120px)}}
`;

fs.writeFileSync(outPath, `${head}\n${css}`);
console.log('wrote', (head + css).length);
