# kroger-mcp

An MCP server that organizes grocery lists by aisle using the Kroger Developer API. Designed to run on a Mac Mini and connect to Claude Chat (claude.ai).

## Setup

### 1. Get Kroger API credentials

1. Go to [developer.kroger.com](https://developer.kroger.com) and create an account
2. Create a new application — select the **Products** and **Locations** APIs
3. Copy your **Client ID** and **Client Secret**

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and fill in your KROGER_CLIENT_ID and KROGER_CLIENT_SECRET
```

### 3. Install dependencies and run

```bash
npm install
npm run dev
```

The server starts at `http://localhost:3000`.

## MCP Tools

### `find_kroger_store`
Find nearby Kroger stores by ZIP code.
- **Input:** `zip_code` — 5-digit ZIP code
- **Output:** List of stores with their `locationId`

### `organize_grocery_list`
Look up aisle locations for a list of items and group them by aisle.
- **Input:** `location_id` (from `find_kroger_store`), `items` (array of item names)
- **Output:** Markdown list grouped by aisle number

## Connecting to Claude Chat

### Local (same network)
1. Run `npm run dev`
2. In Claude.ai → Settings → Integrations → Add MCP Server
3. URL: `http://localhost:3000/mcp`

### Remote (HTTPS, for access from anywhere)
1. Point a domain at your Mac Mini's IP
2. Set up nginx as a reverse proxy to port 3000
3. Add a Let's Encrypt certificate (e.g. with `certbot`)
4. Use `https://yourdomain.com/mcp` in Claude.ai

### nginx config snippet
```nginx
location /mcp {
    proxy_pass http://localhost:3000/mcp;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_buffering off;
}
```

## Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

## Usage in Claude Chat

1. "Find Kroger stores near 30301" → Claude calls `find_kroger_store`, shows options with locationIds
2. "Organize my grocery list: milk, eggs, apples, chicken, bread, yogurt" → Claude calls `organize_grocery_list`, returns items grouped by aisle

## Production (Mac Mini auto-start)

Create a launchd plist at `~/Library/LaunchAgents/com.kroger-mcp.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.kroger-mcp</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/kroger-mcp/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/kroger-mcp</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>KROGER_CLIENT_ID</key>
        <string>your_client_id</string>
        <key>KROGER_CLIENT_SECRET</key>
        <string>your_client_secret</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/kroger-mcp.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/kroger-mcp.err</string>
</dict>
</plist>
```

Then: `launchctl load ~/Library/LaunchAgents/com.kroger-mcp.plist`
