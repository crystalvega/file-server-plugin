# Bulwark Webmail - File Server (Mail Drop) Plugin

Official client plugin for **Bulwark Webmail** that enables seamless offloading of large email attachments to a secure, temporary corporate file server with automatic link and PIN code insertion.

---

## 🌟 Features

- **Automatic Interception:** Automatically prompts the user when attaching files exceeding the configured threshold (e.g. 20 MB).
- **Manual Upload Action:** Dedicated **«File Server»** button in the composer toolbar and attachment menu (`📎`).
- **Interactive Multi-File Dialog:** Drag & drop interface, custom or automatic retention duration (up to 28 days), and custom or auto-generated 6-digit PIN code.
- **Rich & Plain Email Snippets:** Automatically embeds a stylized HTML card and a plain-text fallback block with direct download link and access PIN into the email body.
- **Adaptive Bulwark Theming:** Matches Bulwark's native light and dark modes with seamless CSS variable bindings.
- **Full English Localization:** Clean, standardized English UI and settings schemas suitable for public distribution in the Bulwark Plugin Marketplace.

---

## ⚙️ Plugin Configuration

Configurable via **Settings → Plugins → File Server (Mail Drop)**:

| Setting Key | Type | Default | Description |
|---|---|---|---|
| `serverUrl` | `string` | `/file-server` | Endpoint address of the file server (e.g. `/file-server` or `https://mail.example.com/file-server`) |
| `apiKey` | `string` | `""` | Secret token sent via `X-API-Key` to authorize file uploads |
| `sizeThresholdMb` | `number` | `20` | Threshold (in MB) to prompt for file server offload |
| `defaultTtlDays` | `number` | `28` | Default retention period in days (1 to 28) |
| `alwaysAsk` | `boolean` | `true` | Ask for confirmation before uploading large files |

---

## 📦 Building & Installing

### Packaging
```bash
zip -r file-server-drop.zip manifest.json index.js README.md
```

### Installation in Bulwark
1. In Bulwark Webmail, go to **Admin Dashboard → Plugins**.
2. Click **Add Plugin** and upload `file-server-drop.zip`.
3. Enable the plugin and configure the `serverUrl` and `apiKey` matching your file server instance.

---

## 📄 License
MIT License.
