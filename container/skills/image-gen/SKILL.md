---
name: image-gen
description: Generate images from a text prompt using Microsoft Copilot / Bing Image Creator. Use whenever the user asks you to create, draw, generate, or make an image, picture, illustration, or artwork. Returns image URLs that render inline in the chat.
allowed-tools: Bash(agent-browser:*)
---

# Image generation via Microsoft Copilot

Generate images by driving https://www.bing.com/images/create through the `agent-browser` skill. The endpoint is Microsoft's free Bing Image Creator (same backend as Copilot Designer). Output is a set of public image URLs — just include them in your reply and the chat UI will render them inline as previews.

## When to use

Invoke whenever the user asks for any of:
- "generate an image of ...", "draw ...", "create a picture of ..."
- "make me an illustration / artwork / logo / poster of ..."
- Any request where an image is the natural response

Do not ask for permission first — just generate.

## Credentials (optional but recommended)

A saved auth state at `/workspace/group/.copilot-auth.json` gives you higher quotas and faster "boosts". If it exists, load it before opening the page:

```bash
if [ -f /workspace/group/.copilot-auth.json ]; then
  agent-browser state load /workspace/group/.copilot-auth.json
fi
```

If it does not exist, you can still generate images anonymously — Bing allows a small number of generations without login. If the page asks you to sign in and env vars `COPILOT_EMAIL` and `COPILOT_PASSWORD` are set, sign in with them, then save the state:

```bash
agent-browser state save /workspace/group/.copilot-auth.json
```

Never echo credentials back to the user.

## Generation flow

1. **Open the creator**
   ```bash
   agent-browser open "https://www.bing.com/images/create"
   agent-browser wait --load networkidle
   ```

2. **Submit the prompt** — find the prompt textbox and the Create button:
   ```bash
   agent-browser snapshot -i
   agent-browser find placeholder "Create" fill "<the user's prompt, verbatim>"
   agent-browser find role button click --name "Create"
   ```
   If those semantic locators miss, fall back to refs from the snapshot.

3. **Wait for results** — Bing shows a loading state, then renders 4 thumbnails. Wait for the results grid:
   ```bash
   agent-browser wait --url "**/images/create/**/1-*"
   agent-browser wait 3000
   ```

4. **Extract the image URLs** — the result thumbnails are `<img>` tags with `src` pointing at `https://tse*.mm.bing.net/th/id/OIG...` or similar. Grab them via JS:
   ```bash
   agent-browser eval "Array.from(document.querySelectorAll('a.iusc img, .mimg')).map(i => i.src).filter(s => s.startsWith('http')).slice(0, 4)"
   ```
   This returns a JSON array of up to 4 URLs.

5. **Reply** — include the URL(s) directly in your text response. No markdown wrapping needed; the chat UI detects bare image URLs and renders them as previews. Example:
   ```
   Here's what I generated:
   https://tse1.mm.bing.net/th/id/OIG.abc123.jpg
   https://tse2.mm.bing.net/th/id/OIG.def456.jpg
   ```

6. **Clean up**
   ```bash
   agent-browser close
   ```

## Failure handling

- If the page shows "Content warning" / prompt rejected: tell the user the prompt was refused by Microsoft's safety filter and suggest a rephrase. Do not retry automatically with a modified prompt unless the user asks.
- If no images appear after 60 seconds: re-snapshot, check for an error banner, and report it.
- If sign-in is required and no credentials are available: report that anonymous quota is exhausted and the user should set `COPILOT_EMAIL` / `COPILOT_PASSWORD` or provide a saved auth state.

## Notes

- Prefer passing the user's prompt verbatim. Only rewrite it if the user explicitly asks for improvements.
- The returned URLs are public CDN links and are safe to share directly.
- Do not save images to disk unless the user asks — the URL is enough for the chat UI to render them.
