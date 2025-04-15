# Linkedin Surf

A Chrome extension that automates job searches on LinkedIn based on given criterias. It helps eliminate duplicates and off-target postings, focusing on onsite roles, and exports matched jobs directly to Google Sheets. It leverages the OpenAI API to intelligently determine if job listings match personalized conditions.

## Rationale

While searching for jobs on LinkedIn, I encountered two major pain points:

- **Repetitiveness**: After browsing several pages (especially page 5 and beyond), I found too many repetitive job postings, which slowed down the process significantly.
- **Irrelevant Listings**: Many job listings did not match my target role—even when filtered by standard criteria, roles that I wasn't interested in would still show up.

To address these issues, I created this extension. It automatically scrolls through the job listings, removes duplicate postings, and uses predefined keyword filters along with the OpenAI API to ensure only the most relevant jobs (e.g., frontend, fullstack, tech lead roles, and similar) are presented. This streamlines the job search process by quickly delivering a curated list of matching jobs directly to Google Sheets.

## Features

- **Auto-scrolls job listings** to load all results.
- **Extracts job details**: title, company, location, URL.
- **Filters jobs based on**:
  - Title keywords (includes frontend, fullstack, etc.)
  - Location (must be in Indonesia, excludes remote/hybrid)
- **AI-Powered Job Matching**: Uses OpenAI API to determine if job listings match user-specified conditions.
- **Removes duplicates**.
- **Exports filtered results directly to Google Sheets**.
- **Opens the Google Sheet** automatically after scraping completes.

## Installation

1. Clone this repository or download it as a ZIP file.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable "Developer mode" (toggle in the top-right corner).
4. Click "Load unpacked" and select the directory containing the extension files.
5. The Linkedin Surf extension should now appear in your extensions list.

## Usage

1. Go to a LinkedIn job search page (e.g., `https://www.linkedin.com/jobs/search/...`).
2. Click on the extension icon in your browser toolbar.
3. Input your preferences and OpenAI API key:

   ![Popup](./popup.jpg)

4. Click "Start Filtering Jobs" in the popup.
5. Authorize access to your Google account when prompted.
6. Wait while the extension scrolls through and processes all job listings.
7. When finished, a new Google Sheet will be created and opened automatically with your filtered jobs.

   ![Generated spreadsheet](./generated-csv.jpg)

## Google Sheets Integration

The extension authenticates with your Google account and:

1. Creates a new spreadsheet titled "LinkedIn Jobs - [timestamp]"
2. Adds a header row with column names
3. Appends each matching job as a new row in real-time
4. Opens the spreadsheet in a new tab when scraping is complete

This allows you to view, sort, filter, and share your job search results more easily than with a CSV file.

## OpenAI Integration

The extension uses the OpenAI API to analyze job descriptions and determine if they match your criteria. To use this feature:

1. You'll need an OpenAI API key (get one at https://platform.openai.com)
2. Enter your API key in the extension popup
3. The extension uses GPT-4o Mini to analyze job descriptions and determine relevance

The AI model is configured to only respond with "YES" or "NO" when evaluating if a job meets your criteria, ensuring fast and efficient matching.

## Permissions

This extension requires the following permissions:
- `activeTab`: To access the LinkedIn job search page
- `storage`: To save your preferences
- `identity`: To authenticate with Google
- Access to sheets.googleapis.com: To create and update Google Sheets
- Access to api.openai.com: For AI-powered job matching
