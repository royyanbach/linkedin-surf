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

  // Debounce function to limit how often the save operation runs
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Function to save a single field to storage
  const saveField = (key, value) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        console.error(`Error saving ${key}:`, chrome.runtime.lastError);
      }
    });
  };

  // Debounced version of saveField that waits 500ms after the last call
  const debouncedSave = debounce(saveField, 500);

  // Add input event listeners to all input fields
  const inputFields = {
    'openaiApiKey': apiKeyInput,
    'jobRole': jobRoleInput,
    'jobLocation': jobLocationInput,
    'maxJobs': maxJobsInput,
    'maxPages': maxPagesInput,
    'pageInstance': pageInstanceInput
  };

  // Add input event listeners for real-time saving
  Object.entries(inputFields).forEach(([key, element]) => {
    element.addEventListener('input', (e) => {
      const value = e.target.value.trim();
      debouncedSave(key, value);
    });
  });

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
        // Disable button and show loading state before fetching user info
        startButton.disabled = true;
        buttonTextElement.textContent = 'Fetching user data...';
        getUserInfo(token);
      }
    });
  }

  // Get user information using the token
  function getUserInfo(token) {
    // Ensure button is disabled and shows loading state
    startButton.disabled = true;
    buttonTextElement.textContent = 'Fetching user data...';

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

      // Re-enable button after user info is fetched
      startButton.disabled = false;

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

      // Re-enable button after error
      startButton.disabled = false;
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
    statusElement.innerHTML = '';
    statusElement.textContent = message;
    statusElement.style.display = 'block';
    statusElement.style.backgroundColor = isError ? '#ffebee' : '#e8f5e9';
    statusElement.style.color = isError ? '#c62828' : '#2e7d32';
  }

  // Listen for messages from background script to update status
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateScrapingStatus') {
      updateStatus(message.status, message.isError);

      // Re-enable button if process is complete
      if (message.status.includes('completed') || message.isError) {
        startButton.disabled = false;
        buttonTextElement.textContent = 'Start Filtering Jobs';
      }

      // If we received a sheet URL, add a link to it
      if (message.sheetUrl) {

        const link = document.createElement('a');
        link.href = message.sheetUrl;
        link.textContent = 'Open Google Sheet';
        link.target = '_blank';
        link.style.color = '#0a66c2';
        link.style.textDecoration = 'none';

        statusElement.appendChild(document.createTextNode(' '));
        statusElement.appendChild(link);
      }
    }
    return true;
  });
});