# Bilibili transcript copy

A browser userscript that puts a small pill right after the 「展开」 / "Expand More" toggle in a
B站 video description. One click copies the transcript of the part currently playing to your
clipboard, and tells you what it copied.

No server, no extension to install, no tokens: it runs inside the watch page and reuses that tab's
cookies.

## Install

1. Add a userscript manager — [Tampermonkey](https://www.tampermonkey.net/) or
   [Violent Monkey](https://violentmonkey.github.io/).
2. Paste the whole of `bilibili-transcript-fetcher.user.js` (the `==UserScript==` header included) as a new script.
3. Open any `bilibili.com/video/BV…` page **in a logged-in tab** and click the pill.

The `@match` lines only cover `www.bilibili.com/video/*`, `/en/video/*` and `bilibili.com/video/*`,
so the script is inert everywhere else.

Tampermonkey's `GM_xmlhttpRequest` and `GM_setClipboard` are preferred when the manager provides
them (no CORS, carries the tab's cookies); without them the script falls back to in-page
`fetch` and `navigator.clipboard.writeText`.

## Using it

The pill looks like the toggle next to it, byte-for-byte — same background, text colour, size,
radius. Its label follows the page language: `字幕` on a Chinese page, `Transcript` on an English one.

Click it:

1. The pill's words swap to `获取…` / `Fetching…`.
2. Allow all visit to external sites.
3. The transcript is copied to the clipboard as plain text, **one cue per line, no timestamps**.
4. A note appears under the description, e.g. `✓ 4310 characters copied — zh-CN · P2/5`, and fades after 6 seconds.
5. The pill returns to its normal label.

The part number is read from the URL (`?p=`), then from the page's own state, and re-checked against
the part list; a mismatch falls back to a fresh part-list lookup rather than guessing P1. Only that
part is fetched.

Track preference: `zh-Hans` → `zh-CN` → `ai-zh` → any other `zh…` → whatever the list has first.
The note reports which one was used.

## Messages

| You see | It means |
|---|---|
| `subtitle list empty — this tab is not logged in (…)` | Login-gated tracks (AI subtitles) come back empty when logged out, so an empty list is reported as a login problem, never as "this video has no subtitles". |
| `no subtitle track for this part` | Logged in, and the part genuinely has no track. |
| `B 站 throttled this IP（风控）— retry later` | Risk control answered. One retry is made with refreshed keys, then it stops. |
| `copy failed: <reason>` | Anything else — HTTP status, non-JSON body, clipboard refused. |
| `self-check failed: <case>` | The signing code is broken. Reported the moment the page loads; the button is never allowed to quietly copy the wrong text. |

## How it works

`window.__INITIAL_STATE__` / part list → `x/web-interface/nav` for the current WBI keys → signed
`x/player/wbi/v2` request (MD5 + mixin over the sorted query) → subtitle body JSON.

Signed requests are deliberate: the unsigned player endpoint answers HTTP 200 with valid JSON
carrying *another* video's subtitles when risk-controlled, which is indistinguishable from a good
fetch. Signature rejection (`-352`, `-403`, HTTP 412) drops the cached keys and retries once — no
retry loop. WBI keys are cached for 10 minutes per tab.

Nothing is sent that the page doesn't already know, nothing is stored, and no cookie or token is
ever read or printed.
