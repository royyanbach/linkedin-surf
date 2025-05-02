const API_TIMEOUT = 5000;

// Configuration
let config = {
  openaiApiKey: '',
  // Title filters (case insensitive)
  includeKeywords: [],
  excludeKeywords: [],
  // Location filters
  locationRequirements: [],
  // locationRequirements: {
  //   mustContain: ['indonesia'],
  //   exclude: ['remote', 'hybrid']
  // },
  // Max jobs to process per page
  maxJobs: 25,
  // Max pages to process
  maxPages: 3,
  // API rate limiting
  apiRateLimit: 1000,  // Max requests per minute to avoid overloading
  apiTokensPerMinute: 1000000,  // Max tokens per minute to avoid overloading
  apiCooldown: 20000,  // Cooldown in ms between API batches
  csrfToken: '',
  sheetId: '', // Optional Google Sheet ID
};

// Track processed jobs to avoid duplicates
let processedJobIds = new Set();
let isRunning = false;
let duplicateCount = 0;
let jobsProcessedCount = 0;
let jobsMatchedCount = 0;
let jobsProcessedThisPage = 0;
let isFirstPage = true; // Track if we're on the first page
let apiRequestsInLastMinute = 0;
let tokensUsedInLastMinute = 0;
let lastApiRequestTime = 0;
let overlayElement = null; // Reference to the overlay element
let userStopped = false; // Flag to indicate if user stopped manually

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startScraping' && !isRunning) {
    isRunning = true;
    if (message.apiKey) {
      config.openaiApiKey = message.apiKey;
    }
    if (message.sheetId) {
      config.sheetId = message.sheetId;
    }
    startScraping();
    sendResponse({ success: true });
  } else if (message.action === 'showNotification') {
    showNotification(message.message);
    sendResponse({ success: true });
  }
  return true;
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getCookieValueByName(name) {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [cookieName, cookieValue] = cookie.trim().split('=');
    if (cookieName === name) {
      return cookieValue;
    }
  }
  return null;
}

// Load configuration from storage
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['jobRole', 'jobLocation', 'maxJobs', 'maxPages', 'sheetId'], (result) => {
      if (result.jobRole) {
        config.includeKeywords = result.jobRole.split(',').map(keyword => keyword.trim());
      }

      if (result.jobLocation) {
        const locations = result.jobLocation.split(',').map(location => location.trim());
        config.locationRequirements = locations;
      }

      if (result.maxJobs) {
        config.maxJobs = parseInt(result.maxJobs, 10) || 25;
      }

      if (result.maxPages) {
        config.maxPages = parseInt(result.maxPages, 10) || 3;
      }

      if (result.sheetId) {
        config.sheetId = result.sheetId;
      }

      resolve();
    });
  });
}

// Start the scraping process
async function startScraping() {
  try {
    // Only reset matched jobs at the beginning of the entire scraping process
    chrome.runtime.sendMessage({
      action: 'resetMatchedJobs',
      sheetId: config.sheetId
    }, response => {
      if (!response?.sheetId) {
        showNotification(`Failed to create Google Sheet: Missing Google Sheet ID. Please try again.`);
        isRunning = false;
        return;
      }

      // If sheet creation failed, show error and abort
      if (!response?.success) {
        showNotification(`Failed to create Google Sheet: ${response.error}`);
        isRunning = false;
        return;
      }

      // Continue with scraping if sheet was created successfully
      continueWithScraping(response.sheetId);
    });
  } catch (error) {
    console.error('Error during scraping setup:', error);
    showNotification('An error occurred while setting up scraping. Check console for details.');
    isRunning = false;
  }
}

async function continueWithScraping(sheetId = null) {
  try {
    // Load config from storage
    await loadConfig();

    config.csrfToken = getCookieValueByName('JSESSIONID');

    // Reset data
    processedJobIds = new Set();
    jobsProcessedCount = 0;
    jobsMatchedCount = 0;
    duplicateCount = 0;
    isFirstPage = true;
    userStopped = false; // Reset stop flag

    // Show notification to user - Replace with overlay
    // showNotification('Starting to scrape LinkedIn jobs. Please do not navigate away from this page.');
    createOverlay(); // Show the overlay
    resetOverlayInitialStats(sheetId);

    let currentPage = 1;
    let continueToNextPage = true;

    while (isRunning && continueToNextPage && currentPage <= config.maxPages && !userStopped) { // Check isRunning flag
      // showNotification(`Processing page ${currentPage} of ${config.maxPages}`);
      updateOverlayStats(currentPage, config.maxPages, jobsProcessedCount, jobsMatchedCount, duplicateCount); // Update overlay stats

      // Get all job cards on the page
      // await scrollToLoadAllJobsSimple();

      await sleep(500);

      // Reset counter for this page
      jobsProcessedThisPage = 0;

      // Process job cards
      const jobCards = Array.from(document.querySelectorAll('.scaffold-layout__list-item'));

      if (jobCards.length === 0) {
        showNotification('No job cards found. Make sure you are on a LinkedIn jobs search page.');
        break;
      }

      // Process the jobs on current page one by one
      await processJobCards(jobCards, currentPage); // Pass currentPage for stats

      // After processing the first page, update the flag
      if (isFirstPage) {
        isFirstPage = false;
      }

      // Check if we should go to the next page
      if (isRunning && currentPage < config.maxPages) { // Check isRunning flag
        continueToNextPage = await goToNextPage();
        if (continueToNextPage) {
          // Wait for the next page to load
          await sleep(3000);
          currentPage++;
        } else {
          showNotification('No more pages available.');
        }
      } else {
        continueToNextPage = false;
      }
    }

    // Signal that we're done
    chrome.runtime.sendMessage({
      action: 'finishScraping',
      stats: {
        totalProcessed: jobsProcessedCount,
        totalMatched: jobsMatchedCount,
        totalPages: currentPage - (continueToNextPage ? 0 : 1) // Adjust final page count
      }
    });

    const finalMessage = userStopped
      ? `Scraping stopped by user. Processed ${jobsProcessedCount} jobs, found ${jobsMatchedCount} matches.`
      : `Completed! Processed ${jobsProcessedCount} jobs, found ${jobsMatchedCount} matches from ${currentPage - (continueToNextPage ? 0 : 1)} pages.`;
    showNotification(finalMessage);
    resetOverlayInitialStats(sheetId, true);
  } catch (error) {
    console.error('Error during scraping:', error);
    showNotification('An error occurred while scraping jobs. Check console for details.');

    // Notify background of error
    chrome.runtime.sendMessage({
      action: 'scrapingError',
      error: error.message
    });
  } finally {
    isRunning = false;
    // removeOverlay(); // Ensure overlay is removed
  }
}

// Navigate to the next page of job listings
async function goToNextPage() {
  try {
    const nextButton = document.querySelector('.jobs-search-pagination__button--next');

    if (!nextButton || nextButton.disabled) {
      return false;
    }

    nextButton.click();
    return true;
  } catch (error) {
    console.error('Error navigating to next page:', error);
    return false;
  }
}

// Show a notification to the user
function showNotification(message) {
  // Create or update notification element
  let notification = document.getElementById('linkedin-job-filter-notification');

  if (!notification) {
    notification = document.createElement('div');
    notification.id = 'linkedin-job-filter-notification';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      background-color: #0a66c2;
      color: white;
      padding: 15px;
      border-radius: 5px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
      max-width: 300px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
    `;

    document.body.appendChild(notification);
  }

  notification.textContent = message;

  // Auto-hide after 5 seconds
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.5s ease';

    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 500);
  }, 5000);
}

// Scroll to load all job cards
async function scrollToLoadAllJobs() {
  return new Promise((resolve) => {
    // Safer, more controlled scrolling to avoid rendering issues
    const maxScrollAttempts = 5;
    let scrollAttempt = 0;

    // Track height to detect when we've reached the bottom
    let prevHeight = document.body.scrollHeight;

    const scrollInterval = setInterval(() => {
      try {
        // Scroll in smaller increments to reduce strain
        window.scrollBy(0, 500);

        // Check if we're at the bottom or have scrolled enough times
        scrollAttempt++;
        const currentHeight = document.body.scrollHeight;
        const isAtBottom = window.innerHeight + window.scrollY >= currentHeight - 200;
        const noMoreContent = currentHeight === prevHeight;

        if (isAtBottom || noMoreContent || scrollAttempt >= maxScrollAttempts) {
          clearInterval(scrollInterval);

          // Scroll back to top gently to reset view
          window.scrollTo({
            top: 0,
            behavior: 'smooth'
          });

          // Allow time for rendering before continuing
          setTimeout(resolve, 500);
        }

        prevHeight = currentHeight;
      } catch (error) {
        console.error('Error during scroll:', error);
        clearInterval(scrollInterval);
        resolve();
      }
    }, 1000); // Gentle 1 second interval between scrolls
  });
}

// Scroll to load all job cards - simple version
async function scrollToLoadAllJobsSimple() {
  const searchFooter = document.querySelector('#jobs-search-results-footer');
  if (!searchFooter) {
    console.error('Jobs list container not found');
    return;
  }
  searchFooter.scrollIntoView({ behavior: 'smooth', block: 'end' });
  await sleep(3000);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await sleep(500);
}

// Process job cards one by one
async function processJobCards(jobCards, currentPage) { // Accept currentPage
  const jobsToProcess = Math.min(jobCards.length, config.maxJobs);

  for (let i = 0; i < jobsToProcess; i++) {
    // Exit early if we've already processed the maximum number of jobs for this page
    if (jobsProcessedThisPage >= config.maxJobs || !isRunning) { // Check isRunning flag
      break;
    }

    const jobCard = jobCards[i];

    if (!document.body.contains(jobCard)) {
      console.warn('Job card not found in document body. Skipping...');
      continue;
    }

    try {
      // Extract basic job information
      const linkElement = jobCard.querySelector('.job-card-list__title--link');
      const titleElement = linkElement?.querySelector('.visually-hidden');
      const companyElement = jobCard.querySelector('.artdeco-entity-lockup__subtitle');
      const locationElement = jobCard.querySelector('.artdeco-entity-lockup__caption');

      if (!linkElement || !companyElement || !locationElement || !titleElement) {
        continue;
      }

      const title = titleElement.textContent.trim();
      const company = companyElement.textContent.trim();
      const location = locationElement.textContent.trim();
      const url = linkElement.getAttribute('href');
      const jobId = jobCard.dataset.occludableJobId;

      // Avoid duplicates
      if (processedJobIds.has(jobId) || !isRunning) { // Check isRunning flag
        duplicateCount++;
        continue;
      }

      processedJobIds.add(jobId);
      jobsProcessedCount++;
      jobsProcessedThisPage++;

      // Update overlay stats after processing a unique job
      updateOverlayStats(currentPage, config.maxPages, jobsProcessedCount, jobsMatchedCount, duplicateCount);

      // Create basic job object
      const jobInfo = {
        id: jobId,
        title,
        company,
        location,
        url,
        description: '', // Will be filled later
        originalPostedAt: '', // Will be filled later
        lastPostedAt: '', // Will be filled later
        estimateTotalApplicants: '', // Will be filled later
        matchCriteria: false,
      };

      // Wait for random amount of time between 2.5 and 3.5 seconds to avoid hitting rate limits
      await sleep(Math.floor(Math.random() * 1000) + 2500);

      // Process job details immediately
      await processJobDetail(jobInfo);
    } catch (error) {
      console.error('Error processing job card:', error);
    }
  }
}

async function waitForElement(selector, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (document.querySelector(selector)) {
      return document.querySelector(selector);
    }
    await sleep(100); // Poll every 100ms
  }
  throw new Error(`Element ${selector} not found within ${timeout}ms`);
}

async function manageRateLimit() {
  const now = Date.now();

  // Reset counter if last request was over a minute ago
  if ((now - lastApiRequestTime) > 60000) {
    apiRequestsInLastMinute = 0;
    tokensUsedInLastMinute = 0;
  }

  if (apiRequestsInLastMinute >= config.apiRateLimit) {
    const timeSinceLastRequest = now - lastApiRequestTime;
    const backoffTime = Math.min(
      config.apiCooldown * Math.pow(1.5, apiRequestsInLastMinute - config.apiRateLimit),
      60000
    );

    if (timeSinceLastRequest < backoffTime) {
      const waitTime = backoffTime - timeSinceLastRequest;
      console.log(`Rate limiting API calls, waiting ${Math.ceil(waitTime / 1000)}s`);
      await sleep(waitTime);
      apiRequestsInLastMinute = 0; // Reset counter after cooldown
    }
  }
}

async function getJobDetail(jobId) {
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
  try {
    if (!config.csrfToken) {
      console.error('Page instance or CSRF token not found');
      return;
    }

    const controller = new AbortController();

    const response = await fetch(`https://www.linkedin.com/voyager/api/jobs/jobPostings/${jobId}?decorationId=com.linkedin.voyager.deco.jobs.web.shared.WebFullJobPosting-65&topN=1&topNRequestedFlavors=List(TOP_APPLICANT,IN_NETWORK,COMPANY_RECRUIT,SCHOOL_RECRUIT,HIDDEN_GEM,ACTIVELY_HIRING_COMPANY)`, {
      signal: controller.signal,
      headers: {
        accept: 'application/vnd.linkedin.normalized+json+2.1',
        'accept-language': 'en-US,en;q=0.9,id-ID;q=0.8,id;q=0.7',
        'cache-control': 'no-cache',
        'csrf-token': (config.csrfToken || '').replaceAll('\"', ''),
        pragma: 'no-cache',
        priority: 'u=1, i',
        'x-li-lang': 'en_US',
        'x-li-pem-metadata': 'Voyager - Careers - Job Details=job-posting',
        'x-li-track': '{"clientVersion":"1.13.33754","mpVersion":"1.13.33754","osName":"web","timezoneOffset":7,"timezone":"Asia/Jakarta","deviceFormFactor":"DESKTOP","mpName":"voyager-web","displayDensity":1,"displayWidth":3440,"displayHeight":1440}',
        'x-restli-protocol-version': '2.0.0'
      },
      referrerPolicy: 'strict-origin-when-cross-origin',
      body: null,
      method: 'GET',
      mode: 'cors',
      credentials: 'include'
    });
    const responseJson = await response.json();
    return responseJson.data;
  } catch (error) {
    console.error(`Error getting job detail from API for job ${jobId}:`, error);
  } finally {
    clearTimeout(timeoutId);
  }
}

// Process a single job detail
async function processJobDetail(jobInfo) {
  try {
    // Check if scraping was stopped before proceeding
    if (!isRunning) return;

    const jobDetail = await getJobDetail(jobInfo.id);

    if (!jobDetail) {
      throw new Error('Job detail not found');
    }

    jobInfo.description = jobDetail.description.text;
    jobInfo.originalPostedAt = jobDetail.originalListedAt ? new Date(jobDetail.originalListedAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '';
    jobInfo.lastPostedAt = jobDetail.listedAt ? new Date(jobDetail.listedAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '';
    jobInfo.estimateTotalApplicants = jobDetail.applies;

    // // Safely click on the job card with error handling
    // try {
    //   jobCard.click();
    // } catch (clickError) {
    //   console.error('Error clicking job card:', clickError);
    //   return;
    // }

    // // Wait for job details to load
    // // await sleep(1500);

    // // // Get job details container with safety check
    // // const jobDetailsContainer = document.querySelector('.jobs-search__job-details--container');
    // // if (!jobDetailsContainer) {
    // //   console.error('Job details container not found');
    // //   return;
    // // }

    // // Extract job description - with safe fallback
    // // const descriptionElement = jobDetailsContainer.querySelector('.jobs-description-content');
    // const descriptionElement = await waitForElement('#job-details p[dir="ltr"]');
    // if (descriptionElement) {
    //   try {
    //     jobInfo.description = descriptionElement.textContent.trim();
    //   } catch (descError) {
    //     console.error('Error extracting job description:', descError);
    //     jobInfo.description = '';
    //   }
    // }

    // // Extract job meta with proper error handling
    // const jobMetaElement = await waitForElement('.job-details-jobs-unified-top-card__tertiary-description-container span[dir="ltr"]');
    // if (jobMetaElement) {
    //   try {
    //     const jobMeta = jobMetaElement.textContent.trim().split('·').map(s => s.trim()) || [];
    //     const [, lastPostedAt, estimateTotalApplicants] = jobMeta;
    //     jobInfo.lastPostedAt = lastPostedAt;
    //     jobInfo.estimateTotalApplicants = estimateTotalApplicants;
    //   } catch (metaError) {
    //     console.error('Error parsing job meta:', metaError);
    //   }
    // }

    // Check if the job matches the criteria - with timeout protection
    try {
      // Handle rate limiting before API call
      await manageRateLimit();

      // Check if scraping was stopped before API call
      if (!isRunning) return;

      // Set a timeout to prevent hanging in the criteria check
      const criteriaPromise = checkJobCriteria(jobInfo);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Criteria check timeout')), API_TIMEOUT)
      );

      jobInfo.matchCriteria = await Promise.race([criteriaPromise, timeoutPromise]);
      delete jobInfo.description;
    } catch (criteriaError) {
      console.error(`Error in criteria check for job ${jobInfo.id}:`, criteriaError);
    }

    // If it matches, send it to the background script
    if (jobInfo.matchCriteria) {
      jobsMatchedCount++;
      // Update overlay stats immediately after a match
      // Note: currentPage is not directly available here, might need passing or using a global
      // For simplicity, relying on the update in processJobCards loop is sufficient
    }

    // Check if scraping was stopped before sending message
    if (!isRunning) return;

    chrome.runtime.sendMessage({
      action: 'addMatchedJob',
      job: {
        title: jobInfo.title,
        company: jobInfo.company,
        location: jobInfo.location,
        id: jobInfo.id,
        lastPostedAt: jobInfo.lastPostedAt,
        estimateTotalApplicants: jobInfo.estimateTotalApplicants,
        matchCriteria: jobInfo.matchCriteria
      }
    }, response => {
      // Handle null response (which can happen if the background script is not ready)
      if (!response) {
        console.warn('No response from background script when adding matched job');
        return;
      }

      if (!response.success) {
        console.error(`Failed to add job to matched list: ${jobInfo.title}`);
      }
    });
  } catch (error) {
    console.error(`Error processing details for job ${jobInfo.id}:`, error);
  }
}

async function checkJobCriteria(job) {
  // // Simple matching without API for basic filtering
  // const titleLower = job.title.toLowerCase();
  // const locationLower = job.location.toLowerCase();

  // // Check if the job matches the simple criteria first
  // let matchesKeyword = config.includeKeywords.some(keyword =>
  //   titleLower.includes(keyword.toLowerCase())
  // );

  // let matchesLocation = config.locationRequirements.some(location =>
  //   locationLower.includes(location.toLowerCase())
  // );

  // // If basic criteria doesn't match, no need to call API
  // if (!matchesKeyword || !matchesLocation) {
  //   return false;
  // }

  // Check if running before making API call
  if (!isRunning) return false;

  if (!config.includeKeywords.join(', ')) {
    return true;
  }

  const apiKey = config.openaiApiKey;

  if (!apiKey) {
    console.error('OpenAI API key not found in storage');
    return false;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a job-matching assistant. The user will provide a set of conditions they want in a job, then provide a single job listing. Your task is to determine if the provided job listing matches ANY of the user's specified conditions.

              Your matching rules should be:

              1. **Role Match:**
                - Compare the user's roles of interest (e.g., "frontend engineer," "tech lead," "software architect," etc.) to the job listing's role/title/description in a flexible way.
                - If the listing's role is functionally similar to one of the user's roles, count it as a match for the role requirement.

              2. **Location/Remote Match:**
                - The user will specify their location requirements, which may include "remote from [specific location]," "onsite in [city]," "hybrid in [city]," etc.
                - If the user wants remote from Indonesia, then the listing must allow any of the following for a match:
                  - Remote specifically from Indonesia,
                  - Remote from anywhere (global),
                  - Remote from Asia/APAC (which includes Indonesia),
                  - OR a "work from abroad"/"flexible hybrid" policy that does *not* explicitly exclude Indonesia.
                - If the listing explicitly requires a specific country/region *outside* the user's desired scope (e.g., "Must be located in the US"), then it does not match.

              3. **Comparison Logic:**
                - If **any** of the user's specified role or location requirements is satisfied by the job listing (i.e., the listing is a valid match for at least one desired role *and* meets the location requirement), output strictly "YES."
                - Otherwise, output strictly "NO."

              4. **Output:**
                - Provide **no additional text or explanation** beyond "YES" or "NO."`
          },
          {
            role: 'user',
            content: `
              Conditions: ${config.includeKeywords.join(', ')}.
              Location Requirements: ${config.locationRequirements.join(', ') || 'Anywhere'}

              Job Listing:
              \`\`\`
              Title: ${job.title}
              Location: ${job.location}
              Description: ${job.description}
              \`\`\`
            `
          }
        ]
      })
    });

    // Check if running after API call returns
    if (!isRunning) return false;

    apiRequestsInLastMinute++;
    lastApiRequestTime = Date.now();

    const data = await response.json();

    if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
      console.error('Invalid API response:', data);
      return false;
    }

    if (data.usage.total_tokens) {
      tokensUsedInLastMinute += data.usage.total_tokens;
    }

    return data.choices[0].message.content.trim() === 'YES';
  } catch (error) {
    console.error('Error checking job criteria:', error);
    return false;
  } finally {
    clearTimeout(timeoutId);
    job.description = null; // Release memory
  }
}

function createOverlay() {
  if (overlayElement) return; // Already exists

  userStopped = false; // Reset stop flag

  overlayElement = document.createElement('div');
  overlayElement.id = 'linkedin-surf-overlay';
  overlayElement.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: rgba(0, 0, 0, 0.75);
    z-index: 10000;
    display: flex;
    justify-content: center;
    align-items: center;
    color: white;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    font-size: 16px;
    text-align: center;
    flex-direction: column; /* Stack content vertically */
  `;

  const contentDiv = document.createElement('div');
  contentDiv.style.cssText = `
    background-color: rgba(0, 0, 0, 0.85);
    padding: 30px 40px;
    border-radius: 8px;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
  `;

  contentDiv.innerHTML = `
    <h2 id="overlay-title" style="margin-top: 0; margin-bottom: 20px; color: #4dabf7;">LinkedIn Surf - Scraping in Progress...</h2>
    <p style="margin-bottom: 10px;">Please wait while we analyze job listings.</p>
    <div style="margin: 20px 0; font-size: 1.1em;">
      Page: <span id="overlay-current-page">1</span> / <span id="overlay-total-pages">${config.maxPages}</span><br>
      Processed (Unique): <span id="overlay-processed-count">0</span><br>
      Duplicate: <span id="overlay-duplicate-count">0</span><br>
      Matched: <span id="overlay-matched-count">0</span>
    </div>
    <button id="overlay-stop-button" style="padding: 10px 20px; font-size: 1em; cursor: pointer; background-color: #e74c3c; color: white; border: none; border-radius: 5px; margin-top: 15px;">Stop Scraping</button>
    <a id="overlay-open-sheet-button" target="_blank" style="padding: 10px 20px; font-size: 1em; cursor: pointer; background-color: #4dabf7; color: white; border: none; border-radius: 5px; margin-top: 15px; text-decoration: none;">Open Sheet</a>
  `;

  overlayElement.appendChild(contentDiv);
  document.body.appendChild(overlayElement);

  // Add stop button functionality
  document.getElementById('overlay-stop-button').addEventListener('click', () => {
    showNotification('Stopping scraping process...');
    isRunning = false;
    userStopped = true; // Set the flag
    removeOverlay(); // Optionally remove overlay immediately, or wait for finally block
  });
}

function resetOverlayInitialStats(sheetId, finished = false) {
  if (!overlayElement) return;
  const titleElem = document.getElementById('overlay-title');
  const stopButton = document.getElementById('overlay-stop-button');
  const openSheetButton = document.getElementById('overlay-open-sheet-button');

  if (titleElem) {
    titleElem.textContent = finished ? `LinkedIn Surf - Scraping Completed!` : `LinkedIn Surf - Scraping in Progress...`;
  }

  if (openSheetButton) openSheetButton.href = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;

  if (stopButton && finished) {
    stopButton.textContent = 'Close';
  }
}

function updateOverlayStats(page, totalPages, processed, matched, duplicate) {
  if (!overlayElement) return;

  const currentPageElem = document.getElementById('overlay-current-page');
  const totalPagesElem = document.getElementById('overlay-total-pages');
  const processedCountElem = document.getElementById('overlay-processed-count');
  const matchedCountElem = document.getElementById('overlay-matched-count');
  const duplicateCountElem = document.getElementById('overlay-duplicate-count');

  if (currentPageElem) currentPageElem.textContent = page;
  if (totalPagesElem) totalPagesElem.textContent = totalPages;
  if (processedCountElem) processedCountElem.textContent = processed;
  if (matchedCountElem) matchedCountElem.textContent = matched;
  if (duplicateCountElem) duplicateCountElem.textContent = duplicate;
}

function removeOverlay() {
  if (overlayElement && overlayElement.parentNode) {
    overlayElement.parentNode.removeChild(overlayElement);
  }
  overlayElement = null;
}
