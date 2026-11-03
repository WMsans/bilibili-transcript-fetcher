// Self-test for bilibili-transcript-fetcher.user.js without a browser.
// Runs the SHIPPED source unmodified against a minimal DOM stub, then clicks the pill
// (logged out, so the chain must end in the "not logged in" note, not "no subtitles").
import fs from 'node:fs';
const src = fs.readFileSync('bilibili-transcript-fetcher.user.js', 'utf8');

const Style = () => { const m = {}; return new Proxy({}, { set: (t, k, v) => { m[k] = v; return true; }, get: (t, k) => m[k] }); };
const CJK = /[\u4e00-\u9fff]/;

function El(tag, cls = '', txt = '', id = '') {
  const t = { tag, className: cls, id, title: '', text: txt, children: [], parent: null, style: Style(), cssText: '', listeners: {} };
  return new Proxy(t, {
    get: (o, k) => {
      if (k === 'textContent') return o.text;
      if (k === 'style') return o.style;
      if (k === 'appendChild') return (c) => { c.parent = o; o.children.push(c); return c; };
      if (k === 'remove') return () => { if (o.parent) o.parent.children = o.parent.children.filter((c) => c !== o); };
      if (k === 'addEventListener') return (type, fn) => { o.listeners[type] = fn; };
      if (k === 'nextSibling') return null;
      if (k === 'insertBefore') return (n, ref) => {
        n.parent = o;
        const i = o.children.indexOf(ref);
        if (i < 0) o.children.push(n); else o.children.splice(i, 0, n);
        return n;
      };
      if (k === 'parentNode' || k === 'parentElement') return o.parent;
      if (k === 'querySelector') return (sel) => {
        const want = sel.replace(/^[.#]/, '');
        return o.children.find((c) => c.id === want || (c.className || '').includes(want));
      };
      return Reflect.get(o, k);
    },
    set: (o, k, v) => {
      if (k === 'textContent') { o.text = v; return v; }
      if (k === 'style') { o.cssText = v; return v; }
      return Reflect.set(o, k, v);
    }
  });
}

const GREY = { backgroundColor: 'rgb(244, 245, 246)', color: 'rgb(97, 101, 106)', fontSize: '13px', fontFamily: 'Arial', padding: '4px 10px', borderRadius: '4px', lineHeight: '18px' };
const fails = [];
const check = (label, cond) => { if (!cond) fails.push(label); };

async function scenario(scenarioNo, href, state, toggleText, expectNote, hidden) {
  const wrap = El('div', 'left-container');
  const desc = El('div', 'video-desc-container', '', 'v_desc');
  desc.hidden = hidden; desc.parent = wrap; wrap.children.push(desc);
  const info = El('div', 'basic-desc-info'); info.parent = desc; desc.children.push(info);
  const toggle = toggleText === null ? null : El('div', 'toggle-btn', toggleText);
  if (toggle) { toggle.parent = desc; desc.children.push(toggle); }

  global.document = { body: El('body'), querySelector: (sel) => desc, createElement: (tag) => El(tag) };
  global.window = { __INITIAL_STATE__: state };
  global.location = { href, pathname: new URL(href).pathname };
  if (!navigator.clipboard) navigator.clipboard = { writeText: (t) => Promise.resolve(true) };
  global.getComputedStyle = (e) => e && e.hidden ? { ...GREY, display: 'none' } : GREY;

  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, o) => { console.log('FETCH', String(url).slice(0,120)); return realFetch(url, o).catch((e) => { console.log('FETCH-ERR', String(url).slice(0,120), e.message, (e.cause && e.cause.message) || ''); throw e; }); };
  eval(src);

  console.log('SCENARIO', scenarioNo);
  const pill = desc.children.concat(wrap.children).find((c) => c.style['display'] === 'inline-block');
  check('pill injected', !!pill);
  if (!pill) return;
  const cnUi = toggleText === null ? !/\/en\//.test(new URL(href).pathname) : CJK.test(toggleText);
  check('label follows the page language', pill.text === (cnUi ? '字幕' : 'Transcript'));
  check('style copied verbatim from the toggle',
    pill.style['background-color'] === GREY.backgroundColor && pill.style['color'] === GREY.color &&
    pill.style['padding'] === GREY.padding && pill.style['border-radius'] === GREY.borderRadius);
  const box = desc.children.includes(pill) ? desc : wrap;
  const anchor = toggle || (hidden ? desc : info); // hidden #v_desc: the pill goes beside the block
  check('inserted after the toggle or the description, not at page end',
    box.children.indexOf(pill) === box.children.indexOf(anchor) + 1);

  await pill.listeners.click();
  const notes = desc.children.concat(wrap.children).filter((c) => c.style.cssText && c !== pill);
  console.log('notes:', notes.length, '->', notes.map(n=>n.text));
  const note = notes[notes.length-1];
  check('pill text restored after the click', pill.text === (cnUi ? '字幕' : 'Transcript'));
  check('failure names the cause (got: ' + (note?note.text:'none') + ')', note && note.text === expectNote);
}

const bv = 'BV1REx46NEc4';
// 1) English UI, part 1, state matches the URL
await scenario(1, `https://www.bilibili.com/video/${bv}/?p=1`,
  { p: 1, videoData: { bvid: bv, aid: 80433022, cid: 137649199, pages: [{ page: 1, cid: 137649199, part: 'p1' }] } },
  'Expand More',
  'subtitle list empty — this tab is not logged in (AI subtitles also come back empty logged out)');

// 2) Chinese UI, part 2, stale state (bvid mismatch) must fall back to pagelist, not guess P1
await scenario(2, 'https://www.bilibili.com/video/BV1i24P6rEmt/?p=2',
  { p: 1, videoData: { bvid: 'BV1WRONGbvi', aid: 1, cid: 1, pages: [{ page: 1, cid: 1, part: 'p1' }] } },
  '展开',
  '字幕 list empty — this tab is not logged in (AI subtitles also come back empty logged out)');

// 3) short description: no .toggle-btn at all -> pill must still land, inside the description block
await scenario(3, `https://www.bilibili.com/video/${bv}/?p=1`,
  { p: 1, videoData: { bvid: bv, aid: 80433022, cid: 137649199, pages: [{ page: 1, cid: 137649199, part: 'p1' }] } },
  null,
  '字幕 list empty — this tab is not logged in (AI subtitles also come back empty logged out)');

// 4) empty description: #v_desc is display:none -> pill must go next to it, where it can be clicked
await scenario(4, 'https://www.bilibili.com/en/video/BV1hV4P6PEc3/',
  { p: 1, videoData: { bvid: 'BV1hV4P6PEc3', aid: 1, cid: 1, pages: [{ page: 1, cid: 1, part: 'p1' }] } },
  null,
  'subtitle list empty — this tab is not logged in (AI subtitles also come back empty logged out)',
  true);

console.log(fails.length ? 'FAIL: ' + fails.join('\n  ') : 'ALL PASS (injection, style, language, cause-named failure)');
