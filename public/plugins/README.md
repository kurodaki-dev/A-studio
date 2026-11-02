# A Studio plugin catalog

`catalog.json` is the list shown in the app under **Menu, Plugins and themes, Browse the catalog**.

To add your plugin or theme, open a pull request that adds an entry:

```json
{
  "id": "my-synth",
  "name": "My Synth",
  "type": "instrument",
  "author": "Your name",
  "description": "One sentence about what it does.",
  "url": "https://raw.githubusercontent.com/you/your-repo/main/my-synth.astudio-plugin.js"
}
```

- `type` is `instrument`, `effect` or `extension` (themes go in the `themes` list).
- `url` must be a `raw.githubusercontent.com` link to a public file.
- The `id` must match the `@id` in the plugin header.
