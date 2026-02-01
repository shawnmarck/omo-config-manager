---
title: Installation Guide
description: Install omo-config-manager for OpenCode and Claude Code
version: 1.0.0
author: @shawnmarck
license: MIT
---

# Installation Guide

This guide will help you install `omo-config-manager` for both OpenCode and Claude Code.

## Platform Detection (For AI Agents)

**First, detect the user's platform and harness:**

```bash
# Detect OS
OS="$(uname -s)"
case "$OS" in
  Linux*)     PLATFORM="linux" ;;
  Darwin*)    PLATFORM="macos" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  *)          PLATFORM="unknown" ;;
esac

# Detect harness (check for OpenCode or Claude Code)
if command -v opencode &> /dev/null; then
  HARNESS="opencode"
elif [ -d "$HOME/.claude" ] || [ -d "$HOME/.config/claude" ]; then
  HARNESS="claude-code"
else
  HARNESS="unknown"
fi

echo "Platform: $PLATFORM, Harness: $HARNESS"
```

**Set paths based on platform:**

```bash
if [ "$PLATFORM" = "windows" ]; then
  # Windows paths
  OC_PLUGIN_DIR="$APPDATA/opencode/plugin/omo-config-manager"
  OC_CONFIG_FILE="$APPDATA/opencode/opencode.json"
  CC_MARKETPLACE_DIR="$USERPROFILE/.claude/plugins/marketplaces/omo-config-manager"
else
  # Linux/macOS paths
  OC_PLUGIN_DIR="$HOME/.config/opencode/plugin/omo-config-manager"
  OC_CONFIG_FILE="$HOME/.config/opencode/opencode.json"
  CC_MARKETPLACE_DIR="$HOME/.claude/plugins/marketplaces/omo-config-manager"
fi
```

**Automated installation based on detected platform and harness:**

```bash
# Security note: this installs from source. Prefer cloning a tagged release if available.
# Install for OpenCode
if [ "$HARNESS" = "opencode" ]; then
  mkdir -p "$(dirname "$OC_PLUGIN_DIR")"
  git clone --depth 1 https://github.com/shawnmarck/omo-config-manager.git "$OC_PLUGIN_DIR"
  cd "$OC_PLUGIN_DIR/plugins/omo-config-manager"
  npm ci && npm run build
  mkdir -p "$(dirname "$OC_CONFIG_FILE")"
  if [ -f "$OC_CONFIG_FILE" ]; then
    # NOTE: This JSON edit assumes opencode.json is strict JSON (not JSONC).
    node -e "const fs=require('fs');const p='$OC_CONFIG_FILE';const c=JSON.parse(fs.readFileSync(p));if(!c.plugin)c.plugin=[];const pluginPath='file:$OC_PLUGIN_DIR';if(!c.plugin.includes(pluginPath))c.plugin.push(pluginPath);fs.writeFileSync(p,JSON.stringify(c,null,2));"
  else
    echo "{\"plugin\":[\"file:$OC_PLUGIN_DIR\"]}" > "$OC_CONFIG_FILE"
  fi
fi

# Install for Claude Code
if [ "$HARNESS" = "claude-code" ]; then
  CC_MARKETPLACE_DIR="$HOME/.claude/plugins/marketplaces/omo-config-manager"
  mkdir -p "$(dirname "$CC_MARKETPLACE_DIR")"
  git clone --depth 1 https://github.com/shawnmarck/omo-config-manager.git "$CC_MARKETPLACE_DIR"
  cd "$CC_MARKETPLACE_DIR/plugins/omo-config-manager"
  npm ci && npm run build
  claude plugin marketplace add "$CC_MARKETPLACE_DIR"
  claude plugin install omo-config-manager@omo-local
fi
```

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Git
- OpenCode or Claude Code installed

## OpenCode Installation

### Step 1: Clone to Global Plugin Directory

OpenCode looks for plugins in the global plugin directory. The location varies by platform:

- **Linux/macOS**: `~/.config/opencode/plugin/`
- **Windows**: `%APPDATA%\opencode\plugin\` or `%USERPROFILE%\.config\opencode\plugin\`

```bash
# Linux/macOS
mkdir -p ~/.config/opencode/plugin
cd ~/.config/opencode/plugin
git clone https://github.com/shawnmarck/omo-config-manager.git omo-config-manager
cd omo-config-manager

# Windows (PowerShell)
New-Item -ItemType Directory -Force -Path "$env:APPDATA\opencode\plugin"
cd "$env:APPDATA\opencode\plugin"
git clone https://github.com/shawnmarck/omo-config-manager.git omo-config-manager
cd omo-config-manager
```

### Step 2: Install Dependencies and Build

The plugin source is in the `plugins/omo-config-manager` subdirectory:

```bash
cd plugins/omo-config-manager
npm ci
npm run build
cd ../..
```

### Step 3: Configure OpenCode

Add the plugin to your `opencode.json` configuration file:

- **Linux/macOS**: `~/.config/opencode/opencode.json`
- **Windows**: `%APPDATA%\opencode\opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:~/.config/opencode/plugin/omo-config-manager"
  ]
}
```

**Windows users**: Use the full path or environment variable:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:%APPDATA%\\opencode\\plugin\\omo-config-manager"
  ]
}
```

### Step 4: Verify Installation

Restart OpenCode and test the plugin:

```bash
/omo-config list my agents
```

## Claude Code Installation

### Step 1: Clone the Marketplace Repository

Clone the repository to the Claude Code marketplaces directory:

```bash
# Linux/macOS
mkdir -p ~/.claude/plugins/marketplaces
cd ~/.claude/plugins/marketplaces
git clone https://github.com/shawnmarck/omo-config-manager.git omo-config-manager
cd omo-config-manager

# Windows (PowerShell)
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.claude\plugins\marketplaces"
cd "$env:USERPROFILE\.claude\plugins\marketplaces"
git clone https://github.com/shawnmarck/omo-config-manager.git omo-config-manager
cd omo-config-manager
```

### Step 2: Install Dependencies and Build

The plugin source is in the `plugins/omo-config-manager` subdirectory:

```bash
cd plugins/omo-config-manager
npm ci && npm run build
cd ../..
```

### Step 3: Add Marketplace and Install Plugin

Use the Claude CLI to register the marketplace and install the plugin:

```bash
# Add the local marketplace (use full path)
claude plugin marketplace add ~/.claude/plugins/marketplaces/omo-config-manager

# Install the plugin from the marketplace
claude plugin install omo-config-manager@omo-local
```

**Windows users**: Use the full path:
```powershell
claude plugin marketplace add "$env:USERPROFILE\.claude\plugins\marketplaces\omo-config-manager"
claude plugin install omo-config-manager@omo-local
```

### Step 4: Verify Installation

Restart Claude Code and test:

```bash
/omo-config list my agents
```

## Automated Installation (One-Liner)

For LLM agents, use these one-liners that handle everything automatically:

### OpenCode (Linux/macOS)

```bash
PLUGIN_DIR="$HOME/.config/opencode/plugin/omo-config-manager" && \
mkdir -p "$(dirname "$PLUGIN_DIR")" && \
git clone https://github.com/shawnmarck/omo-config-manager.git "$PLUGIN_DIR" && \
cd "$PLUGIN_DIR/plugins/omo-config-manager" && \
npm ci && npm run build && \
cd "$PLUGIN_DIR" && \
CONFIG_FILE="$HOME/.config/opencode/opencode.json" && \
mkdir -p "$(dirname "$CONFIG_FILE")" && \
if [ -f "$CONFIG_FILE" ]; then \
  node -e "const fs=require('fs');const p='$CONFIG_FILE';const c=JSON.parse(fs.readFileSync(p));if(!c.plugin)c.plugin=[];const pluginPath='file:$PLUGIN_DIR';if(!c.plugin.includes(pluginPath))c.plugin.push(pluginPath);fs.writeFileSync(p,JSON.stringify(c,null,2));"; \
else \
  echo "{\"plugin\":[\"file:$PLUGIN_DIR\"]}" > "$CONFIG_FILE"; \
fi
```

### OpenCode (Windows PowerShell)

```powershell
$PLUGIN_DIR = "$env:APPDATA\opencode\plugin\omo-config-manager"; \
New-Item -ItemType Directory -Force -Path "$(Split-Path $PLUGIN_DIR)"; \
git clone https://github.com/shawnmarck/omo-config-manager.git $PLUGIN_DIR; \
cd "$PLUGIN_DIR\plugins\omo-config-manager"; \
npm ci; npm run build; \
cd $PLUGIN_DIR; \
$CONFIG_FILE = "$env:APPDATA\opencode\opencode.json"; \
New-Item -ItemType Directory -Force -Path "$(Split-Path $CONFIG_FILE)"; \
if (Test-Path $CONFIG_FILE) { \
  $config = Get-Content $CONFIG_FILE | ConvertFrom-Json; \
  if (-not $config.plugin) { $config | Add-Member -MemberType NoteProperty -Name 'plugin' -Value @() }; \
  $pluginPath = "file:$PLUGIN_DIR"; \
  if ($config.plugin -notcontains $pluginPath) { $config.plugin += $pluginPath }; \
  $config | ConvertTo-Json -Depth 10 | Set-Content $CONFIG_FILE \
} else { \
  @{plugin=@("file:$PLUGIN_DIR")} | ConvertTo-Json | Set-Content $CONFIG_FILE \
}
```

### Claude Code (Linux/macOS)

```bash
MARKETPLACE_DIR="$HOME/.claude/plugins/marketplaces/omo-config-manager" && \
mkdir -p "$(dirname "$MARKETPLACE_DIR")" && \
git clone https://github.com/shawnmarck/omo-config-manager.git "$MARKETPLACE_DIR" && \
cd "$MARKETPLACE_DIR/plugins/omo-config-manager" && \
npm ci && npm run build && \
claude plugin marketplace add "$MARKETPLACE_DIR" && \
claude plugin install omo-config-manager@omo-local
```

### Claude Code (Windows PowerShell)

```powershell
$MARKETPLACE_DIR = "$env:USERPROFILE\.claude\plugins\marketplaces\omo-config-manager"; \
New-Item -ItemType Directory -Force -Path "$(Split-Path $MARKETPLACE_DIR)"; \
git clone https://github.com/shawnmarck/omo-config-manager.git $MARKETPLACE_DIR; \
cd "$MARKETPLACE_DIR\plugins\omo-config-manager"; \
npm ci; npm run build; \
claude plugin marketplace add $MARKETPLACE_DIR; \
claude plugin install omo-config-manager@omo-local
```

## Troubleshooting

### Plugin not detected

1. **Check the path**: Ensure the path in `opencode.json` matches the actual plugin location
2. **Verify build**: Make sure `npm run build` completed successfully
3. **Check config location**: Verify you're editing the correct config file (global vs project-level)
4. **Restart OpenCode/Claude Code**: Plugins are loaded at startup

### Build errors

- Ensure Node.js v18+ is installed: `node --version`
- Clear node_modules and reinstall: `rm -rf node_modules && npm ci`
- Check for TypeScript errors: `npm run typecheck`

### Path issues on Windows

- Use forward slashes in JSON paths: `file:C:/Users/Name/AppData/Roaming/opencode/plugin/omo-config-manager`
- Or use environment variables: `file:%APPDATA%\\opencode\\plugin\\omo-config-manager`
- Avoid spaces in the path if possible

### Claude Code plugin location

If the plugin isn't detected in Claude Code, check:
- Your Claude Code configuration for the plugin directory location
- Whether plugins need to be symlinked rather than cloned
- Claude Code documentation for the correct plugin installation method

## Next Steps

After installation, see the [README](../README.md) for usage examples and features.
