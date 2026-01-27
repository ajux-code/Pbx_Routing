# PBX Integration

Yeastar P-Series PBX integration for Frappe/ERPNext.

## Features

- Automatic customer lookup on incoming calls (screen pop)
- Click-to-call from Customer/Lead/Contact forms
- Call logging and history
- Recording access and playback
- Agent status monitoring

## Installation

```bash
bench get-app pbx_integration
bench --site [sitename] install-app pbx_integration
```

## Configuration

1. Go to **PBX Settings** in Frappe
2. Enter your Yeastar API credentials
3. Configure webhook URL in Yeastar admin panel
4. Map extensions to users

## License

MIT
