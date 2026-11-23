---
name: mydex
description: Install, pair, diagnose, update or remove the Mydex independent Windows, Linux and macOS phone connector, and adapt already-installed Coding tools to their original desktop conversations.
---

# Mydex Agent installation

Use the independent background service. A Coding host is only the management entrypoint; closing it must not stop phone connectivity. Keep the existing desktop EXE available.

## Installation

Use the released Mydex Agent package containing its bundled runtime and signed `agent-package.json`. Never download or install another Coding application to work around incompatibility. Do not use the older EXE updater for this installation mode.

Detect OS and CPU, choose its matching signed package. Use a user-chosen dedicated directory; on Windows prefer a non-C drive. Linux requires a working systemd user session, macOS a logged-in graphical launchd session. On Linux/macOS run `sh <package>/desktop/headless/install.sh <absolute-install-directory>` instead of PowerShell. The installed `<root>/mydex-agent` supports `status`, `start`, `configureHub`, `pair` and lifecycle commands. Use `<root>/mydex-mcp.json` to merge the MCP entry. Do not run sudo or create console windows. The Windows instructions below apply only on Windows. Run the package's `desktop/headless/manage.ps1 -Action install -Package <extracted-package-directory> -Root <installation-directory>` with Windows PowerShell in a hidden process (CreateNoWindow/windowsHide); never open a console window. Read the actual result; a started process is not a completed installation.

Installation creates a login startup task, `Mydex-Agent.ps1`, a host-neutral `mydex-mcp.json`, and protected local configuration. Add the MCP entry to the current host only when the user is using this integration there; merge without removing existing entries. No model account, API supplier or model key belongs in this configuration.

Use `mydex_status` and `mydex_defaults`. Configure a new instance through `mydex_configure` only when no profile exists. Check the suggested port is available. Never overwrite an existing profile or silently start a second gateway on its port. An existing desktop installation can remain available, but a shared profile needs an explicit, verified handover from its current owner.

Reuse the user's known mobile choice; otherwise ask Android application or mobile website. Use `mydex_pair`, let the user scan the locally displayed QR and confirm where required. Do not read QR payloads, permanent tokens or private configuration into conversation output. Check actual phone connectivity before claiming pairing succeeded.

## Existing applications and adapters

Prefer official APIs, supported extension/MCP hooks, and existing reachable application interfaces or configuration. Do not create a modified fork or replacement Coding application. Never treat general installation authorization as permission to patch original application files. Run `mydex_diagnostics` first. For already-installed supported tools, use `mydex_install_bridge` and then verify the original application/session interface. A bridge file being installed is not proof of send capability. Running applications may need the user to close and reopen them; never terminate unsaved work. Store-copy/replacement-app installation is disabled in this mode.

If a specific application is incompatible, collect a minimal diagnostic (application version, structural capability checks, adapter error; no chats, keys or provider configuration). Inspect the original adapter source and application-provided interfaces. If interface-only integration is unavailable, report the capability as unsupported. Only after separate user consent for the specific original-file modification may you build a narrowly scoped reversible patch with backups, feature checks, restoration and tests; only then pass `allowOriginalAppPatch: true`. Default one-click installation must not modify original application files. Do not use a separate CLI conversation as a substitute for the user's original desktop conversation.

Before contributing a patch to the public adapter ecosystem, review the exact diff and artifact: only original adapter code, license and sanitized reproducible tests. Exclude proprietary application bundles, credentials, private conversations, local configuration and user identifiers. Report unsupported cases honestly. Publish only to a concrete authorized public target; a candidate patch is not a verified compatibility claim.

## Updates and removal

Use `mydex_check_update` to select the current OS/CPU release from the signed stable index. Download its URL, verify SHA-256, extract, then use `mydex_update` with the extracted, signed Agent package directory, then poll `mydex_operation`. Verify service connectivity and preservation of device identity after completion. The updater stages a separate release, switches the active pointer and rolls back failed startup. Never report success from the initial operation receipt.

Before uninstalling, restore bridges installed for this instance individually when requested; restore operations may require the original application to be closed. `mydex_uninstall` removes the independent service and startup registration, preserves user configuration, and closes this MCP transport. Read its returned local receipt after the process exits to confirm actual completion. Do not remove the existing EXE, other applications or user data.

For CLI-only hosts, `powershell -NoProfile -File <root>/Mydex-Agent.ps1 status` provides the same control path. For structured arguments prefer a UTF-8 JSON file: `configureHub @<file>`; after configuration call `start`. `install`, `update <package-directory>` and `uninstall` return asynchronous operation receipts. Read those receipts to distinguish start from success.
