# Development Rules

> This is a fork of earendil-works/pi-mono, customized for personal AI agent use on Windows.

## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text (e.g., "Thanks @user" not "Thanks so much @user!")
- Technical prose only, be direct
- When the user asks a question, answer it first before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed.

## Code Quality

- Read files in full before wide-ranging changes, before editing files you have not fully inspected, and when asked to investigate or audit. Do not rely on search snippets for broad changes.
- No `any` unless absolutely necessary.
- Inline single-line helpers that have only one call site.
- Check node_modules for external API types; don't guess.
- **No inline imports** (`await import()`, `import("pkg").Type`, dynamic type imports). Top-level imports only.
- Never remove or downgrade code to fix type errors from outdated deps; upgrade the dep instead.
- Use only erasable TypeScript syntax (Node strip-only mode) in code checked by the root config (`packages/*/src`, `packages/*/test`, `packages/coding-agent/examples`): no parameter properties, `enum`, `namespace`/`module`, `import =`, `export =`, or other constructs needing JS emit. Use explicit fields with constructor assignments.
- Always ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless the user asks for it.
- Never hardcode key checks (e.g. `matchesKey(keyData, "ctrl+x")`). Add defaults to `DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS` so they stay configurable.
- Never modify `packages/ai/src/models.generated.ts` directly; update `packages/ai/scripts/generate-models.ts` instead, then regenerate. Including the resulting `models.generated.ts` diff is always OK, even if regeneration includes unrelated upstream model metadata changes.

## Commands

- After code changes (not docs): `npm run check` (full output, no tail). Fix all errors, warnings, and infos before committing. Does not run tests.
- Never run `npm run build` or `npm test` unless requested by the user.
- Never run the full vitest suite directly: it includes e2e tests that activate when endpoint/auth env vars are present. For all non-e2e tests, run `./test.sh` from the repo root. Otherwise run specific tests from the package root: `node ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts`.
- If you create or modify a test file, run it and iterate on test or implementation until it passes.
- For `packages/coding-agent/test/suite/`, use `test/suite/harness.ts` + the faux provider. No real provider APIs, keys, or paid tokens.
- Put issue-specific regressions under `packages/coding-agent/test/suite/regressions/` named `<issue-number>-<short-slug>.test.ts`.
- For ad-hoc scripts, `write` them to a temp directory (`$env:TEMP` or `C:\Users\LiPeiPei\AppData\Local\Temp`), run, edit if needed, remove when done. Don't embed multi-line scripts in `bash` commands.
- Never commit unless the user asks.

## Dependency and Install Security

- Treat npm dep and lockfile changes as reviewed code. Direct external deps stay pinned to exact versions.
- Hydrate/update locally with `npm install --ignore-scripts`; clean/CI-style with `npm ci --ignore-scripts`. Don't run lifecycle scripts unless the user asks.
- If dep metadata changes, refresh `package-lock.json` with `npm install --package-lock-only --ignore-scripts`.
- If `packages/coding-agent/npm-shrinkwrap.json` needs regen, run `node scripts/generate-coding-agent-shrinkwrap.mjs` (verify with `--check` or `npm run check`). New deps with lifecycle scripts require review and an explicit allowlist entry in that script; never add one silently.
- Pre-commit blocks lockfile commits unless `PI_ALLOW_LOCKFILE_CHANGE=1`. Don't bypass unless the user wants the lockfile change committed.

## Git

Multiple pi sessions may be running in this cwd at the same time, each modifying different files. Git operations that touch unstaged, staged, or untracked files outside your own changes will stomp on other sessions' work. Follow these rules:

Committing:

- Only commit files YOU changed in THIS session.
- Stage explicit paths (`git add <path1> <path2>`); never `git add -A` / `git add .`.
- Before committing, run `git status` and verify you are only staging your files.
- `packages/ai/src/models.generated.ts` may always be included alongside your files.

Never run (destroys other agents' work or bypasses checks):

- `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git add .`, `git commit --no-verify`.

If rebase conflicts occur:

- Resolve conflicts only in files you modified.
- If a conflict is in a file you did not modify, abort and ask the user.
- Never force push.

## Windows Development Notes

- **OS**: Windows (PowerShell 7+). All shell commands use PowerShell syntax.
- **Temp directory**: Use `$env:TEMP` or `C:\Users\LiPeiPei\AppData\Local\Temp\opencode` for temp work.
- **Scripts**: Use `pi-test.bat` or `pi-test.ps1` to run pi from sources (not `pi-test.sh`).
- **Test runner**: `./test.sh` works in Git Bash or WSL. For PowerShell, run specific tests directly: `node ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts`.
- **Binary tools**: `my-agent/bin/` contains `fd.exe` and `rg.exe` for Windows. The Obsidian extension auto-detects these.
- **Task Scheduler**: The scheduler extension uses Windows Task Scheduler (`schtasks`) instead of crontab.

When reviewing PRs:

- Do not run `gh pr checkout`, `git switch`, or otherwise move the worktree to the PR branch unless the user explicitly asks.
- Use `gh pr view`, `gh pr diff`, `gh api`, and local `git show`/`git diff` against fetched refs to inspect PR metadata, commits, and patches without changing branches.
- If you need PR file contents, fetch/read them into temporary files or use `git show <ref>:<path>` without switching branches.

When creating issues:

## Custom Extensions (my-agent/)

This project includes custom extensions in `my-agent/` that are loaded when pi runs:

- **`my-agent/SYSTEM.md`**: System prompt for the personal AI assistant (Obsidian, scheduling, English tutoring)
- **`my-agent/AGENTS.md`**: Runtime context for the agent (user preferences, tool usage rules)
- **`my-agent/extensions/obsidian.ts`**: Obsidian vault integration (read/write/search/record)
- **`my-agent/extensions/scheduler.ts`**: Scheduled task management (Windows Task Scheduler + crontab)
- **`my-agent/skills/`**: On-demand skill definitions (diet, exercise, learning, work tracking)
- **`my-agent/prompts/`**: Reusable prompt templates (daily-summary, weekly-review)
- **`my-agent/bin/`**: Windows binaries (fd.exe, rg.exe)

When modifying extensions, run `npm run check` from root and test with `pi-test.ps1`.

## Build and Packaging

- **Build all**: `npm run build`
- **Build binary (exe)**: `scripts/build-binaries.ps1` compiles a standalone `pi.exe` with `my-agent/` bundled
- **Installer**: `scripts/pi-setup.iss` (Inno Setup) creates a Windows installer
- **Config priority for binary**: `pi.exe` reads config from `<exe-dir>/my-agent/` first (if SYSTEM.md or AGENTS.md exists), then falls back to `~/.pi/agent/`

## Changelog

Location: `packages/*/CHANGELOG.md` (one per package).

Sections under `## [Unreleased]`: `### Breaking Changes`, `### Added`, `### Changed`, `### Fixed`, `### Removed`.

Rules:

- All new entries go under `## [Unreleased]`. Read the full section first and append to existing subsections; never duplicate them.
- Released version sections (e.g. `## [0.12.2]`) are immutable; never modify them.

Attribution:

- Internal (from issues): `Fixed foo bar ([#123](https://github.com/earendil-works/pi-mono/issues/123))`
- External contributions: `Added feature X ([#456](https://github.com/earendil-works/pi-mono/pull/456) by [@username](https://github.com/username))`

## Releasing

**Lockstep versioning**: all packages share one version; every release updates all together. `patch` = fixes + additions, `minor` = breaking changes. No major releases.

1. **Update CHANGELOGs**: ask the user whether they ran the `/cl` prompt on the latest commit on `main`. If not, they must run `/cl` first to audit and update each package's `[Unreleased]` section before releasing.

2. **Local smoke test**: build an unpublished release and smoke test from outside the repo (so it can't resolve workspace files):
   ```bash
   npm run release:local -- --out /tmp/pi-local-release --force
   cd /tmp

   # Node package install smoke tests
   /tmp/pi-local-release/node/pi --help
   /tmp/pi-local-release/node/pi --version
   /tmp/pi-local-release/node/pi --list-models
   /tmp/pi-local-release/node/pi -p "Say exactly: ok"
   /tmp/pi-local-release/node/pi

   # Bun binary smoke tests
   /tmp/pi-local-release/bun/pi --help
   /tmp/pi-local-release/bun/pi --version
   /tmp/pi-local-release/bun/pi --list-models
   /tmp/pi-local-release/bun/pi -p "Say exactly: ok"
   /tmp/pi-local-release/bun/pi
   ```
   Verify both Node and Bun startup, model/account listing, interactive startup, and at least one real prompt with the intended default provider. The bare commands `/tmp/pi-local-release/node/pi` and `/tmp/pi-local-release/bun/pi` start interactive mode; run each in tmux, submit a prompt, and wait for the model reply before considering the interactive smoke test passed. Failures are release blockers unless the user explicitly accepts the risk.

3. **Run the release script**:
   ```bash
   npm run release:patch    # fixes + additions
   npm run release:minor    # breaking changes
   ```
   The release script bumps all package versions, updates changelogs, regenerates release artifacts, runs `npm run check`, commits `Release vX.Y.Z`, tags `vX.Y.Z`, adds fresh `## [Unreleased]` changelog sections, commits `Add [Unreleased] section for next cycle`, then pushes `main` and the tag. Do not rerun the release script after a tag was pushed.

4. **CI publishes npm packages**: pushing the `vX.Y.Z` tag triggers `.github/workflows/build-binaries.yml`. The `publish-npm` job uses npm trusted publishing through GitHub Actions OIDC with environment `npm-publish`; no local `npm publish`, `npm whoami`, OTP, or WebAuthn flow is required.

5. **If CI publish fails**: inspect the failed `publish-npm` job. The publish helper is idempotent and skips package versions already present on npm, so rerun the tag workflow after fixing CI or transient npm issues. Do not rerun `npm run release:patch` or `npm run release:minor` for the same version.


## User Override

If the user's instructions conflict with any rule in this document, ask for explicit confirmation before overriding. Only then execute their instructions.

## Critical Pitfalls

### Bun Binary Config Directory Resolution (`getAgentDir()`)

`packages/coding-agent/src/config.ts` 的 `getAgentDir()` 函数**必须**包含 `isBunBinary` 检查逻辑，使编译后的 `pi.exe` 优先从 `exe同目录/my-agent/` 加载配置：

```typescript
if (isBunBinary) {
    const exeDir = dirname(process.execPath);
    const localAgentDir = join(exeDir, "my-agent");
    if (existsSync(join(localAgentDir, "SYSTEM.md")) || existsSync(join(localAgentDir, "AGENTS.md"))) {
        return localAgentDir;
    }
}
```

**为什么重要**：没有这段逻辑，安装后的 `pi.exe` 会直接使用全局 `~/.pi/agent/` 配置，忽略安装目录下的 `my-agent/` 自定义配置。这意味着安装程序打包的 SYSTEM.md、AGENTS.md 等配置文件永远不会被读取。

**历史**：提交 `207c1f363` 添加了此逻辑，后在合并/重构中丢失。`isBunBinary` 在同文件的 `detectInstallMethod()`（行 62）、`getPackageDir()`（行 350）、`getInteractiveAssetsDir()`（行 429）中都有使用，但 `getAgentDir()` 中的检查被遗漏了。

**检查规则**：
- 修改 `config.ts` 时，必须确认 `getAgentDir()` 保留了 `isBunBinary` 本地配置逻辑
- `isBunBinary` 已在文件顶部定义（行 19），直接引用即可
- 此逻辑影响所有通过 `getAgentDir()` 派生的路径：sessions、auth、settings、themes、prompts、tools、bin

### Build Script Config File Source Priority

`scripts/build-binaries.ps1` 复制 `my-agent/` 配置文件时，必须按以下优先级：
1. 仓库根目录 `my-agent/`（用户自定义配置）
2. `packages/coding-agent/dist/modes/interactive/my-agent/`（构建产物）
3. 创建空文件作为兜底

**不要**只从 `dist/` 读取，否则用户在仓库根目录 `my-agent/` 下的自定义配置不会被打包进安装程序。

### ISS Installer Config File Flags

`scripts/pi-setup.iss` 中用户配置文件使用 `onlyifdoesntexist` 标志：
- `SYSTEM.md`、`AGENTS.md`、`COMMIT.md` 等 — 升级时不覆盖
- `sessions/`、`prompts/`、`themes/`、`tools/` — 卸载时不删除
- `auth.json`、`settings.json`、`models.json`、`oauth.json` — 永不覆盖（由 ISS `[Dirs]` 的 `uninsneveruninstall` 保护）

修改 ISS 脚本时，不要将这些标志改为 `ignoreversion`，否则会覆盖用户数据。
