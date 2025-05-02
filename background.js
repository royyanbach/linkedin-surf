// Store configuration
let config = {
  sheetId: null,  // Will store the created/target spreadsheet ID
  sheetName: 'LinkedIn Jobs'
};

// Listen for clicks on the extension icon
chrome.action.onClicked.addListener((tab) => {
  // Check if the current page is a LinkedIn jobs search page
  if (tab.url.includes('linkedin.com/jobs/search') || tab.url.includes('linkedin.com/jobs/collections')) {
    // Authenticate with Google first
    authenticateWithGoogle().then(() => {
      // Send a message to the content script to start scraping
      chrome.tabs.sendMessage(tab.id, { action: 'startScraping' });
    }).catch(error => {
      console.error('Authentication failed:', error);
      // Show error to user
      chrome.tabs.sendMessage(tab.id, {
        action: 'showNotification',
        message: 'Failed to authenticate with Google. Please try again.'
      });
    });
  } else {
    // Notify user if they're not on a LinkedIn jobs page
    chrome.tabs.create({ url: 'https://www.linkedin.com/jobs/' });
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'resetMatchedJobs') {
    if (message.sheetId) {
      // Use the existing sheet
      config.sheetId = message.sheetId;

      // Check if the sheet exists and we have access to it
      verifySheetAccess(message.sheetId).then(() => {
        // Skip adding header row for existing sheets
        sendResponse({ success: true, sheetId: message.sheetId });
      }).catch(error => {
        console.error('Failed to verify sheet access:', error);
        // If verification fails, create a new sheet
        createNewSheet().then(sheetId => {
          config.sheetId = sheetId;
          sendResponse({ success: true, sheetId });
        }).catch(createError => {
          sendResponse({ success: false, error: createError.message });
        });
      });
    } else {
      // Create a new Google Sheet for this session
      createNewSheet().then(sheetId => {
        config.sheetId = sheetId;
        sendResponse({ success: true, sheetId });
      }).catch(error => {
        console.error('Failed to create sheet:', error);
        sendResponse({ success: false, error: error.message });
      });
    }
    return true; // Indicate async response
  }
  else if (message.action === 'addMatchedJob') {
    // Add the job directly to Google Sheets
    appendToSheet(message.job).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      console.error('Failed to append to sheet:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Indicate async response
  }
  else if (message.action === 'finishScraping') {
    // Send a link to the Google Sheet
    if (config.sheetId) {
      const sheetUrl = `https://docs.google.com/spreadsheets/d/${config.sheetId}/edit`;

      // Send a status update to the popup if it's open
      try {
        chrome.runtime.sendMessage({
          action: 'updateScrapingStatus',
          status: `Scraping completed. View your data in Google Sheets.`,
          sheetUrl
        });
      } catch (e) {
        // Popup might be closed, ignore error
        console.log("Popup not open, skipping status update:", e.message);
      }
    } else {
      // Send a status update to the popup if it's open
      try {
        chrome.runtime.sendMessage({
          action: 'updateScrapingStatus',
          status: 'No jobs matched your filter criteria or sheet creation failed.',
          isError: true
        });
      } catch (e) {
        // Popup might be closed, ignore error
        console.log("Popup not open, skipping status update:", e.message);
      }
    }
    sendResponse({ success: true });
  }
  else if (message.action === 'scrapingError') {
    console.error('Scraping error:', message.error);
    // Send a status update to the popup if it's open
    try {
      chrome.runtime.sendMessage({
        action: 'updateScrapingStatus',
        status: `Error during scraping: ${message.error}`,
        isError: true
      });
    } catch (e) {
      // Popup might be closed, ignore error
      console.log("Popup not open, skipping status update:", e.message);
    }
    sendResponse({ success: true });
  }
  else if (message.action === 'verifySheetAccess') {
    // Directly verify access to the sheet
    verifySheetAccess(message.sheetId)
      .then(() => {
        // Access verified, send success response
        sendResponse({ success: true });
      })
      .catch(error => {
        // Access failed, send error response
        console.error('Sheet access verification failed:', error);
        sendResponse({
          success: false,
          error: error.message || 'Failed to access sheet. Check the Sheet ID and ensure you have permission.'
        });
      });
    return true; // Indicate async response
  }

  // Return true to indicate we'll respond asynchronously
  return true;
});

// Authenticate with Google using OAuth
async function authenticateWithGoogle() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, function(token) {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError || new Error('Failed to get auth token'));
        return;
      }
      resolve(token);
    });
  });
}

// Create a new Google Sheet for this session
async function createNewSheet() {
  const token = await authenticateWithGoogle();
  const timestamp = new Date().toLocaleString().replace(/[/\\:]/g, '-');

  const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      properties: {
        title: `LinkedIn Jobs - ${timestamp}`
      },
      sheets: [
        {
          properties: {
            title: config.sheetName
          }
        }
      ]
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create sheet: ${error.error.message}`);
  }

  const data = await response.json();

  // Set up header row
  await appendToSheet({
    isHeader: true,
    title: 'Title',
    company: 'Company',
    location: 'Location',
    id: 'Job ID',
    originalPostedAt: 'Original Posted Time',
    lastPostedAt: 'Posted Time',
    estimateTotalApplicants: 'Applicants',
    matchCriteria: 'Match Criteria'
  }, data.spreadsheetId);

  return data.spreadsheetId;
}

// Append a job to the Google Sheet
async function appendToSheet(job, sheetId = null) {
  const token = await authenticateWithGoogle();
  const spreadsheetId = sheetId || config.sheetId;

  if (!spreadsheetId) {
    throw new Error('No spreadsheet ID available');
  }

  let values = [];

  if (job.isHeader) {
    // This is a header row
    values = [
      [
        job.title,
        job.company,
        job.location,
        job.id,
        job.originalPostedAt,
        job.lastPostedAt,
        job.estimateTotalApplicants,
        job.matchCriteria
      ]
    ];
  } else {
    // Format job data for sheet
    values = [
      [
        job.title,
        job.company,
        job.location,
        job.id,
        job.originalPostedAt || '',
        job.lastPostedAt || '',
        job.estimateTotalApplicants || '',
        job.matchCriteria ? 'TRUE' : 'FALSE'
      ]
    ];
  }

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${config.sheetName}!A1:Z1:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: values
      })
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to append to sheet: ${error.error.message}`);
  }

  return await response.json();
}

// Verify that we have access to the sheet and it exists with our required worksheet
async function verifySheetAccess(sheetId) {
  const token = await authenticateWithGoogle();

  // First check if we can access the spreadsheet and get its sheets
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to access sheet: ${error.error.message}`);
  }

  const data = await response.json();

  // Check if the spreadsheet has a sheet with the required name
  if (!data.sheets || !data.sheets.length) {
    throw new Error(`Spreadsheet exists but contains no sheets`);
  }

  // Look for a sheet with the name matching config.sheetName
  const targetSheet = data.sheets.find(sheet =>
    sheet.properties && sheet.properties.title === config.sheetName
  );

  if (!targetSheet) {
    throw new Error(`Spreadsheet does not contain a sheet named "${config.sheetName}"`);
  }

  return data;
}