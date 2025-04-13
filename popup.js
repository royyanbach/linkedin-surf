document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('startButton');
  const apiKeyInput = document.getElementById('apiKey');
  const jobRoleInput = document.getElementById('jobRole');
  const jobLocationInput = document.getElementById('jobLocation');
  const maxJobsInput = document.getElementById('maxJobs');
  const maxPagesInput = document.getElementById('maxPages');

  // Load saved values if available
  chrome.storage.local.get(['openaiApiKey', 'jobRole', 'jobLocation', 'maxJobs', 'maxPages'], (result) => {
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
  });

  // Check if we're on a LinkedIn jobs page
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    const isLinkedInJobsPage = currentTab.url.includes('linkedin.com/jobs/search');

    if (!isLinkedInJobsPage) {
      startButton.disabled = true;
      startButton.textContent = 'Go to LinkedIn Jobs to use this';

      // Add a click handler to navigate to LinkedIn jobs
      startButton.addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://www.linkedin.com/jobs/' });
      });
    } else {
      // On a valid page, set up the start button
      startButton.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        const jobRole = jobRoleInput.value.trim();
        const jobLocation = jobLocationInput.value.trim();
        const maxJobs = parseInt(maxJobsInput.value, 10) || 25;
        const maxPages = parseInt(maxPagesInput.value, 10) || 3;

        if (!apiKey) {
          alert('Please enter your OpenAI API key');
          return;
        }

        // Save settings to Chrome storage
        chrome.storage.local.set({
          openaiApiKey: apiKey,
          jobRole: jobRole,
          jobLocation: jobLocation,
          maxJobs: maxJobs,
          maxPages: maxPages
        }, () => {
          startButton.disabled = true;
          startButton.textContent = 'Processing...';

          // Send message to the content script to start scraping
          chrome.tabs.sendMessage(currentTab.id, { action: 'startScraping' }, (response) => {
            if (response && response.success) {
              // Close the popup after starting
              window.close();
            } else {
              startButton.textContent = 'Failed to start. Try again.';
              startButton.disabled = false;
            }
          });
        });
      });
    }
  });
});