import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const results = [];
const check = (c, n, w) => { results.push(c); console.log(c ? '  ✓' : '  ✗', n, c ? '' : (w ?? '')); };
const nodeCount = (t) => page.$$eval(`.react-flow__node-${t}`, (n) => n.length);
const activeTool = () => page.$eval('.toolbar button.active:not([title^="Keep"])', (b) => b.title).catch(() => 'none');

await page.goto('http://localhost:5573');
await page.waitForSelector('.dashboard', { timeout: 8000 });
await page.click('button:has-text("New diagram")');
await page.waitForSelector('.toolbar');

// ═══ 1. Every tool creates its element ═══
await page.keyboard.press('r');
await page.mouse.move(420, 300); await page.mouse.down(); await page.mouse.move(620, 420, { steps: 5 }); await page.mouse.up();
await page.waitForSelector('.react-flow__node-shape');
check(await nodeCount('shape') === 1, 'rectangle draws');
await page.keyboard.press('d');
await page.mouse.move(700, 300); await page.mouse.down(); await page.mouse.move(820, 400, { steps: 4 }); await page.mouse.up();
await page.keyboard.press('o');
await page.mouse.move(880, 300); await page.mouse.down(); await page.mouse.move(1000, 400, { steps: 4 }); await page.mouse.up();
check(await nodeCount('shape') === 3, 'diamond + ellipse draw');
await page.keyboard.press('a');
await page.mouse.move(420, 640); await page.mouse.down(); await page.mouse.move(560, 700, { steps: 4 }); await page.mouse.up();
await page.keyboard.press('l');
await page.mouse.move(420, 740); await page.mouse.down(); await page.mouse.move(560, 740, { steps: 4 }); await page.mouse.up();
check(await nodeCount('arrow') === 2, 'arrow + line draw');
await page.keyboard.press('p');
await page.mouse.move(640, 640); await page.mouse.down();
for (let i = 0; i < 15; i++) await page.mouse.move(640 + i * 7, 640 + Math.sin(i) * 25);
await page.mouse.up();
check(await nodeCount('freehand') === 1, 'freehand draws');
await page.keyboard.press('s');
await page.mouse.click(1000, 640);
await page.waitForSelector('.react-flow__node-sticky textarea');
await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
await page.keyboard.type('sticky note');
await page.mouse.click(1200, 800);
await page.waitForTimeout(150);
check((await page.$eval('.react-flow__node-sticky', (n) => n.textContent))?.includes('sticky note') === true, 'sticky creates + edits');
await page.keyboard.press('t');
await page.mouse.click(250, 550);
await page.waitForSelector('.react-flow__node-label textarea');
await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
await page.keyboard.type('free label');
await page.mouse.click(1200, 800);
await page.waitForTimeout(150);
check((await page.$eval('.react-flow__node-label', (n) => n.textContent))?.includes('free label') === true, 'text tool on canvas creates label');

// ═══ 2. THE REPORTED BUG: text tool → click a shape → type immediately ═══
await page.keyboard.press('t');
const rect = await page.$eval('.react-flow__node-shape', (n) => { const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, r }; });
await page.mouse.click(rect.x, rect.y);
const shapeEditor = await page.waitForSelector('.react-flow__node-shape textarea', { timeout: 2500 }).catch(() => null);
check(shapeEditor !== null, 'text tool click on shape opens centered editor');
// type IMMEDIATELY — chars must land in the editor, tools must not switch
await page.keyboard.type('rhelp'); // r/h/e/l/p are all tool hotkeys
await page.waitForTimeout(120);
const toolNow = await activeTool();
check(!['Rectangle — R or 2', 'Hand (panning tool) — H', 'Eraser — E or 0', 'Line — L or 6', 'Draw — P or 7'].includes(toolNow),
  'typing tool-hotkey letters does NOT switch tools mid-edit', toolNow);
const typed = await page.$eval('.react-flow__node-shape textarea', (el) => el.value).catch(() => null);
check(typed === 'rhelp', 'every keystroke lands in the shape editor', typed ?? 'null');
await page.mouse.click(1200, 800);
await page.waitForTimeout(200);
// text renders centered in the shape
const centered = await page.$eval('.react-flow__node-shape .shape-text', (el) => {
  const t = el.getBoundingClientRect();
  const s = el.closest('.react-flow__node').getBoundingClientRect();
  const cx = Math.abs((t.x + t.width / 2) - (s.x + s.width / 2));
  const cy = Math.abs((t.y + t.height / 2) - (s.y + s.height / 2));
  return { cx, cy, text: el.textContent };
});
check(centered.text === 'rhelp' && centered.cx < 2 && centered.cy < 2,
  'committed text renders centered in the shape', JSON.stringify(centered));

// ═══ 3. Double-click and Enter also edit shape text ═══
await page.keyboard.press('v');
await page.mouse.move(rect.x, rect.y);
await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(80);
await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
const dbl = await page.waitForSelector('.react-flow__node-shape textarea', { timeout: 2000 }).catch(() => null);
check(dbl !== null, 'double-click on shape reopens its text editor');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
// Enter with the shape selected
await page.mouse.click(rect.x, rect.y);
await page.waitForTimeout(150);
await page.keyboard.press('Enter');
const enterEd = await page.waitForSelector('.react-flow__node-shape textarea', { timeout: 2000 }).catch(() => null);
check(enterEd !== null, 'Enter on selected shape edits its text');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// ═══ 4. Text tool on existing label/sticky edits (no stacking) ═══
await page.keyboard.press('t');
const lb = await page.$eval('.react-flow__node-label', (n) => { const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.click(lb.x, lb.y);
const relab = await page.waitForSelector('.react-flow__node-label textarea', { timeout: 2000 }).catch(() => null);
check(relab !== null && (await nodeCount('label')) === 1, 'text tool on existing label edits it (no duplicate)');
await page.keyboard.press('Escape');
await page.waitForTimeout(100);

// ═══ 5. Select / style / drag / resize regression ═══
await page.keyboard.press('v');
await page.mouse.click(rect.x, rect.y);
await page.waitForTimeout(150);
check(await page.$('.style-panel') !== null && await page.$('.react-flow__resize-control') !== null, 'select: style panel + resizer');
await page.mouse.move(rect.x, rect.y); await page.mouse.down();
await page.mouse.move(rect.x + 63, rect.y + 44, { steps: 5 }); await page.mouse.up();
await page.waitForTimeout(150);
const moved = await page.$eval('.react-flow__node-shape', (n) => n.style.transform);
const mm = moved.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
check(mm && +mm[1] % 20 === 0 && +mm[2] % 20 === 0, 'drag snaps to grid', moved);

// ═══ 6. Eraser, undo/redo, lock, hand ═══
await page.keyboard.press('e');
const shapes0 = await nodeCount('shape');
const eb = await page.$eval('.react-flow__node-shape', (n) => { const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.click(eb.x, eb.y);
await page.waitForTimeout(150);
check(await nodeCount('shape') === shapes0 - 1, 'eraser removes shape');
await page.keyboard.press('v');
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
check(await nodeCount('shape') === shapes0, 'undo restores');
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(150);
check(await nodeCount('shape') === shapes0 - 1, 'redo re-erases');
await page.keyboard.press('q');
await page.keyboard.press('r');
await page.mouse.move(300, 200); await page.mouse.down(); await page.mouse.move(360, 260, { steps: 3 }); await page.mouse.up();
await page.mouse.move(300, 280); await page.mouse.down(); await page.mouse.move(360, 340, { steps: 3 }); await page.mouse.up();
check((await activeTool()).startsWith('Rectangle'), 'tool lock keeps tool');
await page.keyboard.press('q');
await page.keyboard.press('h');
check((await activeTool()).startsWith('Hand'), 'hand tool selectable');
await page.keyboard.press('v');

// ═══ 7. Hotkey guard: open editor via T on empty canvas, press tool keys ═══
await page.keyboard.press('t');
await page.mouse.click(1050, 200);
await page.waitForSelector('.react-flow__node-label textarea');
await page.keyboard.type('veo2'); // v/e/o/2 all map to tools
const guardVal = await page.$eval('.react-flow__node-label textarea', (el) => el.value);
check(guardVal === 'veo2', 'hotkey letters type into fresh label editor', guardVal);
await page.mouse.click(1200, 820);
await page.waitForTimeout(150);

// ═══ 8. ⌘A + ⌘D + nudge still work when NOT editing ═══
await page.keyboard.press('Control+a');
await page.waitForTimeout(120);
const selAll = await page.$$eval('.react-flow__node.selected', (n) => n.length);
check(selAll >= 6, `⌘A selects all annotations (${selAll})`);

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
