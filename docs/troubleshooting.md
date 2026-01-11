# Troubleshooting

## General tips

- Run `npx chrome_devtools --help` to confirm the CLI runs on your machine.
- If you still need legacy MCP server mode, run `npx chrome_devtools mcp --help`.
- Make sure your terminal and any IDE/agent runtime use the same Node/npm versions.

## Debugging

Start the CLI with debugging enabled and a log file:

- `DEBUG=* npx chrome_devtools list_pages --logFile=/path/to/chrome-devtools-cli.log`

Using `.mcp.json` to debug while using a client (legacy MCP server mode):

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "--package",
        "github:JoshuaSeth/chrome-devtools-cli",
        "chrome_devtools",
        "mcp",
        "--log-file",
        "/path/to/chrome-devtools-cli.log"
      ],
      "env": {
        "DEBUG": "*"
      }
    }
  }
}
```

## Specific problems

### `Error [ERR_MODULE_NOT_FOUND]: Cannot find module ...`

This usually indicates either a non-supported Node version is in use or that the
`npm`/`npx` cache is corrupted. Try clearing the cache, uninstalling
`chrome-devtools-cli` and installing it again. Clear the cache by running:

```sh
rm -rf ~/.npm/_npx # NOTE: this might remove other installed npx executables.
npm cache clean --force
```

### `Target closed` error

This indicates that the browser could not be started. Make sure that no Chrome
instances are running or close them. Make sure you have the latest stable Chrome
installed and that [your system is able to run Chrome](https://support.google.com/chrome/a/answer/7100626?hl=en).

### Remote debugging between virtual machine (VM) and host fails

When connecting DevTools inside a VM to Chrome running on the host, any domain is rejected by Chrome because of host header validation. Tunneling the port over SSH bypasses this restriction. In the VM, run:

```sh
ssh -N -L 127.0.0.1:9222:127.0.0.1:9222 <user>@<host-ip>
```

Point the MCP connection inside the VM to `http://127.0.0.1:9222` and DevTools
will reach the host browser without triggering the Host validation.
