# iOS Shortcuts Setup

Control MeticAI directly from your iPhone using Apple Shortcuts!

**Note:** Throughout these instructions, `<PI_IP>` refers to your MeticAI server's IP address (e.g., `192.168.1.100`).

## Quick Start: Pre-Built Shortcut (Coming Soon)
A ready-to-use shortcut will be available for download. Check back soon for the direct link!

## Manual Setup Options

### Option 1: Photo + Description (Recommended) 🌟
This workflow lets you photograph your coffee bag and optionally add preferences for the most personalized profile.

**Steps to create:**
1. Open the **Shortcuts** app on your iPhone
2. Tap the **+** button to create a new shortcut
3. Add these actions in order:

   **Action 1: Take Photo**
   - Search for and add "Take Photo"
   - Configure: Show Camera Preview = On

   **Action 2: Ask for Input** (Optional preferences)
   - Search for and add "Ask for Input"
   - Set Question: "Any preferences? (e.g., 'bold and chocolatey', or leave blank)"
   - Set Input Type: Text
   - Configure: Allow empty input

   **Action 3: Get Contents of URL**
   - Search for and add "Get Contents of URL"
   - Set URL: `http://<PI_IP>:8000/analyze_and_profile`
   - Set Method: **POST**
   - Add Request Body: **Form**
   - Add two form fields:
     - Field 1: Key = `file`, Value = `Photo` (from Action 1)
     - Field 2: Key = `user_prefs`, Value = `Provided Input` (from Action 2)

   **Action 4: Show Notification**
   - Search for and add "Show Notification"
   - Set text to show: `Contents of URL` (from Action 3)

4. Name your shortcut (e.g., "MeticAI Coffee")
5. Tap **Done** to save

**Usage:** Tap the shortcut, take a photo of your coffee bag, optionally add preferences, and wait for confirmation!

### Option 2: Photo Only ⚡
Fastest option - just snap a photo and let MeticAI create the perfect profile automatically.

**Steps to create:**
1. Open the **Shortcuts** app
2. Create a new shortcut
3. Add these actions:

   **Action 1: Take Photo**
   - Add "Take Photo"
   - Show Camera Preview = On

   **Action 2: Get Contents of URL**
   - Add "Get Contents of URL"
   - URL: `http://<PI_IP>:8000/analyze_and_profile`
   - Method: **POST**
   - Request Body: **Form**
   - Add form field: Key = `file`, Value = `Photo` (from Action 1)

   **Action 3: Show Notification**
   - Add "Show Notification"
   - Text: `Contents of URL` (from Action 2)

4. Name and save your shortcut

**Usage:** One tap → photo → profile created automatically!

### Option 3: Description Only 💬
Create profiles based on text descriptions when you don't have a photo.

**Steps to create:**
1. Open the **Shortcuts** app
2. Create a new shortcut
3. Add these actions:

   **Action 1: Ask for Input**
   - Add "Ask for Input"
   - Question: "Describe your coffee or preferences"
   - Input Type: Text

   **Action 2: Get Contents of URL**
   - Add "Get Contents of URL"
   - URL: `http://<PI_IP>:8000/analyze_and_profile`
   - Method: **POST**
   - Request Body: **Form**
   - Add form field: Key = `user_prefs`, Value = `Provided Input` (from Action 1)

   **Action 3: Show Notification**
   - Add "Show Notification"
   - Text: `Contents of URL` (from Action 2)

4. Name and save your shortcut

**Usage:** Perfect for requesting specific profiles like "turbo shot" or "ristretto extraction"!

### Advanced: Analysis-Only Shortcut 🔍
For when you just want to identify your coffee without creating a profile:

**Steps to create:**
1. Open the **Shortcuts** app
2. Create a new shortcut
3. Add these actions:

   **Action 1: Take Photo**
   - Add "Take Photo"

   **Action 2: Get Contents of URL**
   - Add "Get Contents of URL"
   - URL: `http://<PI_IP>:8000/analyze_coffee`
   - Method: **POST**
   - Request Body: **Form**
   - Add form field: Key = `file`, Value = `Photo` (from Action 1)

   **Action 3: Show Result**
   - Add "Show Result"
   - Content: `Contents of URL` (from Action 2)

4. Name and save your shortcut

## Troubleshooting

**"Connection Failed" or timeout errors:**
- Verify your iPhone is on the same network as your MeticAI server
- Double-check the IP address in your shortcut matches your server's IP
- Ensure MeticAI is running: `docker ps` should show the coffee-relay container
- Test the connection in Safari: navigate to `http://<PI_IP>:8000/docs`

**"Invalid Response" or unexpected results:**
- Make sure you're using the correct endpoint (`/analyze_and_profile` or `/analyze_coffee`)
- Verify the HTTP method is set to **POST**
- Check that form field names are exactly `file` and/or `user_prefs` (case-sensitive)
- Review the notification output for error messages from the server

**Photo not uploading:**
- Ensure the form field key is exactly `file` (lowercase)
- Verify the value is set to the photo output from the "Take Photo" action
- Try taking a new photo instead of selecting from the library

**Preferences not being applied:**
- Ensure the form field key is exactly `user_prefs` (case-sensitive)
- Check that the input action allows empty input if you want it to be optional
- Verify the value is connected to the "Provided Input" from the Ask for Input action

## Tips for Best Results

- **Good lighting:** Take photos in well-lit areas for better coffee bag analysis
- **Clear labels:** Ensure the coffee bag label is visible and in focus
- **Specific preferences:** Use descriptive terms like "bright and fruity" or "bold with chocolatey notes"
- **Experiment:** Try different extraction styles in your preferences: "turbo shot", "traditional", "ristretto"
