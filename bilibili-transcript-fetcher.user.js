// ==UserScript==
// @name         Bilibili transcript copy
// @name:zh-CN   B 站 transcript → clipboard
// @namespace    https://github.com/jeremy/bilibili-transcript-fetcher
// @version      0.1
// @description  Add a pill next to the 「展开」/Expand More toggle in the description. One click: fetch the transcript of the part playing now, copy it to the clipboard, report what was copied (no timestamps).
// @match        *://www.bilibili.com/video/*
// @match        *://www.bilibili.com/en/video/*
// @match        *://bilibili.com/video/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
'use strict';

// MD5 constants are RFC 1321-derived; Math.sin() at runtime is engine-precision-dependent
// (V8 is off by 1 ulp at i=49), which would silently sign wrong.
const K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
];
const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

function rotl(x, c) { return (x << c) | (x >>> (32 - c)); }

function md5(text) {
  const bytes = new TextEncoder().encode(String(text));
  const len = bytes.length;
  const words = new Int32Array(((len + 9 + 63) >> 6) << 4);
  for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << ((i & 3) << 3);
  words[len >> 2] |= 0x80 << ((len & 3) << 3);
  words[words.length - 2] = (len << 3) | 0;
  words[words.length - 1] = (len >>> 29) | 0;

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let block = 0; block < words.length; block += 16) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      F = (F + A + K[i] + words[block + g]) | 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, SHIFTS[(i >> 4) * 4 + (i & 3)])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  let out = '';
  for (const w of [a0, b0, c0, d0])
    for (let i = 0; i < 4; i++) out += (((w >>> (i * 8)) & 0xff).toString(16)).padStart(2, '0');
  return out;
}

const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54,
  21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
];

function mixinKey(orig) { return MIXIN_TAB.map((n) => orig[n]).join('').slice(0, 32); }

// Mirrors bilibili's rule: wts added, keys sorted, !"()'" and * removed from values before hashing.
function signedQuery(params, mixin) {
  const withTime = { wts: Math.round(Date.now() / 1000) };
  for (const k of Object.keys(params)) {
    const v = params[k];
    if (v !== undefined && v !== null && v !== '') withTime[k] = v; // empty params must not sign as "undefined"
  }
  const qs = Object.keys(withTime).sort().map(
    (k) => encodeURIComponent(k) + '=' + encodeURIComponent(
      String(withTime[k]).replace(/[!'()*]/g, ''))
  ).join('&');
  return { query: qs, wRid: md5(qs + mixin) };
}

// A broken MD5 or mixin table must not fail as "no subtitles" — it fails the moment the page loads.
let broken = null;
(function selfCheck() {
  const alpha = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ#$';
  const m = mixinKey(alpha);
  // vectors cross-checked against python hashlib (multibyte input included), so a wrong
  // constant table or a broken query builder cannot masquerade as "no subtitles"
  const checks = [
    ['md5 empty', md5('') === 'd41d8cd98f00b204e9800998ecf8427e'],
    ['md5 abc', md5('abc') === '900150983cd24fb0d6963f7d28e17f72'],
    ['md5 fox', md5('The quick brown fox jumps over the lazy dog') === '9e107d9d372bb6826bd81d3542a419d6'],
    ['md5 utf8', md5('字幕 中文 1234567890') === 'bb0da60e24c06c7b62b5c15e49688bd1'],
    ['mixin length', m.length === 32 && /^[0-9a-zA-Z#$]{32}$/.test(m)],
    ['mixin first char', m[0] === alpha[MIXIN_TAB[0]]],
    ['wbi md5 over query', md5('aid=80433022&cid=137649199&wts=1700000000' + 'm'.repeat(32)) === '056b88ba3883a140ae5d99884774a227']
  ];
  for (const [label, ok] of checks) if (!ok) { broken = 'self-check failed: ' + label; break; }
  if (broken) console.error('[transcript copy] ' + broken);
})();

const API = 'https://api.bilibili.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// GM_xmlhttpRequest bypasses CORS and rides the tab's cookies for api.bilibili.com;
// in-page fetch is the fallback for managers without it (CORS is open for this origin, but the
// subtitle CDN was never verified here, so GM is tried first when it exists).
async function get(url) {
  if (typeof GM_xmlhttpRequest === 'function') {
    const r = await new Promise((done, fail) => {
      GM_xmlhttpRequest({
        method: 'GET', url, timeout: 15000,
        headers: { Accept: 'application/json,text/plain,*/*', 'User-Agent': UA, Referer: 'https://www.bilibili.com/' },
        onload: done, onerror: () => fail(new Error('network error')),
        ontimeout: () => fail(new Error('timeout'))
      });
    });
    if (r.status === 412) throw new Error('throttled');
    if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
    return r.responseText;
  }
  const res = await fetch(url, { credentials: 'include' });
  if (res.status === 412) throw new Error('throttled');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.text();
}

async function getJson(url) {
  const text = await get(url);
  try { return JSON.parse(text); } catch (e) { throw new Error('non-JSON response'); }
}

const cache = { mixin: null, at: 0, login: false };
async function wbiKeys() {
  if (cache.mixin && Date.now() - cache.at < 10 * 60 * 1000) return cache;
  const nav = await getJson(API + '/x/web-interface/nav');
  const img = nav.data && nav.data.wbi_img && nav.data.wbi_img.img_url;
  const sub = nav.data && nav.data.wbi_img && nav.data.wbi_img.sub_url;
  if (!img || !sub) throw new Error('nav returned no wbi keys');
  const key = (u) => u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('.'));
  cache.mixin = mixinKey(key(img) + key(sub));
  cache.at = Date.now();
  cache.login = Boolean(nav.data && nav.data.isLogin);
  return cache;
}

// aid/cid/pages come from the page's own state (no request); it can lag a part switch, so a
// bvid mismatch or a missing part number goes to the pagelist API rather than guessing P1.
async function context() {
  const href = location.href;
  const bv = (href.match(/BV[0-9A-Za-z]{10}/) || [])[0];
  if (!bv) throw new Error('not a video page');
  const wanted = Number(new URL(href).searchParams.get('p')) ||
    (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.p) || 1;

  const st = window.__INITIAL_STATE__;
  const vd = st && st.videoData;
  const pages = vd && Array.isArray(vd.pages) ? vd.pages : null;
  if (vd && vd.bvid === bv && pages) {
    const found = pages.find((x) => Number(x.page) === wanted) || (wanted === 1 ? pages[0] : null);
    if (found && (found.cid || vd.cid)) {
      return { bvid: bv, aid: vd.aid, cid: Number(found.cid || vd.cid), page: wanted,
        pageCount: pages.length, part: found.part || '' };
    }
  }
  const data = await getJson(API + '/x/player/pagelist?bvid=' + encodeURIComponent(bv));
  if (data.code !== 0 || !data.data || !data.data.length) throw new Error('pagelist failed: ' + data.code);
  const list = data.data;
  const found = list.find((x) => Number(x.page) === wanted) || (wanted === 1 ? list[0] : null);
  if (!found) throw new Error('part ' + wanted + ' does not exist (this video has ' + list.length + ')');
  return { bvid: bv, cid: found.cid, page: wanted, pageCount: list.length,
    part: found.part || '' };
}

async function tracks(ctx) {
  let keys = await wbiKeys();
  let j = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = signedQuery({ bvid: ctx.bvid, aid: ctx.aid, cid: ctx.cid }, keys.mixin);
    try {
      j = await getJson(API + '/x/player/wbi/v2?' + s.query + '&w_rid=' + s.wRid);
    } catch (e) {
      if (String(e.message).indexOf('throttled') >= 0) {
        if (attempt === 0) { cache.mixin = null; keys = await wbiKeys(); continue; }
        throw new Error('throttled');
      }
      throw e;
    }
    if (j.code === -352 || j.code === -403) {
      if (attempt === 0) { cache.mixin = null; keys = await wbiKeys(); continue; }
      throw new Error('signature rejected: ' + j.code);
    }
    break;
  }
  if (j.code !== 0) throw new Error('player API: ' + j.code + ' ' + (j.message || ''));
  const subs = j.data && j.data.subtitle && j.data.subtitle.subtitles;
  return Array.isArray(subs) ? subs.filter((t) => t.subtitle_url || t.subtitle_url_v2) : [];
}

function pickTrack(tracks) {
  const by = (lan) => tracks.find((t) => t.lan === lan);
  return by('zh-Hans') || by('zh-CN') || by('ai-zh') ||
    tracks.find((t) => (t.lan || '').indexOf('zh') === 0) || tracks[0];
}

async function cues(track) {
  const raw = track.subtitle_url || track.subtitle_url_v2;
  const url = raw.indexOf('//') === 0 ? 'https:' + raw : raw;
  const text = await get(url);
  if (text.trim()[0] !== '{') throw new Error('track body is not JSON');
  const body = JSON.parse(text);
  return (body && Array.isArray(body.body)) ? body.body : [];
}

function copyText(text) {
  if (typeof GM_setClipboard === 'function') { GM_setClipboard(text); return Promise.resolve(true); }
  return navigator.clipboard.writeText(text);
}

function host() { return document.querySelector('#v_desc') || document.querySelector('.video-desc-container'); }

let pill = null, pillHost = null;

function build() {
  const h = host();
  if (!h) return;
  const toggle = h.querySelector('.toggle-btn');
  const hidden = getComputedStyle(h).display === 'none'; // an empty description hides #v_desc itself
  // a description short enough to fit has no 「展开」toggle at all, so anchor on the block, not the toggle
  const at = toggle ? toggle.parentNode : (hidden && h.parentNode ? h.parentNode : h);
  if (pill && pillHost === at && document.contains(pill)) return; // ours is still in the live document
  if (pill) pill.remove(); // host rebuilt around our old copy: drop it, do not leave a second pill
  const ref = h.querySelector('.toggle-btn-text') || toggle || h;
  const cs = getComputedStyle(ref); // look like the existing toggle, do not invent a style
  // no toggle to read the language off: shortcut: the /en/video/ route is the only signal then, upgrade
  // if bilibili ever ships an English UI on the plain route
  // bilibili repaints a theme by swapping its theme stylesheet (link#__css_map__: light.css <-> dark.css),
  // which changes the :root vars but not colours frozen here at build time; the no-toggle fallback reads
  // body{color:#222} from video.css, a hardcoded grey that stays dark on a dark page. --text2 is the rule
  // video.css gives .toggle-btn-text itself, so the pill follows the live theme; computed value is only the fallback.
  const ink = 'var(--text2,' + (cs.color || 'currentColor') + ')';
  const cn = toggle ? /[\u4e00-\u9fff]/.test(ref.textContent || '') : !/^\/en\//.test(location.pathname);
  const T = cn
    ? { label: '字幕', fetching: '获取…', tip: "copy this part's transcript",
      copied: (n, d, p) => '✓ ' + n + ' 字符 copied — ' + d + ' · ' + p,
      needLogin: '字幕 list empty — this tab is not logged in (AI subtitles also come back empty logged out)',
      noTrack: 'no subtitle track for this part',
      throttled: 'B 站 throttled this IP（风控）— retry later',
      failed: (e) => 'copy failed: ' + e }
    : { label: 'Transcript', fetching: 'Fetching…', tip: "copy this part's transcript",
      copied: (n, d, p) => '✓ ' + n + ' characters copied — ' + d + ' · ' + p,
      needLogin: 'subtitle list empty — this tab is not logged in (AI subtitles also come back empty logged out)',
      noTrack: 'no subtitle track for this part',
      throttled: 'Bilibili throttled this IP — retry later',
      failed: (e) => 'copy failed: ' + e };

  const el = document.createElement('span');
  el.textContent = T.label;
  el.title = T.tip;
  [
    ['display', 'inline-block'], ['background-color', cs.backgroundColor], ['color', ink],
    ['font-size', cs.fontSize], ['font-family', cs.fontFamily], ['padding', cs.padding],
    ['border-radius', cs.borderRadius], ['line-height', cs.lineHeight], ['cursor', 'pointer'],
    ['box-sizing', 'border-box']
  ].forEach((p) => { if (p[1]) el.style[p[0]] = p[1]; });

  if (toggle) at.insertBefore(el, toggle.nextSibling); // insertBefore(x, null) appends, as before
  else if (hidden) at.insertBefore(el, h.nextSibling); // inside a display:none parent nothing renders
  else at.appendChild(el);
  pill = el;
  pillHost = at;

  const note = (line, ms) => {
    const box = document.createElement('div');
    box.textContent = line;
    box.style.cssText = 'display:block;margin-top:8px;padding:' + cs.padding + ';border-radius:' +
      cs.borderRadius + ';font-size:' + cs.fontSize + ';background:' + cs.backgroundColor +
      ';color:' + ink + ';white-space:pre-wrap';
    pillHost.appendChild(box);
    setTimeout(() => box.remove(), ms);
  };
  el.addEventListener('click', () => run(el, T, note));
}

function failLine(T, msg) {
  if (msg.indexOf('throttled') >= 0) return T.throttled;
  if (msg === 'no-track') return T.noTrack;
  if (msg === 'need-login') return T.needLogin;
  return T.failed ? T.failed(msg) : msg;
}

async function run(el, T, note) {
  if (broken) { note(broken, 8000); return; }
  el.textContent = T.fetching;
  try {
    const ctx = await context();
    const list = await tracks(ctx);
    if (!list.length) {
      const keys = await wbiKeys(); // already cached by tracks(); this only reads isLogin
      throw new Error(keys.login ? 'no-track' : 'need-login');
    }
    const track = pickTrack(list);
    const lines = (await cues(track)).map((c) => (c.content || '').replace(/\s+/g, ' ').trim());
    const text = lines.filter((x) => x).join('\n');
    if (!text) throw new Error('no-track');
    await copyText(text);
    const part = ctx.pageCount > 1 ? 'P' + ctx.page + '/' + ctx.pageCount : 'P1';
    note(T.copied(text.length, track.lan_doc || track.lan || '?', part), 6000);
  } catch (e) {
    note(failLine(T, String(e.message)), 6000);
  }
  el.textContent = T.label;
}

build();
// bilibili replaces #v_desc wholesale (same id, brand-new node) a few seconds into its own render pass —
// observed at t=3s on a live watch page — which orphans a pill inserted before the swap. build() no-ops
// while our pill is in the live document, so this interval re-attaches it after each such rewrite;
// the old one-shot retry gave up as soon as any pill had been built, which is why it showed only during load.
setInterval(build, 500);
})();
