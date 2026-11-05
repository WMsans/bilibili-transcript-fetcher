// Self-test for bilibili-transcript-fetcher.user.js without a browser.
// Runs the SHIPPED source unmodified against a minimal DOM stub, then clicks the pill
// (logged out: a CC track still copies; an AI-only part must end in the "not logged in" note, not "no subtitles").
import fs from 'node:fs';
const src = fs.readFileSync('bilibili-transcript-fetcher.user.js', 'utf8');

const Style = () => { const m = {}; return new Proxy({}, { set: (t, k, v) => { m[k] = v; return true; }, get: (t, k) => m[k] }); };
const CJK = /[\u4e00-\u9fff]/;

function El(tag, cls = '', txt = '', id = '') {
  const t = { tag, className: cls, id, title: '', text: txt, children: [], parent: null, style: Style(), cssText: '', listeners: {} };
  let self;
  self = new Proxy(t, {
    get: (o, k) => {
      if (k === 'textContent') return o.text;
      if (k === 'style') return o.style;
      if (k === 'appendChild') return (c) => { c.parent = self; o.children.push(c); return c; };
      if (k === 'remove') return () => { if (o.parent) o.parent.children = o.parent.children.filter((c) => c !== self); };
      if (k === 'addEventListener') return (type, fn) => { o.listeners[type] = fn; };
      if (k === 'nextSibling') return null;
      if (k === 'insertBefore') return (n, ref) => {
        n.parent = self;
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
  return self;
}

const GREY = { backgroundColor: 'rgb(244, 245, 246)', color: 'rgb(97, 101, 106)', fontSize: '13px', fontFamily: 'Arial', padding: '4px 10px', borderRadius: '4px', lineHeight: '18px' };
const fails = [];
const check = (label, cond) => { if (!cond) fails.push(label); };

async function scenario(scenarioNo, href, state, toggleText, expectNote, hidden, stub) {
  const wrap = El('div', 'left-container');
  const desc = El('div', 'video-desc-container', '', 'v_desc');
  desc.hidden = hidden; desc.parent = wrap; wrap.children.push(desc);
  const info = El('div', 'basic-desc-info'); info.parent = desc; desc.children.push(info);
  const toggle = toggleText === null ? null : El('div', 'toggle-btn', toggleText);
  if (toggle) { toggle.parent = desc; desc.children.push(toggle); }

  const body = El('body'); wrap.parent = body;
  let liveDesc = desc;
  const inDoc = (n) => { for (let p = n; p; p = p.parent) if (p === body) return true; return false; };
  global.document = { body, querySelector: (sel) => liveDesc, createElement: (tag) => El(tag), contains: inDoc };
  const ticks = [];
  const setInterval = (fn, ms) => { ticks.push(fn); }; // shadow only for eval(src); undici needs the real one
  const tick = (n) => { for (let i = 0; i < n; i++) ticks.forEach((fn) => fn()); };
  global.window = { __INITIAL_STATE__: state };
  global.location = { href, pathname: new URL(href).pathname };
  if (!navigator.clipboard) navigator.clipboard = { writeText: (t) => Promise.resolve(true) };
  let copied = null;
  navigator.clipboard.writeText = (t) => { copied = t; return Promise.resolve(true); };
  global.getComputedStyle = (e) => e && e.hidden ? { ...GREY, display: 'none' } : GREY;

  const realFetch = globalThis.fetch;
  globalThis.fetch = stub || ((url, o) => { console.log('FETCH', String(url).slice(0,120)); return realFetch(url, o).catch((e) => { console.log('FETCH-ERR', String(url).slice(0,120), e.message, (e.cause && e.cause.message) || ''); throw e; }); });
  eval(src);

  console.log('SCENARIO', scenarioNo);
  const pill = desc.children.concat(wrap.children).find((c) => c.style['display'] === 'inline-block');
  check('pill injected', !!pill);
  if (!pill) return;
  const cnUi = toggleText === null ? !/\/en\//.test(new URL(href).pathname) : CJK.test(toggleText);
  check('label follows the page language', pill.text === (cnUi ? '字幕' : 'Transcript'));
  check('style copied verbatim from the toggle, colour live-tracked via the theme var',
    pill.style['background-color'] === GREY.backgroundColor &&
    pill.style['color'] === 'var(--text2,' + GREY.color + ')' &&
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
  check('the note keeps the same live colour', note && /var\(--text2,/.test(note.style.cssText));

  // bilibili swaps in a brand-new #v_desc node a few seconds into its own render (observed t=3s on a live
  // page): the pill must follow the replacement, and its old copy must not stay behind in the detached node.
  const desc2 = El('div', 'video-desc-container', '', 'v_desc');
  desc.parent = null; desc2.parent = wrap; wrap.children.push(desc2); liveDesc = desc2;
  tick(3);
  const pills = desc2.children.concat(wrap.children).filter((c) => c.style['display'] === 'inline-block');
  check('re-attached to the replacement node (got: ' + pills.length + ')', pills.length === 1 && pills[0] !== pill);
  check('old copy dropped from wherever it sat (got: ' + (desc.children.includes(pill)) + '/' + wrap.children.includes(pill) + ')',
    !desc.children.includes(pill) && !wrap.children.includes(pill));

  globalThis.fetch = realFetch;
  return { notes, copied };
}

const bv = 'BV1REx46NEc4';
// 1) English UI, part 1, state matches the URL
await scenario(1, `https://www.bilibili.com/video/${bv}/?p=1`,
  { p: 1, videoData: { bvid: bv, aid: 80433022, cid: 137649199, pages: [{ page: 1, cid: 137649199, part: 'p1' }] } },
  'Expand More',
  // aid 80433022 has an uploaded (CC) track, which /x/v2/subtitle/web/view serves even logged out
  '✓ 515 characters copied — 中文（简体） · P1');

// 2) Chinese UI, part 2, stale state (bvid mismatch) must fall back to pagelist, not guess P1
await scenario(2, 'https://www.bilibili.com/video/BV1i24P6rEmt/?p=2',
  { p: 1, videoData: { bvid: 'BV1WRONGbvi', aid: 1, cid: 1, pages: [{ page: 1, cid: 1, part: 'p1' }] } },
  '展开',
  '字幕 list empty — this tab is not logged in (AI subtitles also come back empty logged out)');

// 3) short description: no .toggle-btn at all -> pill must still land, inside the description block
await scenario(3, `https://www.bilibili.com/video/${bv}/?p=1`,
  { p: 1, videoData: { bvid: bv, aid: 80433022, cid: 137649199, pages: [{ page: 1, cid: 137649199, part: 'p1' }] } },
  null,
  '✓ 515 字符 copied — 中文（简体） · P1');

// 4) empty description: #v_desc is display:none -> pill must go next to it, where it can be clicked
await scenario(4, 'https://www.bilibili.com/en/video/BV1hV4P6PEc3/',
  { p: 1, videoData: { bvid: 'BV1hV4P6PEc3', aid: 1, cid: 1, pages: [{ page: 1, cid: 1, part: 'p1' }] } },
  null,
  'subtitle list empty — this tab is not logged in (AI subtitles also come back empty logged out)',
  true);

// 5) logged in, in a userscript sandbox (no page state, so no aid) — the player's own path: the track list
//    lives only in the protobuf /x/v2/subtitle/web/view; /x/player/wbi/v2's subtitle field is one the player
//    no longer reads and here stays empty. Its URL is the obfuscated //subtitle.bilibili.com form.
{
  const bv5 = 'BV1wNxf6NExK', aid5 = 117561542840491, cid5 = 43340074725;
  const seen = [];
  const reply = (body) => ({ status: 200, ok: true, text: async () => JSON.stringify(body) });
  const bin = (bytes) => ({ status: 200, ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    text: async () => new TextDecoder().decode(bytes) });
  const vint = (n) => { const o = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return o; };
  const fld = (f, bytes) => [...vint(f * 8 + 2), ...vint(bytes.length), ...bytes];
  const str = (f, s) => fld(f, [...new TextEncoder().encode(s)]);
  // the player's own obfuscation, inverted: XOR(prefix + path, key + "bilibili"), then URI-encoded
  const prefix = 'nP](wOFRvU.+<fjS{jn-!$D|Dz&",zT`', key = '=CFxYRn{.y|uVyO$uh&sikph?N.ilF/`' + 'bilibili';
  const plain = prefix + '/bfs/ai_subtitle/prod/1175615428404914334007472577d8.json';
  let x = ''; for (let i = 0; i < plain.length; i++) x += String.fromCharCode(plain.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  const obf = '//subtitle.bilibili.com/' + encodeURIComponent(x) + '?auth_key=1793900000-abc-0-def';
  const item = [0x08, ...vint(1793900000123), ...str(3, 'ai-zh'), ...str(4, '中文（自动生成）'), ...str(5, obf), 0x38, 1];
  const pb = new Uint8Array(fld(1, [...str(1, ''), ...fld(3, item), ...fld(4, [9, 0, 0, 0, 0, 0, 0, 0, 0])]));
  const stub = (url) => {
    const u = String(url);
    seen.push(u);
    if (u.includes('/x/web-interface/nav')) return Promise.resolve(reply({ code: 0, data: { isLogin: true,
      wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
        sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } } }));
    if (u.includes('/x/web-interface/view?')) return Promise.resolve(reply({ code: 0, data: { aid: aid5,
      pages: [{ page: 1, cid: cid5, part: 'p1' }] } }));
    if (u.includes('/x/player/wbi/v2')) return Promise.resolve(reply({ code: 0, data: { subtitle: { subtitles: [] } } }));
    if (u.includes('/x/v2/subtitle/web/view')) return Promise.resolve(bin(pb));
    if (u.startsWith('https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1175615428404914334007472577d8.json?auth_key=1793900000-abc-0-def'))
      return Promise.resolve(reply({ body: [{ content: ' hello   world ' }, { content: '' }, { content: '\u7b2c\u4e8c\u53e5' }] }));
    return Promise.reject(new Error('unexpected ' + u));
  };
  const out = await scenario(5, `https://www.bilibili.com/video/${bv5}/?p=1`, undefined,
    'Expand More', '\u2713 15 characters copied \u2014 中文（自动生成） \u00b7 P1', false, stub);
  const sv = seen.find((u) => u.includes('/x/v2/subtitle/web/view')) || '';
  check('the first click copies the transcript (got: ' + JSON.stringify(out && out.copied) + ')',
    out && out.copied === 'hello world\n\u7b2c\u4e8c\u53e5');
  check('the track list comes from the endpoint the player uses, signed, with oid/pid (got: ' + sv + ')',
    new RegExp('oid=' + cid5).test(sv) && new RegExp('pid=' + aid5).test(sv) && /type=1/.test(sv) && /w_rid=[0-9a-f]{32}/.test(sv));
}

console.log(fails.length ? 'FAIL: ' + fails.join('\n  ') : 'ALL PASS (injection, style, language, cause-named failure, player subtitle endpoint)');
