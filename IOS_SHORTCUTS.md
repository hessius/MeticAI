# iOS Shortcuts Setup

Control MeticAI directly from your iPhone using Apple Shortcuts!

**Note:** Throughout these instructions, `<PI_IP>` refers to your MeticAI server's IP address (e.g., `192.168.1.100`).

**Important:** Taking a photo is **optional**! Most users describe their preferences using tags and natural language (e.g., "Fruity, Traditional, Acidic") without needing a photo.

## Quick Start: Pre-Built Shortcut (Coming Soon)
A ready-to-use shortcut will be available for download. Check back soon for the direct link!

## Manual Setup Options

### Option 1: Text Preferences Only (Recommended) 🌟
This is the most common workflow - describe how you want your coffee brewed using natural language and tags.

**Steps to create:**
1. Open the **Shortcuts** app on your iPhone
2. Tap the **+** button to create a new shortcut
3. Add these actions in order:

   **Action 1: Ask for Input**
   - Search for and add "Ask for Input"
   - Set Question: "How do you want this brewed? (e.g., Fruity, Traditional, Acidic)"
   - Set Input Type: Text
   - Set Default Answer: "" (leave blank)

   **Action 2: Get Contents of URL**
   - Search for and add "Get Contents of URL"
   - Set URL: `http://<PI_IP>:8000/analyze_and_profile`
   - Set Method: **POST**
   - Add Request Body: **Form**
   - Add form field:
     - Key = `user_prefs`, Value = `Provided Input` (from Action 1)

   **Action 3: Get Dictionary Value**
   - Search for and add "Get Dictionary Value"
   - Set Key: `reply`
   - Set Dictionary: `Contents of URL` (from Action 2)

   **Action 4: Show Notification**
   - Search for and add "Show Notification"
   - Set text to show: `Dictionary Value` (from Action 3)

4. Name your shortcut (e.g., "MeticAI")
5. Tap **Done** to save

**Usage:** Tap the shortcut, enter your preferences (e.g., "Bold, Chocolatey" or "Fruity, Light"), and wait for confirmation!

### Option 2: Photo + Description (Optional) 📸
Use this when you have a coffee bag and want the AI to analyze it along with your preferences.

**Steps to create:**
1. Open the **Shortcuts** app on your iPhone
2. Tap the **+** button to create a new shortcut
3. Add these actions in order:

   **Action 1: Take Photo**
   - Search for and add "Take Photo"
   - Configure: Show Camera Preview = On

   **Action 2: Ask for Input** (Optional preferences)
   - Search for and add "Ask for Input"
   - Set Question: "How do you want this brewed? (e.g., Fruity, Traditional, Acidic)"
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

   **Action 4: Get Dictionary Value**
   - Search for and add "Get Dictionary Value"
   - Set Key: `reply`
   - Set Dictionary: `Contents of URL` (from Action 3)

   **Action 5: Show Notification**
   - Search for and add "Show Notification"
   - Set text to show: `Dictionary Value` (from Action 4)

4. Name your shortcut (e.g., "MeticAI Coffee")
5. Tap **Done** to save

**Usage:** Tap the shortcut, take a photo of your coffee bag, optionally add preferences, and wait for confirmation!

### Option 3: Photo Only ⚡
Just snap a photo and let MeticAI analyze the bag and create a profile automatically.

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

   **Action 3: Get Dictionary Value**
   - Add "Get Dictionary Value"
   - Key: `reply`
   - Dictionary: `Contents of URL` (from Action 2)

   **Action 4: Show Notification**
   - Add "Show Notification"
   - Text: `Dictionary Value` (from Action 3)

4. Name and save your shortcut

**Usage:** One tap → photo → profile created automatically!

### Advanced: Coffee Analysis Only 🔍
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

   **Action 3: Get Dictionary Value**
   - Add "Get Dictionary Value"
   - Key: `analysis`
   - Dictionary: `Contents of URL` (from Action 2)

   **Action 4: Show Result**
   - Add "Show Result"
   - Content: `Dictionary Value` (from Action 3)

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
- Add "Get Dictionary Value" action to extract the `reply` field from the response
- Review the notification output for error messages from the server

**Photo not uploading (when using photo option):**
- Ensure the form field key is exactly `file` (lowercase)
- Verify the value is set to the photo output from the "Take Photo" action
- Try taking a new photo instead of selecting from the library

**Preferences not being applied:**
- Ensure the form field key is exactly `user_prefs` (case-sensitive)
- Check that the input action allows empty input if you want it to be optional
- Verify the value is connected to the "Provided Input" from the Ask for Input action

**Response not showing properly:**
- Use "Get Dictionary Value" action to extract specific fields from the JSON response
- For profile creation, use key `reply` to get the confirmation message
- For coffee analysis, use key `analysis` to get the analysis results

## Tips for Best Results

- **Text preferences work best:** Most users get great results with just text like "Fruity, Traditional, Acidic"
- **Be specific:** Use descriptive tags and styles like "Bold, Chocolatey" or "Bright, Light roast"
- **Photos are optional:** Only add photos if you want the AI to analyze the specific coffee bag
- **Good lighting (if using photos):** Take photos in well-lit areas for better analysis
- **Experiment:** Try different extraction styles: "turbo shot", "traditional", "ristretto"
