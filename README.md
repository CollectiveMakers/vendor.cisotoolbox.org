# Vendor (TPRM) -- Third-Party Risk Management

> Part of [CISO Toolbox](https://www.cisotoolbox.org) -- open-source security tools for CISOs.

## Features

- Vendor registry with 6-axis classification (data sensitivity, business criticality, access level, contractual maturity, replacement difficulty, regulatory exposure)
- Threat level calculation: (D x P) / (M x C) aligned with EBIOS RM methodology
- 25-question security assessment + 5 DORA-specific questions per vendor
- Custom questionnaire import via CSV
- 5x5 risk matrix with residual risk tracking
- Risk timeline with interactive slider to visualize risk evolution
- Document tracking with expiry alerts and status management
- Import/export with Risk (EBIOS RM) for integrated risk analysis
- AI assistant (Anthropic Claude / OpenAI GPT)
- AES-256-GCM encrypted snapshots (PBKDF2 250k iterations)
- Bilingual FR/EN with lazy-loaded translations

## Quick Start

1. Visit [vendor.cisotoolbox.org](https://vendor.cisotoolbox.org) or clone this repo
2. Open `index.html` in a browser
3. Load `demo-en.json` from File > Open to explore a complete vendor assessment (MedSecure)
4. No backend, no account required

## Architecture

- 100% client-side vanilla JS -- no framework, no build step
- Data stored in browser (localStorage autosave + file download for persistence)
- Event delegation via `data-click` attributes (CSP compliant, no inline handlers)
- AES-256-GCM encryption for snapshots
- Shared libraries: `cisotoolbox.js`, `i18n.js`, `ai_common.js`

## Import / Export

| Format | Import | Export |
|--------|--------|--------|
| JSON | Yes | Yes |
| Encrypted JSON (AES-256-GCM) | Yes | Yes |
| Risk (EBIOS RM) JSON | Yes | Yes |
| Custom questionnaire (CSV) | Yes | -- |

## Screenshots

_Coming soon_

## License

MIT

## Links

- Website: https://vendor.cisotoolbox.org
- CISO Toolbox: https://www.cisotoolbox.org
