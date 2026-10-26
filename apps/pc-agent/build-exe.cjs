#!/usr/bin/env node
/* P52: builds AgenticOfficePC.exe, the Windows agent as one file (a Node single executable
 * application): the official Windows node.exe of the SAME version as the node running this
 * script (checked against nodejs.org's SHASUMS256), with agent.cjs embedded.
 *
 *   node apps/pc-agent/build-exe.cjs [out-dir]        (default: apps/pc-agent/dist)
 *
 * Runs on Linux (the API image build) or Windows. Steps: download node.exe and check it; drop
 * its Authenticode signature (the injected file would carry a broken one); build the SEA blob
 * (no snapshot, no code cache: the same blob works for any OS of this Node version); inject it
 * with postject; mark the program as a windowed one (no console window ever opens); write the
 * SHA-256 next to it. Nothing here signs the file: a code-signing certificate can be applied
 * afterwards (signtool) to avoid the SmartScreen warning.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const HERE = __dirname;
const OUT = path.resolve(process.argv[2] || path.join(HERE, "dist"));
const NAME = "AgenticOfficePC.exe";
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const POSTJECT = "postject@1.0.0-alpha.6";

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function run(cmd, args, shell = false) {
  // npx is a .cmd on Windows (needs a shell); quote what goes through one.
  const q = (a) => (shell && /\s/.test(a) ? `"${a}"` : a);
  const r = spawnSync(cmd, args.map(q), { stdio: "inherit", shell: shell && process.platform === "win32" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
}

/** PE header offsets of a 64-bit Windows program. */
function pe(buf) {
  const at = buf.readUInt32LE(0x3c);
  if (buf.toString("latin1", at, at + 4) !== "PE\0\0") throw new Error("not a Windows program");
  const opt = at + 24;
  if (buf.readUInt16LE(opt) !== 0x20b) throw new Error("not a 64-bit Windows program");
  return { subsystem: opt + 68, security: opt + 112 + 4 * 8 };
}

/** Remove the Authenticode signature (certificate table at the end of the file). */
function unsign(buf) {
  const { security } = pe(buf);
  const offset = buf.readUInt32LE(security);
  const size = buf.readUInt32LE(security + 4);
  if (!offset || !size) return buf;
  if (offset + size !== buf.length) throw new Error("unexpected signature layout");
  const out = Buffer.from(buf.subarray(0, offset));
  out.writeUInt32LE(0, security);
  out.writeUInt32LE(0, security + 4);
  return out;
}

async function main() {
  const version = process.version;
  const dist = `https://nodejs.org/dist/${version}`;
  fs.mkdirSync(OUT, { recursive: true });
  const work = fs.mkdtempSync(path.join(OUT, ".build-"));
  try {
    const sums = await (await fetch(`${dist}/SHASUMS256.txt`)).text();
    const line = sums.split("\n").find((l) => /\swin-x64\/node\.exe\s*$/.test(l));
    if (!line) throw new Error(`no win-x64/node.exe listed for ${version}`);
    const want = line.trim().split(/\s+/)[0];
    console.log(`node.exe ${version} (win-x64) from nodejs.org ...`);
    const exe = Buffer.from(await (await fetch(`${dist}/win-x64/node.exe`)).arrayBuffer());
    if (sha256(exe) !== want) throw new Error("node.exe did not match its checksum");
    const target = path.join(work, NAME);
    fs.writeFileSync(target, unsign(exe));

    const blob = path.join(work, "sea-prep.blob");
    fs.copyFileSync(path.join(HERE, "agent.cjs"), path.join(work, "agent.cjs"));
    fs.writeFileSync(path.join(work, "sea-config.json"), JSON.stringify({
      main: path.join(work, "agent.cjs"),
      output: blob,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    }));
    run(process.execPath, ["--experimental-sea-config", path.join(work, "sea-config.json")]);
    run("npx", ["--yes", POSTJECT, target, "NODE_SEA_BLOB", blob, "--sentinel-fuse", FUSE, "--overwrite"], true);

    // A windowed program: started at sign-in or double-clicked, no console window opens.
    const built = fs.readFileSync(target);
    built.writeUInt16LE(2, pe(built).subsystem); // IMAGE_SUBSYSTEM_WINDOWS_GUI
    const final = path.join(OUT, NAME);
    fs.writeFileSync(final, built);
    fs.writeFileSync(`${final}.sha256`, `${sha256(built)}  ${NAME}\n`);
    console.log(`Built ${final} (${(built.length / 1048576).toFixed(1)} MB)`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
