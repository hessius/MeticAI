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

## Import Profile from Share Sheet

Share a profile URL (`.json` or `.met`) from any app to import it directly into MeticAI.

### Setup

| # | Action | Configuration |
|---|--------|---------------|
| 1 | **Receive** | URLs from Share Sheet |
| 2 | **URL Encode** | Encode Shortcut Input |
| 3 | **URL** | `http://<SERVER_IP>:3550/?import=` appended with URL Encoded Text |
| 4 | **Open URLs** | Open the URL from step 3 |

### How It Works

MeticAI supports a `?import=<url>` query parameter. When the app loads with this parameter, it automatically opens the import dialog and begins importing the profile from the given URL.

### Alternative: Direct API Import

| # | Action | Configuration |
|---|--------|---------------|
| 1 | **Receive** | URLs from Share Sheet |
| 2 | **Get Contents of URL** | URL: `http://<SERVER_IP>:3550/api/import-from-url`, Method: POST, Body: JSON, `url` = Shortcut Input |
| 3 | **Get Dictionary Value** | Key: `profile_name` |
| 4 | **Show Notification** | Text: "Imported: " + Dictionary Value |
