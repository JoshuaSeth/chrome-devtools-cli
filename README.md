# Chrome DevTools CLI

CLI-first fork of `ChromeDevTools/chrome-devtools-mcp`.

`chrome_devtools` lets your scripts, CLIs, and coding agents control and inspect a live Chrome browser using the same
toolset as upstream, but **without requiring an MCP client/server integration**. This is designed for environments like
Codex CLI and Claude “skills” that can shell out to a command.

## [Tool reference](./docs/tool-reference.md) | [Changelog](./CHANGELOG.md) | [Contributing](./CONTRIBUTING.md) | [Troubleshooting](./docs/troubleshooting.md) | [Design Principles](./docs/design-principles.md)

## Fork goals (CLI-first, MCP optional)

**What changed vs upstream**

- All upstream tools are exposed as direct CLI subcommands (plus PitchAI extras).
- MCP server mode is still available via `chrome_devtools mcp`, but it is no longer the default path.

### Install & use from any repo

Install once (recommended):

```bash
# in your project
npm i -D github:JoshuaSeth/chrome-devtools-cli

# then run
npx chrome_devtools --help
```

Or run one-off without installing:

```bash
npx -y --package github:JoshuaSeth/chrome-devtools-cli chrome_devtools --help
```

### Quickstart (local checkout)

```bash
# build once
npm ci
npm run build

# list available tools
npx -y . list-tools

# run a tool once (starts its own browser session)
npx -y . take_snapshot
```

### Direct tool calls (one-shot)

Every tool name is a direct command:

```bash
chrome_devtools <tool-name> [tool args] [browser/session options]
```

Example:

```bash
chrome_devtools list_pages
```

### Stateful session (recommended for multi-step flows)

One-shot calls start a fresh browser/context each time, so snapshot `uid`s are not reusable between commands.
Use `session` to keep state and call multiple tools over stdin/stdout.

```bash
chrome_devtools session --headless --isolated --format text

# then send CLI lines like:
# list_pages
# take_snapshot
# click <uid from take_snapshot>
```

### All direct tool commands

<!-- BEGIN AUTO GENERATED CLI COMMANDS -->

These commands are generated from the tool definitions. Replace placeholders like `<uid>` and `<insightSetId>`.

For multi-step flows (required for `<uid>`-based tools), start a single browser session:

```bash
chrome_devtools session --headless --isolated --format text
```

Then run tools as direct commands (you can paste the same lines into `session`; the `chrome_devtools` prefix is optional):

#### Input automation

```bash
chrome_devtools click <uid>
chrome_devtools drag <uid> <uid>
chrome_devtools fill <uid> "Example text"
chrome_devtools fill_form --elements '[{"uid":"<uid>","value":"Example text"}]'
chrome_devtools handle_dialog accept
chrome_devtools hover <uid>
chrome_devtools press_key Enter
chrome_devtools upload_file <uid> /absolute/path/to/file
```

#### Navigation automation

```bash
chrome_devtools close_page 2
chrome_devtools list_pages
chrome_devtools navigate_page --url https://example.com
chrome_devtools new_page https://example.com
chrome_devtools select_page 1
chrome_devtools wait_for "Example text"
```

#### Emulation

```bash
chrome_devtools emulate --networkConditions "Slow 3G" --cpuThrottlingRate 4
chrome_devtools resize_page 1280 720
```

#### Performance

```bash
chrome_devtools performance_analyze_insight <insightSetId> LCPBreakdown
chrome_devtools performance_get_event_by_key r-123
chrome_devtools performance_get_main_thread_track_summary 0 1000000
chrome_devtools performance_get_network_track_summary 0 1000000
chrome_devtools performance_start_trace --reload --autoStop
chrome_devtools performance_stop_trace
```

#### Network

```bash
chrome_devtools get_network_request --reqid 1
chrome_devtools list_network_requests --pageSize 25 --pageIdx 0
```

#### Debugging

```bash
chrome_devtools evaluate_script "() => document.title"
chrome_devtools get_console_message 1
chrome_devtools list_console_messages --pageSize 25 --pageIdx 0
chrome_devtools take_change_snapshot --baselineKey default
chrome_devtools take_screenshot --fullPage
chrome_devtools take_snapshot --no-verbose
```

<!-- END AUTO GENERATED CLI COMMANDS -->

### PitchAI-added tools & commands

#### `session` (CLI command)

Stateful runner for calling multiple tools in one browser/context (accepts JSON lines or CLI lines):

```bash
chrome_devtools session --headless --isolated --format text

# then send CLI lines like:
# list_pages
# take_snapshot
# click <uid from take_snapshot>

# (or JSON lines like {"tool":"click","params":{"uid":"<uid>"}})
```

#### `take_change_snapshot` (tool)

Diff-only AX snapshot for dynamic UIs (baseline is stored in-memory, so this needs `session`):

```bash
take_change_snapshot --baselineKey default --replaceBaseline
wait_for "Loaded"
take_change_snapshot --baselineKey default --replaceBaseline
```

#### Extra performance trace helpers (tools)

These require a previously recorded trace in the same `session`:

```bash
performance_start_trace --reload --autoStop
performance_analyze_insight <insightSetId> LCPBreakdown
performance_get_event_by_key r-123
performance_get_main_thread_track_summary 0 1000000
performance_get_network_track_summary 0 1000000
```

### Legacy MCP server mode (optional)

Start the MCP server:

```bash
chrome_devtools mcp --headless --isolated
```

## Key features

- **Get performance insights**: Uses [Chrome
  DevTools](https://github.com/ChromeDevTools/devtools-frontend) to record
  traces and extract actionable performance insights.
- **Advanced browser debugging**: Analyze network requests, take screenshots and
  check the browser console.
- **Reliable automation**. Uses
  [puppeteer](https://github.com/puppeteer/puppeteer) to automate actions in
  Chrome and automatically wait for action results.

## Disclaimers

`chrome_devtools` exposes content of the browser instance to whoever runs it (CLI, scripts, or MCP
clients), allowing them to inspect, debug, and modify any data in the browser or DevTools. Avoid sharing
sensitive or personal information that you don't want to expose.

## Requirements

- [Node.js](https://nodejs.org/) v20.19 or a newer [latest maintenance LTS](https://github.com/nodejs/Release#release-schedule) version.
- [Chrome](https://www.google.com/chrome/) current stable version or newer.
- [npm](https://www.npmjs.com/).

<!--
## MCP server mode (optional)

If you need this as an MCP server, configure your MCP client to run the `mcp` subcommand:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "mcp"]
    }
  }
}
```

> [!NOTE]  
> Using `chrome-devtools-mcp@latest` ensures that your MCP client will always use the latest version of the Chrome DevTools MCP server.

### MCP Client configuration

<details>
  <summary>Amp</summary>
  Follow https://ampcode.com/manual#mcp and use the config provided above. You can also install the Chrome DevTools MCP server using the CLI:

```bash
amp mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest mcp
```

</details>

<details>
  <summary>Antigravity</summary>

To use the Chrome DevTools MCP server follow the instructions from <a href="https://antigravity.google/docs/mcp">Antigravity's docs<a/> to install a custom MCP server. Add the following config to the MCP servers config:

```bash
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@latest",
        "mcp",
        "--browser-url=http://127.0.0.1:9222"
      ]
    }
  }
}
```

This will make the Chrome DevTools MCP server automatically connect to the browser that Antigravity is using. If you are not using port 9222, make sure to adjust accordingly.

Chrome DevTools MCP will not start the browser instance automatically using this approach as as the Chrome DevTools MCP server runs in Antigravity's built-in browser. If the browser is not already running, you have to start it first by clicking the Chrome icon at the top right corner.

</details>

<details>
  <summary>Claude Code</summary>
    Use the Claude Code CLI to add the Chrome DevTools MCP server (<a href="https://docs.anthropic.com/en/docs/claude-code/mcp">guide</a>):

```bash
claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest mcp
```

</details>

<details>
  <summary>Cline</summary>
  Follow https://docs.cline.bot/mcp/configuring-mcp-servers and use the config provided above.
</details>

<details>
  <summary>Codex</summary>
  Follow the <a href="https://github.com/openai/codex/blob/main/docs/advanced.md#model-context-protocol-mcp">configure MCP guide</a>
  using the standard config from above. You can also install the Chrome DevTools MCP server using the Codex CLI:

```bash
codex mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest mcp
```

**On Windows 11**

Configure the Chrome install location and increase the startup timeout by updating `.codex/config.toml` and adding the following `env` and `startup_timeout_ms` parameters:

```
[mcp_servers.chrome-devtools]
command = "cmd"
args = [
    "/c",
    "npx",
    "-y",
    "chrome-devtools-mcp@latest",
    "mcp",
]
env = { SystemRoot="C:\\Windows", PROGRAMFILES="C:\\Program Files" }
startup_timeout_ms = 20_000
```

</details>

<details>
  <summary>Copilot CLI</summary>

Start Copilot CLI:

```
copilot
```

Start the dialog to add a new MCP server by running:

```
/mcp add
```

Configure the following fields and press `CTRL+S` to save the configuration:

- **Server name:** `chrome-devtools`
- **Server Type:** `[1] Local`
- **Command:** `npx -y chrome-devtools-mcp@latest mcp`

</details>

<details>
  <summary>Copilot / VS Code</summary>

**Click the button to install:**

[<img src="https://img.shields.io/badge/VS_Code-VS_Code?style=flat-square&label=Install%20Server&color=0098FF" alt="Install in VS Code">](https://vscode.dev/redirect/mcp/install?name=io.github.ChromeDevTools%2Fchrome-devtools-mcp&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22chrome-devtools-mcp%22%5D%2C%22env%22%3A%7B%7D%7D)

[<img src="https://img.shields.io/badge/VS_Code_Insiders-VS_Code_Insiders?style=flat-square&label=Install%20Server&color=24bfa5" alt="Install in VS Code Insiders">](https://insiders.vscode.dev/redirect?url=vscode-insiders%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522io.github.ChromeDevTools%252Fchrome-devtools-mcp%2522%252C%2522config%2522%253A%257B%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522chrome-devtools-mcp%2522%255D%252C%2522env%2522%253A%257B%257D%257D%257D)

**Or install manually:**

Follow the MCP install <a href="https://code.visualstudio.com/docs/copilot/chat/mcp-servers#_add-an-mcp-server">guide</a>,
with the standard config from above. You can also install the Chrome DevTools MCP server using the VS Code CLI:

```bash
code --add-mcp '{"name":"io.github.ChromeDevTools/chrome-devtools-mcp","command":"npx","args":["-y","chrome-devtools-mcp"],"env":{}}'
```

</details>

<details>
  <summary>Cursor</summary>

**Click the button to install:**

[<img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Install in Cursor">](https://cursor.com/en/install-mcp?name=chrome-devtools&config=eyJjb21tYW5kIjoibnB4IC15IGNocm9tZS1kZXZ0b29scy1tY3BAbGF0ZXN0In0%3D)

**Or install manually:**

Go to `Cursor Settings` -> `MCP` -> `New MCP Server`. Use the config provided above.

</details>

<details>
  <summary>Factory CLI</summary>
Use the Factory CLI to add the Chrome DevTools MCP server (<a href="https://docs.factory.ai/cli/configuration/mcp">guide</a>):

```bash
droid mcp add chrome-devtools "npx -y chrome-devtools-mcp@latest mcp"
```

</details>

<details>
  <summary>Gemini CLI</summary>
Install the Chrome DevTools MCP server using the Gemini CLI.

**Project wide:**

```bash
gemini mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest mcp
```

**Globally:**

```bash
gemini mcp add -s user chrome-devtools -- npx -y chrome-devtools-mcp@latest mcp
```

Alternatively, follow the <a href="https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md#how-to-set-up-your-mcp-server">MCP guide</a> and use the standard config from above.

</details>

<details>
  <summary>Gemini Code Assist</summary>
  Follow the <a href="https://cloud.google.com/gemini/docs/codeassist/use-agentic-chat-pair-programmer#configure-mcp-servers">configure MCP guide</a>
  using the standard config from above.
</details>

<details>
  <summary>JetBrains AI Assistant & Junie</summary>

Go to `Settings | Tools | AI Assistant | Model Context Protocol (MCP)` -> `Add`. Use the config provided above.
The same way chrome-devtools-mcp can be configured for JetBrains Junie in `Settings | Tools | Junie | MCP Settings` -> `Add`. Use the config provided above.

</details>

<details>
  <summary>Kiro</summary>

In **Kiro Settings**, go to `Configure MCP` > `Open Workspace or User MCP Config` > Use the configuration snippet provided above.

Or, from the IDE **Activity Bar** > `Kiro` > `MCP Servers` > `Click Open MCP Config`. Use the configuration snippet provided above.

</details>

<details>
  <summary>OpenCode</summary>

Add the following configuration to your `opencode.json` file. If you don't have one, create it at `~/.config/opencode/opencode.json` (<a href="https://opencode.ai/docs/mcp-servers">guide</a>):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "chrome-devtools": {
      "type": "local",
      "command": ["npx", "-y", "chrome-devtools-mcp@latest", "mcp"]
    }
  }
}
```

</details>

<details>
  <summary>Qoder</summary>

In **Qoder Settings**, go to `MCP Server` > `+ Add` > Use the configuration snippet provided above.

Alternatively, follow the <a href="https://docs.qoder.com/user-guide/chat/model-context-protocol">MCP guide</a> and use the standard config from above.

</details>

<details>
  <summary>Qoder CLI</summary>

Install the Chrome DevTools MCP server using the Qoder CLI (<a href="https://docs.qoder.com/cli/using-cli#mcp-servsers">guide</a>):

**Project wide:**

```bash
qodercli mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest mcp
```

**Globally:**

```bash
qodercli mcp add -s user chrome-devtools -- npx -y chrome-devtools-mcp@latest mcp
```

</details>

<details>
  <summary>Visual Studio</summary>
  
  **Click the button to install:**
  
  [<img src="https://img.shields.io/badge/Visual_Studio-Install-C16FDE?logo=visualstudio&logoColor=white" alt="Install in Visual Studio">](https://vs-open.link/mcp-install?%7B%22name%22%3A%22chrome-devtools%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22chrome-devtools-mcp%40latest%22%5D%7D)
</details>

<details>
  <summary>Warp</summary>

Go to `Settings | AI | Manage MCP Servers` -> `+ Add` to [add an MCP Server](https://docs.warp.dev/knowledge-and-collaboration/mcp#adding-an-mcp-server). Use the config provided above.

</details>

<details>
  <summary>Windsurf</summary>
  Follow the <a href="https://docs.windsurf.com/windsurf/cascade/mcp#mcp-config-json">configure MCP guide</a>
  using the standard config from above.
</details>

### Your first prompt

Enter the following prompt in your MCP Client to check if everything is working:

```
Check the performance of https://developers.chrome.com
```

Your MCP client should open the browser and record a performance trace.

> [!NOTE]  
> The MCP server will start the browser automatically once the MCP client uses a tool that requires a running browser instance. Connecting to the Chrome DevTools MCP server on its own will not automatically start the browser.

-->
## Tools

If you run into any issues, checkout our [troubleshooting guide](./docs/troubleshooting.md).

<!-- BEGIN AUTO GENERATED TOOLS -->

- **Input automation** (8 tools)
  - [`click`](docs/tool-reference.md#click)
  - [`drag`](docs/tool-reference.md#drag)
  - [`fill`](docs/tool-reference.md#fill)
  - [`fill_form`](docs/tool-reference.md#fill_form)
  - [`handle_dialog`](docs/tool-reference.md#handle_dialog)
  - [`hover`](docs/tool-reference.md#hover)
  - [`press_key`](docs/tool-reference.md#press_key)
  - [`upload_file`](docs/tool-reference.md#upload_file)
- **Navigation automation** (6 tools)
  - [`close_page`](docs/tool-reference.md#close_page)
  - [`list_pages`](docs/tool-reference.md#list_pages)
  - [`navigate_page`](docs/tool-reference.md#navigate_page)
  - [`new_page`](docs/tool-reference.md#new_page)
  - [`select_page`](docs/tool-reference.md#select_page)
  - [`wait_for`](docs/tool-reference.md#wait_for)
- **Emulation** (2 tools)
  - [`emulate`](docs/tool-reference.md#emulate)
  - [`resize_page`](docs/tool-reference.md#resize_page)
- **Performance** (6 tools)
  - [`performance_analyze_insight`](docs/tool-reference.md#performance_analyze_insight)
  - [`performance_get_event_by_key`](docs/tool-reference.md#performance_get_event_by_key)
  - [`performance_get_main_thread_track_summary`](docs/tool-reference.md#performance_get_main_thread_track_summary)
  - [`performance_get_network_track_summary`](docs/tool-reference.md#performance_get_network_track_summary)
  - [`performance_start_trace`](docs/tool-reference.md#performance_start_trace)
  - [`performance_stop_trace`](docs/tool-reference.md#performance_stop_trace)
- **Network** (2 tools)
  - [`get_network_request`](docs/tool-reference.md#get_network_request)
  - [`list_network_requests`](docs/tool-reference.md#list_network_requests)
- **Debugging** (6 tools)
  - [`evaluate_script`](docs/tool-reference.md#evaluate_script)
  - [`get_console_message`](docs/tool-reference.md#get_console_message)
  - [`list_console_messages`](docs/tool-reference.md#list_console_messages)
  - [`take_change_snapshot`](docs/tool-reference.md#take_change_snapshot)
  - [`take_screenshot`](docs/tool-reference.md#take_screenshot)
  - [`take_snapshot`](docs/tool-reference.md#take_snapshot)

<!-- END AUTO GENERATED TOOLS -->

## Configuration

The CLI (and legacy `mcp` subcommand) supports the following configuration options:

<!-- BEGIN AUTO GENERATED OPTIONS -->

- **`--autoConnect`/ `--auto-connect`**
  If specified, automatically connects to a browser (Chrome 145+) running in the user data directory identified by the channel param. Requires remote debugging being enabled in Chrome here: chrome://inspect/#remote-debugging.
  - **Type:** boolean
  - **Default:** `false`

- **`--browserUrl`/ `--browser-url`, `-u`**
  Connect to a running, debuggable Chrome instance (e.g. `http://127.0.0.1:9222`). For more details see: https://github.com/JoshuaSeth/chrome-devtools-cli#connecting-to-a-running-chrome-instance.
  - **Type:** string

- **`--wsEndpoint`/ `--ws-endpoint`, `-w`**
  WebSocket endpoint to connect to a running Chrome instance (e.g., ws://127.0.0.1:9222/devtools/browser/<id>). Alternative to --browserUrl.
  - **Type:** string

- **`--wsHeaders`/ `--ws-headers`**
  Custom headers for WebSocket connection in JSON format (e.g., '{"Authorization":"Bearer token"}'). Only works with --wsEndpoint.
  - **Type:** string

- **`--headless`**
  Whether to run in headless (no UI) mode.
  - **Type:** boolean
  - **Default:** `false`

- **`--executablePath`/ `--executable-path`, `-e`**
  Path to custom Chrome executable.
  - **Type:** string

- **`--isolated`**
  If specified, creates a temporary user-data-dir that is automatically cleaned up after the browser is closed. Defaults to false.
  - **Type:** boolean

- **`--userDataDir`/ `--user-data-dir`**
  Path to the user data directory for Chrome. Default is $HOME/.cache/chrome-devtools-cli/chrome-profile$CHANNEL_SUFFIX_IF_NON_STABLE
  - **Type:** string

- **`--channel`**
  Specify a different Chrome channel that should be used. The default is the stable channel version.
  - **Type:** string
  - **Choices:** `stable`, `canary`, `beta`, `dev`

- **`--logFile`/ `--log-file`**
  Path to a file to write debug logs to. Set the env variable `DEBUG` to `*` to enable verbose logs. Useful for submitting bug reports.
  - **Type:** string

- **`--viewport`**
  Initial viewport size for the Chrome instances started by the server. For example, `1280x720`. In headless mode, max size is 3840x2160px.
  - **Type:** string

- **`--proxyServer`/ `--proxy-server`**
  Proxy server configuration for Chrome passed as --proxy-server when launching the browser. See https://www.chromium.org/developers/design-documents/network-settings/ for details.
  - **Type:** string

- **`--acceptInsecureCerts`/ `--accept-insecure-certs`**
  If enabled, ignores errors relative to self-signed and expired certificates. Use with caution.
  - **Type:** boolean

- **`--chromeArg`/ `--chrome-arg`**
  Additional arguments for Chrome. Only applies when Chrome is launched by chrome_devtools.
  - **Type:** array

- **`--categoryEmulation`/ `--category-emulation`**
  Set to false to exclude tools related to emulation.
  - **Type:** boolean
  - **Default:** `true`

- **`--categoryPerformance`/ `--category-performance`**
  Set to false to exclude tools related to performance.
  - **Type:** boolean
  - **Default:** `true`

- **`--categoryNetwork`/ `--category-network`**
  Set to false to exclude tools related to network.
  - **Type:** boolean
  - **Default:** `true`

<!-- END AUTO GENERATED OPTIONS -->

Pass these flags to any direct tool command, `call`, or `session`. For example:

```bash
npx -y . list_pages --channel=canary --headless --isolated
```

### Connecting via WebSocket with custom headers

You can connect directly to a Chrome WebSocket endpoint and include custom headers (e.g., for authentication):

```bash
npx -y . list_pages \
  --wsEndpoint=ws://127.0.0.1:9222/devtools/browser/<id> \
  --wsHeaders='{"Authorization":"Bearer YOUR_TOKEN"}'
```

To get the WebSocket endpoint from a running Chrome instance, visit `http://127.0.0.1:9222/json/version` and look for the `webSocketDebuggerUrl` field.

You can also run `npx -y . --help` (CLI) or `npx -y . mcp --help` (legacy MCP server) to see available options.

## Concepts

### User data directory

`chrome_devtools` starts Chrome using the following user data directory:

- Linux / macOS: `$HOME/.cache/chrome-devtools-cli/chrome-profile-$CHANNEL`
- Windows: `%HOMEPATH%/.cache/chrome-devtools-cli/chrome-profile-$CHANNEL`

The user data directory is not cleared between runs and shared across
all instances of `chrome_devtools`. Set the `isolated` option to `true`
to use a temporary user data dir instead which will be cleared automatically after
the browser is closed.

### Connecting to a running Chrome instance

By default, the CLI starts a new Chrome instance with a dedicated profile. This might not be ideal in all situations:

- If you would like to maintain the same application state when alternating between manual site testing and agent-driven testing.
- When you need to sign into a website. Some accounts may prevent sign-in when the browser is controlled via WebDriver (the default launch mechanism).
- If you're running your LLM inside a sandboxed environment, but you would like to connect to a Chrome instance that runs outside the sandbox.

In these cases, start Chrome first and let `chrome_devtools` connect to it. There are two ways to do so:

- **Automatic connection (available in Chrome 145+)**: best for sharing state between manual and agent-driven testing.
- **Manual connection via remote debugging port**: best when running inside a sandboxed environment.

#### Automatically connecting to a running Chrome instance

**Step 1:** Set up remote debugging in Chrome

In Chrome (\>= M144), do the following to set up remote debugging:

1.  Navigate to `chrome://inspect/#remote-debugging` to enable remote debugging.
2.  Follow the dialog UI to allow or disallow incoming debugging connections.

**Step 2:** Run `chrome_devtools` with `--autoConnect`

To connect `chrome_devtools` to the running Chrome instance, use `--autoConnect`:

```bash
npx -y . list_pages --autoConnect --channel=stable
```

> [!NOTE]  
> `--autoConnect` requires you to start Chrome and grant permission in the Chrome UI. If you have multiple active profiles, Chrome will choose the default profile (as determined by Chrome).

#### Manual connection using port forwarding

You can connect to a running Chrome instance by using `--browser-url` (or `--wsEndpoint`). This is useful if you are running in an environment that does not allow starting a new Chrome instance.

> [!WARNING]  
> Enabling the remote debugging port opens up a debugging port on the running browser instance. Any application on your machine can connect to this port and control the browser. Make sure that you are not browsing any sensitive websites while the debugging port is open.

Start the Chrome browser with the remote debugging port enabled. Make sure to close any running Chrome instances before starting a new one with the debugging port enabled.

For security reasons, [Chrome requires you to use a non-default user data directory](https://developer.chrome.com/blog/remote-debugging-port) when enabling the remote debugging port. You can specify a custom directory using the `--user-data-dir` flag. This ensures that your regular browsing profile and data are not exposed to the debugging session.

**macOS**

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-profile-stable
```

**Linux**

```bash
/usr/bin/google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-profile-stable
```

**Windows**

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%TEMP%\chrome-profile-stable"
```

Then connect:

```bash
npx -y . list_pages --browser-url=http://127.0.0.1:9222
```

If you hit VM-to-host port forwarding issues, see the “Remote debugging between virtual machine (VM) and host fails” section in [`docs/troubleshooting.md`](./docs/troubleshooting.md#remote-debugging-between-virtual-machine-vm-and-host-fails).

For more details on remote debugging, see the [Chrome DevTools documentation](https://developer.chrome.com/docs/devtools/remote-debugging/).

## Known limitations

### Operating system sandboxes

If you run `chrome_devtools` in an OS sandbox (macOS Seatbelt, Linux containers, etc.), it may not be able to launch Chrome (Chrome needs permissions to create its own sandboxes). As a workaround, start Chrome outside the sandbox and use `--browser-url` (or `--wsEndpoint`) to connect.
