// Builds the mindwalk sidecar from the pinned upstream tag plus the patches
// in scripts/mindwalk/patches/, producing src-tauri/binaries/mindwalk-<triple>.
//
// Why a fork is built instead of shipping the official binary: the card
// docs/mindwalk-real-no-micahs-mind-2026-08-19.md records the measurements —
// upstream re-walks the session's whole cwd on every trace rebuild (~200s for
// a HOME session, the common Micah pane case) and accepts a single
// --claude-dir, while Micah reads two roots. The patches add a scan cache
// with stale-while-revalidate, repeatable --claude-dir, and a ?follow=1 mode.
// Upstream is MIT (see LICENSES/mindwalk.txt); the pin is tag + commit sha.
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MINDWALK_REPO = "https://github.com/cosmtrek/mindwalk";
const MINDWALK_TAG = "v0.5.0";
const MINDWALK_SHA = "68aeda671a48eb6e406792e984d3570f28dc5e70";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tauriDir = join(root, "src-tauri");
const patchPath = join(root, "scripts", "mindwalk", "patches", "mindwalk-micah.patch");
// Lives under src-tauri/target so it is already gitignored and survives
// between builds (the clone is the network-dependent part; with it cached a
// rebuild works offline).
const srcDir = join(tauriDir, "target", "mindwalk-src");
const force = process.argv.includes("--force");
const runTests = process.argv.includes("--test");

function run(command, args, { capture = false, cwd = root, env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
    env: env ? { ...process.env, ...env } : process.env,
  });
  if (result.error) {
    process.stderr.write(`Could not run ${command}: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (capture) {
      process.stderr.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}

function hostTriple() {
  const output = run("rustc", ["-vV"], { capture: true });
  const match = output.match(/^host:\s+(.+)$/m);
  if (!match) {
    process.stderr.write("rustc did not report a host target triple\n");
    process.exit(1);
  }
  return match[1].trim();
}

// Rust target triple -> GOOS/GOARCH. Only the triples the release matrix
// builds; extend deliberately, not speculatively.
const GO_TARGETS = {
  "x86_64-pc-windows-msvc": { GOOS: "windows", GOARCH: "amd64" },
  "aarch64-pc-windows-msvc": { GOOS: "windows", GOARCH: "arm64" },
  "x86_64-unknown-linux-gnu": { GOOS: "linux", GOARCH: "amd64" },
  "aarch64-unknown-linux-gnu": { GOOS: "linux", GOARCH: "arm64" },
  "x86_64-apple-darwin": { GOOS: "darwin", GOARCH: "amd64" },
  "aarch64-apple-darwin": { GOOS: "darwin", GOARCH: "arm64" },
};

const target =
  process.env.MICAH_MINDWALK_TARGET?.trim() ||
  process.env.MICAH_CLI_TARGET?.trim() ||
  process.env.CARGO_BUILD_TARGET?.trim() ||
  hostTriple();
const goTarget = GO_TARGETS[target];
if (!goTarget) {
  process.stderr.write(`no GOOS/GOARCH mapping for target triple ${target}\n`);
  process.exit(1);
}

const extension = goTarget.GOOS === "windows" ? ".exe" : "";
const destination = join(tauriDir, "binaries", `mindwalk-${target}${extension}`);
const stampPath = join(tauriDir, "binaries", `.mindwalk-${target}.stamp.json`);
const patchHash = createHash("sha256").update(readFileSync(patchPath)).digest("hex");
const stampWant = JSON.stringify({ sha: MINDWALK_SHA, patch: patchHash });

if (!force && existsSync(destination) && statSync(destination).size > 0) {
  try {
    const stamp = readFileSync(stampPath, "utf8");
    const { sha, patch } = JSON.parse(stamp);
    if (JSON.stringify({ sha, patch }) === stampWant) {
      console.log(`mindwalk sidecar up to date: ${destination.slice(root.length + 1)}`);
      process.exit(0);
    }
  } catch {}
}

// 1. Pinned clone (cached). autocrlf off so the patch applies bytewise.
if (!existsSync(join(srcDir, ".git"))) {
  rmSync(srcDir, { recursive: true, force: true });
  mkdirSync(dirname(srcDir), { recursive: true });
  run("git", [
    "-c", "core.autocrlf=false",
    "clone", "--depth", "1", "--branch", MINDWALK_TAG,
    MINDWALK_REPO, srcDir,
  ]);
}
const head = run("git", ["-C", srcDir, "rev-parse", "HEAD"], { capture: true }).trim();
if (head !== MINDWALK_SHA) {
  process.stderr.write(
    `pinned mindwalk clone is at ${head}, expected ${MINDWALK_SHA} (tag ${MINDWALK_TAG}) — delete ${srcDir} and rerun\n`,
  );
  process.exit(1);
}

// 2. Reset to the pin and apply the patches (idempotent across reruns).
run("git", ["-C", srcDir, "checkout", "--", "."]);
run("git", ["-C", srcDir, "clean", "-fd", "-e", "node_modules", "-e", "bin"]);
run("git", ["-C", srcDir, "apply", "--whitespace=nowarn", patchPath]);

// 3. The patch touches web/src, so the embedded frontend must be rebuilt and
// recopied into internal/server/static (the go:embed source).
// npm is npm.cmd on Windows, and Node refuses to spawn .cmd files without a
// shell (CVE-2024-27980) — go through cmd /c there.
const runNpm = (args) =>
  process.platform === "win32"
    ? run("cmd", ["/c", "npm", ...args])
    : run("npm", args);
if (!existsSync(join(srcDir, "web", "node_modules"))) {
  runNpm(["ci", "--prefix", join(srcDir, "web")]);
}
runNpm(["run", "build", "--prefix", join(srcDir, "web")]);
const staticDir = join(srcDir, "internal", "server", "static");
rmSync(join(staticDir, "assets"), { recursive: true, force: true });
cpSync(join(srcDir, "web", "dist", "index.html"), join(staticDir, "index.html"));
cpSync(join(srcDir, "web", "dist", "assets"), join(staticDir, "assets"), { recursive: true });
for (const entry of ["assets"]) {
  // vite emits sourcemaps next to the bundles; they never ship
  run(process.platform === "win32" ? "cmd" : "sh",
    process.platform === "win32"
      ? ["/c", `del /q "${join(staticDir, entry, "*.map")}" 2>nul & exit /b 0`]
      : ["-c", `rm -f "${join(staticDir, entry)}"/*.map`]);
}

// 4. Optional test pass over the patched tree (CI runs this on linux, where
// the whole upstream suite is green; on Windows three upstream citymap tests
// fail for environmental reasons — symlink privilege, unix dir semantics).
if (runTests) {
  run("go", ["test", "./..."], { cwd: srcDir });
}

// 5. Cross-compile. Pure Go (CGO off) builds any target from any host.
mkdirSync(dirname(destination), { recursive: true });
run("go", ["build", "-trimpath", "-ldflags", "-s -w", "-o", destination, "./cmd/mindwalk"], {
  cwd: srcDir,
  env: { GOOS: goTarget.GOOS, GOARCH: goTarget.GOARCH, CGO_ENABLED: "0" },
});
if (!extension) chmodSync(destination, 0o755);
const artifact = statSync(destination);
if (!artifact.isFile() || artifact.size === 0) {
  process.stderr.write(`built mindwalk sidecar is missing or empty: ${destination}\n`);
  process.exit(1);
}
writeFileSync(stampPath, `${stampWant}\n`);
console.log(`Prepared ${destination.slice(root.length + 1)}`);
