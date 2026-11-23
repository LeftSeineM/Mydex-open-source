# New-domain client release — 2026-11-01

Android 0.2.15 (18), Windows 0.4.15 and Mac preview 0.5.1-preview.4 built and published. Website and download entries use app.leftseinem.com. Android and Windows settings include website/download entry. Mac website link updated. Desktop QR default origin updated.

Updater accepts pinned signed manifests for only the canonical and legacy domains; new clients fetch canonical first, legacy second, GitHub last. Legacy clients receive a legacy-domain signed package URL through nginx host-based manifest routing, preventing update rejection by their old origin allowlist. GitHub fallback retains legacy-compatible signed manifest. Hash/signature protection retained.

Windows laptop and mini installed 0.4.15 with profiles preserved. Both gateway Android update feeds synchronized. Public canonical Android and Windows full downloads hash verified; canonical and legacy manifest version and URL checked. Real laptop through new relay: device list and WebSocket success. Four updater tests and five pairing/deletion tests pass; analyze lib clean. Mac CI built and smoke-tested both architectures; no physical Mac or Android camera test.

Personal static page is hosted on mini, existing nginx and Cloudflare Tunnel. Direct checks of new personal and app domains returned 200; user-reported intermittent failure not reproduced. Existing hosts and services preserved.
