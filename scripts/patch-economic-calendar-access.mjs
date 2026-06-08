import fs from 'node:fs';
import path from 'node:path';

const root = path.join(process.cwd(), 'app', 'api', 'economic-calendar');
const importLine = "import { assertEconomicCalendarAccess } from '@/lib/economic-calendar-access';\n";
const assertBlock = /function assertLocalOnly\(request: Request\) \{[\s\S]*?\n\}\n?/g;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === 'route.ts') patch(full);
  }
}

function patch(file) {
  let src = fs.readFileSync(file, 'utf8');
  if (!src.includes('function assertLocalOnly')) return;

  src = src.replace(assertBlock, '');
  src = src.replaceAll('assertLocalOnly(request)', 'assertEconomicCalendarAccess(request)');

  if (!src.includes(importLine.trim())) {
    const importMatch = src.match(/^import .+;\n/m);
    if (importMatch) {
      const index = src.indexOf(importMatch[0]) + importMatch[0].length;
      src = `${src.slice(0, index)}${importLine}${src.slice(index)}`;
    } else {
      src = `${importLine}\n${src}`;
    }
  }

  fs.writeFileSync(file, src);
  console.log('patched', path.relative(process.cwd(), file));
}

walk(root);
