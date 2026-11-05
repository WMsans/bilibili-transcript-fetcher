# Bilibili transcript copy

A userscript that puts one pill in a B站 video description, after the 「展开更多」 toggle when a long
description has one and under the text when a short description has no toggle. Click
it and the transcript of the part playing now goes to your clipboard.

![A screenshot from the B站 watch page](img/screenshot.png)

It runs inside the watch page and reuses that tab's cookies, so there is no server to run and no
token to paste in.

## Install

1. Add a userscript manager: [Tampermonkey](https://www.tampermonkey.net/) or
   [Violent Monkey](https://violentmonkey.github.io/).
2. Create a new script and paste all of `bilibili-transcript-fetcher.user.js`, `==UserScript==` header included.
3. Allow the request to visit external sites when the manager asks (the script calls `api.bilibili.com`).
4. Open a `bilibili.com/video/BV…` page in a tab that is logged in.

`@match` covers `www.bilibili.com/video/*`, `/en/video/*` and `bilibili.com/video/*`, so the script
does nothing on any other page.

Where the manager provides `GM_xmlhttpRequest` and `GM_setClipboard`, the script uses them: no CORS,
and the tab's cookies ride along. Otherwise it falls back to `fetch` and
`navigator.clipboard.writeText`.

## Using it

The pill copies the look of the 展开更多 toggle, or of the description block when the page has no
such toggle: same size, spacing and radius. The text colour comes from bilibili's own theme variable
(`--text2`, the one the toggle itself uses) with the computed colour only as a fallback, so the pill
stays readable when the page switches between its light and dark themes without reloading. Bilibili also
rebuilds the whole description block a few seconds after the page loads, and the script re-attaches the pill
when that happens, so it does not vanish once the page settles. The label follows the page language, 字幕
on a Chinese page and Transcript on the English one; with no toggle to read, the English page is the
one served under `/en/video/`.

Click it and:

1. the label changes to 获取… or Fetching…
2. the transcript lands on the clipboard as plain text, one cue per line, timestamps dropped
3. a note under the description reports the character count, which track and which part, then fades
   out after a few seconds
4. the label returns to normal

The part number comes from `?p=`, then from the page state, and is checked against the part list.
When the page state is stale the script asks the part list again instead of assuming P1, and it only
fetches the part playing now.

Track order: `zh-Hans`, `zh-CN`, `ai-zh`, any other `zh…`, then whatever the list has first. The note
says which one was used.

## Messages

| You see | It means |
|---|---|
| `subtitle list empty — this tab is not logged in (AI subtitles also come back empty logged out)` | AI tracks are only listed for a logged-in tab (uploaded CC tracks copy either way). An empty list in a logged-out tab is reported as a login problem, never as a missing subtitle. |
| `no subtitle track for this part` | Logged in, and the part really has none. |
| `B 站 throttled this IP（风控）— retry later` | Risk control answered. The script refreshes its keys, retries once, then stops. |
| `copy failed: <reason>` | Anything else: HTTP status, a body that is not JSON, a refused clipboard. |
| `self-check failed: <case>` | The signing code is wrong. Reported as the page loads, before the button can copy the wrong text. |

## How it works

`window.__INITIAL_STATE__` or `x/web-interface/view` identifies the video (aid, cid, part),
`x/web-interface/nav` supplies the current WBI keys, a signed `x/v2/subtitle/web/view` call returns the
subtitle list as protobuf, and each track body is plain JSON.

That endpoint is the one the player reads its subtitle menu from. `x/player/wbi/v2` still carries a
`subtitle` field, but the player only takes `need_login_subtitle` from that response, and for a
logged-in tab the list there was often empty — the earlier versions read it, which is why a click
sometimes copied nothing and a later click worked. Track URLs in the protobuf come obfuscated as
`//subtitle.bilibili.com/…`; the script reverses that the same way the player does, into an
`aisubtitle.hdslb.com` URL with its `auth_key`.

The signature is the point. Under risk control the unsigned player endpoint answered HTTP 200 with
valid JSON carrying another video's subtitles, and the response gave no hint. When a signature is
rejected (`-352`, `-403`, HTTP 412) the script drops the cached keys and retries once. Keys live for
10 minutes per tab.

No cookie or token is read, printed or stored.
