# dsh-share-import

Import a public DeepSeek chat share link into [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) as a real, resumable Session.

Paste `https://chat.deepseek.com/share/<id>`, pick a workspace, click import. The history lands in the sidebar as a finished conversation with its questions, reasoning, web-search sources and answers — continue it like any other session.

## Why a link instead of a ZIP

DSH's built-in importer (the experimental *DeepSeek chat import* bundle) only reads `deepseek_data-*.zip` exports. This plugin reads the site's public read-only share endpoint `https://chat.deepseek.com/api/v0/share/content?share_id=…`, so no login, no token and no export step is needed.

## Install

Once published to npm:

```bash
dsh plugin --profile desktop add dsh-share-import
```

From a local checkout (the command forwards to pnpm inside the profile):

```bash
dsh plugin --profile desktop add /path/to/dsh-share-import
```

In the app: **Plugins** → **Add plugin**, then pick the directory or the npm package.

## Usage

1. Click the ⤓ button after **New session** in the sidebar.
2. Paste the share link (or just the id).
3. Choose the target workspace and confirm.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxSearchResults` | `8` | Search results kept per recorded search |
| `snippetChars` | `120` | Snippet characters kept per result |
| `maxTitleBytes` | `80` | UTF-8 budget of the imported title |
| `timeoutMs` | `60000` | Share endpoint timeout |

## Limitations

- Public, unexpired shares only.
- Imported history is static: nothing is generated and no turn stays open.
- Search results are trimmed so a 100-turn session does not blow the context window.
- One import at a time; a concurrent request answers `busy`.
- `chat.deepseek.com` only.

## License

MIT. Imported conversations belong to their authors; only import content you may use.
