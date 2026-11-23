# 2026-11-01 lightweight connection release

- Android 0.2.14 (17), Windows 0.4.14, macOS 0.5.1-preview.3.
- Windows laptop and mini installed; original profile, gateway config and certificate hashes retained.
- Both gateways served identical APK: 51138506 bytes, SHA256 32f263d149cc8768a05f61687dff3e17fed6b7f2d4b68f1d4cbffbc6f254833d.
- Real pinned TLS requests and WebSocket verified through public relay; direct route and LAN discovery verified with unavailable relay. One-time QR credential redemption verified against real gateway.
- Node: 59 pass, 3 platform skips; Flutter transport/deletion/pairing 6 pass; client UI 21 pass; analyze lib clean. macOS CI build and smoke passed both architectures.
- Public GitHub packages, website download links, signed Windows manifest, native Android update endpoints synchronized. Website HTML and gzip both updated. Web app JS was not redeployed to preserve concurrent Huawei browser text compatibility fix.
- Screenshots retained under test/goldens and D:/Software/MydexMaintenance/release-0214.
- No phone camera or physical Android installation test was possible. macOS real-machine test waived. VPN global/TUN mode compatibility not claimed; website/manual advise rule/split mode.
