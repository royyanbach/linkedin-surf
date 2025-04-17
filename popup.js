document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('startButton');
  const apiKeyInput = document.getElementById('apiKey');
  const jobRoleInput = document.getElementById('jobRole');
  const jobLocationInput = document.getElementById('jobLocation');
  const maxJobsInput = document.getElementById('maxJobs');
  const maxPagesInput = document.getElementById('maxPages');
  const pageInstanceInput = document.getElementById('pageInstance');
  const footerElement = document.querySelector('footer');
  const statusElement = document.getElementById('status') || createStatusElement();
  const signedInElement = document.getElementById('signedIn');
  const userEmailElement = document.getElementById('userEmail');
  const profilePictureElement = document.getElementById('profilePicture');
  const buttonTextElement = document.getElementById('buttonText');
  const googleIconElement = document.getElementById('googleIcon');
  const formFieldsElement = document.getElementById('formFields');

  // Check Google authentication status
  checkAuthStatus();

  // Function to check authentication status
  function checkAuthStatus() {
    chrome.identity.getAuthToken({ interactive: false }, function(token) {
      if (chrome.runtime.lastError || !token) {
        // Not authenticated
        signedInElement.style.display = 'none';
        profilePictureElement.style.display = 'none';
        formFieldsElement.style.display = 'none';
        buttonTextElement.textContent = 'Sign in to integrate with Google Sheets';
        googleIconElement.style.display = 'inline';

        // Change button behavior to authenticate
        startButton.removeEventListener('click', startScraping);
        startButton.addEventListener('click', authenticateWithGoogle);
      } else {
        // Authenticated, get user info
        getUserInfo(token);
      }
    });
  }

  // Get user information using the token
  function getUserInfo(token) {
    fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    .then(response => response.json())
    .then(data => {
      console.log(data);
      // Display user info
      userEmailElement.textContent = data.email;
      profilePictureElement.src = data.picture;
      profilePictureElement.style.display = 'block';
      signedInElement.style.display = 'block';
      formFieldsElement.style.display = 'block';
      buttonTextElement.textContent = 'Start Filtering Jobs';
      googleIconElement.style.display = 'none';

      // Set button behavior to start scraping
      startButton.removeEventListener('click', authenticateWithGoogle);

      // Check if we're on LinkedIn page first
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];
        const isLinkedInJobPage = currentTab.url.includes('linkedin.com/jobs/search') ||
                                  currentTab.url.includes('linkedin.com/jobs/collections');

        if (isLinkedInJobPage) {
          startButton.addEventListener('click', startScraping);
        } else {
          // Not on LinkedIn jobs page
          buttonTextElement.textContent = 'Go to LinkedIn Jobs';
          startButton.addEventListener('click', goToLinkedIn);
        }
      });
    })
    .catch(error => {
      console.error('Error fetching user info:', error);
      signedInElement.style.display = 'none';
      profilePictureElement.style.display = 'none';
      formFieldsElement.style.display = 'none';
      buttonTextElement.textContent = 'Sign in with Google';
      googleIconElement.style.display = 'inline';
    });
  }

  // Function to authenticate with Google
  function authenticateWithGoogle() {
    chrome.identity.getAuthToken({ interactive: true }, function(token) {
      if (chrome.runtime.lastError || !token) {
        updateStatus('Failed to authenticate with Google', true);
      } else {
        checkAuthStatus();
      }
    });
  }

  // Function to go to LinkedIn jobs
  function goToLinkedIn() {
    chrome.tabs.create({ url: 'https://www.linkedin.com/jobs/' });
  }

  // Function to start scraping
  function startScraping() {
    const apiKey = apiKeyInput.value.trim();
    const jobRole = jobRoleInput.value.trim();
    const jobLocation = jobLocationInput.value.trim();
    const maxJobs = parseInt(maxJobsInput.value, 10) || 25;
    const maxPages = parseInt(maxPagesInput.value, 10) || 3;
    const pageInstance = pageInstanceInput.value.trim();

    if (!apiKey) {
      updateStatus('Please enter your OpenAI API key', true);
      return;
    }

    // Save settings to Chrome storage
    chrome.storage.local.set({
      openaiApiKey: apiKey,
      jobRole: jobRole,
      jobLocation: jobLocation,
      maxJobs: maxJobs,
      maxPages: maxPages,
      pageInstance: pageInstance
    }, () => {
      startButton.disabled = true;
      buttonTextElement.textContent = 'Processing...';
      updateStatus('Scraping in progress. Results will be saved to Google Sheets.');

      // Get current tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];

        // Send message to the content script to start scraping
        chrome.tabs.sendMessage(currentTab.id, {
          action: 'startScraping',
          apiKey: apiKey,
          jobRole: jobRole,
          jobLocation: jobLocation,
          maxJobs: maxJobs,
          maxPages: maxPages,
          pageInstance: pageInstance
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Error sending message to content script:", chrome.runtime.lastError.message);
            buttonTextElement.textContent = 'Start Filtering Jobs';
            startButton.disabled = false;
            updateStatus(`Error: Could not connect to LinkedIn page script. Please reload the page and try again. (${chrome.runtime.lastError.message})`, true);
            return;
          }

          if (response && response.success) {
            updateStatus('Scraping in progress. Results will be saved to Google Sheets.');
          } else {
            buttonTextElement.textContent = 'Start Filtering Jobs';
            startButton.disabled = false;
            updateStatus('Failed to start scraping. Try again.', true);
          }
        });
      });
    });
  }

  // Load saved values if available
  chrome.storage.local.get(['openaiApiKey', 'jobRole', 'jobLocation', 'maxJobs', 'maxPages', 'pageInstance'], (result) => {
    if (result.openaiApiKey) {
      apiKeyInput.value = result.openaiApiKey;
    }
    if (result.jobRole) {
      jobRoleInput.value = result.jobRole;
    }
    if (result.jobLocation) {
      jobLocationInput.value = result.jobLocation;
    }
    if (result.maxJobs) {
      maxJobsInput.value = result.maxJobs;
    }
    if (result.maxPages) {
      maxPagesInput.value = result.maxPages;
    }
    if (result.pageInstance) {
      pageInstanceInput.value = result.pageInstance;
    }
  });

  // Create status element if it doesn't exist
  function createStatusElement() {
    if (!footerElement) {
      return;
    }

    const status = document.createElement('div');
    status.id = 'status';
    status.style.marginBottom = '15px';
    status.style.padding = '10px';
    status.style.borderRadius = '5px';
    status.style.backgroundColor = '#f5f5f5';
    status.style.display = 'none';
    footerElement.insertBefore(status, footerElement.firstChild);
    return status;
  }

  // Update status text and make visible
  function updateStatus(message, isError = false) {
    statusElement.textContent = message;
    statusElement.style.display = 'block';
    statusElement.style.backgroundColor = isError ? '#ffebee' : '#e8f5e9';
    statusElement.style.color = isError ? '#c62828' : '#2e7d32';
  }

  // Listen for messages from background script to update status
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateScrapingStatus') {
      console.log(message);
      updateStatus(message.status, message.isError);

      // Re-enable button if process is complete
      if (message.status.includes('completed') || message.isError) {
        startButton.disabled = false;
        buttonTextElement.textContent = 'Start Filtering Jobs';
      }

      // If we received a sheet URL, add a link to it
      if (message.sheetUrl) {
        const linkContainer = document.createElement('div');
        linkContainer.style.marginTop = '10px';

        const link = document.createElement('a');
        link.href = message.sheetUrl;
        link.textContent = 'Open Google Sheet';
        link.target = '_blank';
        link.style.color = '#0a66c2';
        link.style.textDecoration = 'none';

        linkContainer.appendChild(link);
        statusElement.appendChild(linkContainer);
      }
    }
    return true;
  });
});