# Share templates

`templates.json` controls how posts look on Telegram and LinkedIn. It is read on every share, so edits apply without restarting the server.

There is one template per network and post type: `telegram.short`, `telegram.article`, `linkedin.short`, `linkedin.article`. `locale` sets the language of `{date}`.

## Placeholders

| Placeholder | Value |
|---|---|
| `{title}` | Post header |
| `{body}` | Post body, keeping its bold, italic and links |
| `{excerpt}` | First ~200 characters of the body as plain text |
| `{date}` | Publish date, for example "October 2, 2026" |
| `{link}` | Link to open. On Telegram this is the Instant View link when `TELEGRAM_IV_RHASH` is set |
| `{url}` | Plain link to the post on the site |

`{link}` and `{url}` are empty when `SITE_URL` is not set in `.env`.

## Showing a part only when it has a value

`{?name}...{/name}` keeps everything inside only if `name` is not empty:

```
{?title}<b>{title}</b>\n\n{/title}{body}
{?link}<a href="{link}">Read the post</a>{/link}
```

## Formatting tags

| Tag | Telegram | LinkedIn |
|---|---|---|
| `<b>` | bold | 𝗯𝗼𝗹𝗱 letters |
| `<i>` | italic | 𝘪𝘵𝘢𝘭𝘪𝘤 letters |
| `<u>` | underline | plain |
| `<s>` | strikethrough | plain |
| `<code>`, `<pre>` | monospace | 𝚖𝚘𝚗𝚘 letters |
| `<blockquote>` | quote block | plain |
| `<blockquote expandable>` | collapsible quote | plain |
| `<tg-spoiler>` | hidden until tapped | plain |
| `<a href="...">` | link | text followed by the URL in brackets |

`\n` in the JSON string is a line break. More than one empty line in a row is collapsed into one.

## Letter styles

Add `:style` to a placeholder to change its letters, for example `{title:sans-bold}`. Several styles can be chained: `{title:upper,sans-bold}`.

| Style | Example |
|---|---|
| `upper` / `lower` | HELLO / hello |
| `bold` | 𝐇𝐞𝐥𝐥𝐨 |
| `italic` | 𝐻𝑒𝑙𝑙𝑜 |
| `bold-italic` | 𝑯𝒆𝒍𝒍𝒐 |
| `sans` | 𝖧𝖾𝗅𝗅𝗈 |
| `sans-bold` | 𝗛𝗲𝗹𝗹𝗼 |
| `sans-italic` | 𝘏𝘦𝘭𝘭𝘰 |
| `sans-bold-italic` | 𝙃𝙚𝙡𝙡𝙤 |
| `mono` | 𝙷𝚎𝚕𝚕𝚘 |
| `script` | 𝓗𝓮𝓵𝓵𝓸 |
| `double` | ℍ𝕖𝕝𝕝𝕠 |

These are special Unicode characters, not real fonts. They exist only for Latin letters (and digits for some styles); Cyrillic and other scripts stay unchanged. Screen readers and search may not read them as normal text.

## Telegram-only options

- `preview`: `false` turns off link previews. An object such as `{ "large": true, "above": false }` shows a preview, with a large image, above or below the text.
- `captionAbove` (short posts): `true` puts the text above the images, `false` below.
