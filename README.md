# dsh-share-link-import

Import a public DeepSeek chat share link into [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) as a real, resumable Session.

Paste `https://chat.deepseek.com/share/<id>`, pick a workspace, click import. The history lands in the sidebar as a finished conversation with its questions, reasoning, web-search sources and answers — continue it like any other session.

## Why a link instead of a ZIP

DSH's built-in importer (the experimental *DeepSeek chat import* bundle) only reads `deepseek_data-*.zip` exports. This plugin reads the site's public read-only share endpoint `https://chat.deepseek.com/api/v0/share/content?share_id=…`, so no login, no token and no export step is needed.

## Install

Distributed through [GitHub Releases](https://github.com/FarSunShine/dsh-share-link-import/releases); npm is not required.

### From a release archive

1. Download `dsh-share-link-import-0.1.1.zip` from the latest release.
2. Extract it to a permanent location. DeepSeek Harness links to that directory, so moving or deleting it later breaks the plugin.
3. Open **Plugins** → **Add plugin** and select the extracted `dsh-share-link-import` folder.

### From a local checkout

```bash
dsh plugin --profile desktop add /path/to/dsh-share-link-import
```

### From the Git repository

```bash
dsh plugin --profile desktop add "git+https://github.com/FarSunShine/dsh-share-link-import.git#<40-character-commit>"
```

Pin a full commit; a branch or tag is not treated as updatable.

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

## Related work

[Sillykjs/dsh-share-import](https://github.com/Sillykjs/dsh-share-import) already covers this idea and is more complete in places: it also imports **Doubao** threads, blocks a duplicate import of the same share, and offers a preview step before writing. This package is a narrower, independently written implementation: DeepSeek only, a prebuilt npm package, a sidebar button instead of a nav panel, and trimmed search results so a very long history stays usable. If you want the broader feature set, use that one.

## License

MIT. Imported conversations belong to their authors; only import content you may use.
