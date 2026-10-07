#!/bin/sh
# Agentic Office PC agent: install and link this Mac (docs/PC-AGENT.md).
# Run as:  curl -fsSL {{SERVER}}/i/{{CODE}}/mac | sh
# No admin needed. Installs to ~/Library/Application Support/AgenticOffice (Node.js from
# nodejs.org, checked against its SHA-256, and the agent from your office server), links with a
# one-time code, and starts at login (a LaunchAgent: space.oriondesk.agentic.pc).
# Remove it any time:  "$HOME/Library/Application Support/AgenticOffice/bin/agentic-pc" uninstall
set -eu

SERVER='{{SERVER}}'
CODE='{{CODE}}'
NODE_MAJOR=22
DIR="$HOME/Library/Application Support/AgenticOffice"
LABEL=space.oriondesk.agentic.pc
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

say() { printf '  %s\n' "$1"; }
fail() { printf '\n%s\n' "$1" >&2; exit 1; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

case "$(uname -s)" in Darwin) ;; *) fail "This installer is for macOS." ;; esac
case "$(uname -m)" in arm64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) fail "Unsupported Mac: $(uname -m)" ;; esac

printf '\nAgentic Office: linking this Mac to your AI\n'
say "Server: $SERVER"
mkdir -p "$DIR/agent" "$DIR/bin"
chmod 700 "$DIR"

# An agent already running (reinstall / relink): stop it first.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ -f "$DIR/agent.lock" ]; then kill "$(cat "$DIR/agent.lock")" 2>/dev/null || true; fi

# 1. Node.js (the latest of the pinned LTS line), verified against nodejs.org's SHASUMS256.
DIST="https://nodejs.org/dist/latest-v$NODE_MAJOR.x"
LINE=$(curl -fsSL "$DIST/SHASUMS256.txt" | grep -E "node-v$NODE_MAJOR\.[0-9.]+-darwin-$ARCH\.tar\.gz\$" | head -n 1)
[ -n "$LINE" ] || fail "Could not find Node.js $NODE_MAJOR for macOS $ARCH on nodejs.org."
WANT=$(printf '%s' "$LINE" | awk '{print $1}')
TARBALL=$(printf '%s' "$LINE" | awk '{print $2}')
if [ "$(cat "$DIR/node/.release" 2>/dev/null || true)" != "$TARBALL" ] || [ ! -x "$DIR/node/bin/node" ]; then
  say "Downloading $TARBALL from nodejs.org ..."
  TMP=$(mktemp -d)
  curl -fsSL "$DIST/$TARBALL" -o "$TMP/$TARBALL"
  [ "$(sha "$TMP/$TARBALL")" = "$WANT" ] || { rm -rf "$TMP"; fail "The Node.js download did not match its checksum. Nothing was installed."; }
  tar -xzf "$TMP/$TARBALL" -C "$TMP"
  rm -rf "$DIR/node"
  mv "$TMP/${TARBALL%.tar.gz}" "$DIR/node"
  printf '%s\n' "$TARBALL" > "$DIR/node/.release"
  rm -rf "$TMP"
else
  say "Node.js is up to date ($TARBALL)."
fi
NODE="$DIR/node/bin/node"

# 2. The agent (one file from your office server), verified against its SHA-256.
say "Downloading the agent from your office server ..."
curl -fsSL "$SERVER/downloads/pc-agent/agent.cjs" -o "$DIR/agent/agent.cjs.part"
AGENT_SUM=$(curl -fsSL "$SERVER/downloads/pc-agent/agent.cjs.sha256" | awk '{print $1}')
[ "$(sha "$DIR/agent/agent.cjs.part")" = "$AGENT_SUM" ] || { rm -f "$DIR/agent/agent.cjs.part"; fail "The agent download did not match its checksum. Nothing was installed."; }
mv -f "$DIR/agent/agent.cjs.part" "$DIR/agent/agent.cjs"

# 3. The `agentic-pc` command.
cat > "$DIR/bin/agentic-pc" <<EOF
#!/bin/sh
exec "$NODE" "$DIR/agent/agent.cjs" "\$@"
EOF
chmod 755 "$DIR/bin/agentic-pc"

# 4. Link with the one-time code.
say "Linking ..."
"$NODE" "$DIR/agent/agent.cjs" link "$CODE" --server "$SERVER" || fail "Linking did not work. Make a new code on the My computers page and try again."

# 5. Start at login, and start now (restarted if it crashes; not after an unlink).
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$DIR/agent/agent.cjs</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardErrorPath</key><string>$DIR/agent.err.log</string>
</dict>
</plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST"

printf '\nLinked. Your AI can now use this Mac (the folders you shared only).\n'
say "Shared folders, pause, unlink and activity: the My computers page, or:"
say "  \"$DIR/bin/agentic-pc\" status | folders | pause | resume | logs | unlink | uninstall"
printf '\n'
