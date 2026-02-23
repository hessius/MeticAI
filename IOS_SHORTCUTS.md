# iOS Shortcuts Setup

Control MeticAI with one tap from your iPhone using Apple Shortcuts.

> **Tip:** The web interface at `http://<SERVER_IP>:3550` is easier and more feature-rich for most users.

## Quick Setup

1. Open the **Shortcuts** app
2. Tap **+** to create a new shortcut
3. Add the actions below for your preferred workflow

### Photo → Profile (Recommended)

| # | Action | Configuration |
|---|--------|---------------|
| 1 | **Take Photo** | Show Camera Preview = On |
| 2 | **Get Contents of URL** | URL: `http://<SERVER_IP>:3550/api/analyze_and_profile`, Method: POST, Body: Form, Field: `file` = Photo |
| 3 | **Get Dictionary Value** | Key: `reply`, Dictionary: Contents of URL |
| 4 | **Show Notification** | Text: Dictionary Value |

### Photo + Preferences

Same as above, but add an **Ask for Input** action before the URL action:
- Question: "Any preferences? (e.g., bold, fruity)"
- Add a second form field: `user_prefs` = Provided Input

### Text Only (No Photo)

| # | Action | Configuration |
|---|--------|---------------|
| 1 | **Ask for Input** | "How do you want this brewed?" |
| 2 | **Get Contents of URL** | URL: `http://<SERVER_IP>:3550/api/analyze_and_profile`, Method: POST, Body: Form, Field: `user_prefs` = Provided Input |
| 3 | **Get Dictionary Value** | Key: `reply` |
| 4 | **Show Notification** | Text: Dictionary Value |

### Analysis Only (No Profile)

Same as Photo workflow but use endpoint: `http://<SERVER_IP>:3550/api/analyze_coffee` and key: `analysis`

## Troubleshooting

- **Connection fails** — Ensure your phone is on the same network. Test `http://<SERVER_IP>:3550/docs` in Safari.
- **Invalid response** — Check field names are exactly `file` and/or `user_prefs` (case-sensitive).
- **Photo won't upload** — Ensure the form field key is `file` and value comes from the Take Photo action.
