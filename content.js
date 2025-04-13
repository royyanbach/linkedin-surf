// Configuration
let config = {
  // Title filters (case insensitive)
  includeKeywords: ['frontend', 'front-end', 'front end', 'fullstack', 'full-stack', 'full stack', 'web developer', 'web engineer', 'javascript', 'react', 'vue', 'angular', 'typescript', 'senior', 'lead'],
  excludeKeywords: ['designer', 'mechanical', 'civil', 'quality assurance', 'qa engineer', 'devops', 'intern', 'backend only', 'back-end only'],
  // Location filters
  locationRequirements: ['indonesia'],
  // locationRequirements: {
  //   mustContain: ['indonesia'],
  //   exclude: ['remote', 'hybrid']
  // },
  // Max jobs to process per page
  maxJobs: 25,
  // Max pages to process
  maxPages: 3
};

// Store scraped jobs
let scrapedJobs = [];
let processedJobIds = new Set();
let isRunning = false;
let lastProcessedIndex = 0; // Track the last processed job index

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startScraping' && !isRunning) {
    isRunning = true;
    startScraping();
    sendResponse({ success: true });
  }
  return true;
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Load configuration from storage
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['jobRole', 'jobLocation', 'maxJobs', 'maxPages'], (result) => {
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

      resolve();
    });
  });
}

// Start the scraping process
async function startScraping() {
  console.log('LinkedIn Job Filter: Starting to scrape jobs...');

  try {
    // Load config from storage
    await loadConfig();

    // Reset data
    scrapedJobs = [];
    processedJobIds = new Set();
    lastProcessedIndex = 0; // Reset the index counter

    // Show notification to user
    showNotification('Starting to scrape LinkedIn jobs. Please do not navigate away from this page.');

    let currentPage = 1;
    let continueToNextPage = true;

    while (continueToNextPage && currentPage <= config.maxPages) {
      showNotification(`Processing page ${currentPage} of ${config.maxPages}`);

      // Get all job cards on the page
      await scrollToLoadAllJobs();

      await sleep(500);

      // Process job cards
      const jobCards = document.querySelectorAll('.job-card-container');
      console.log(`Found ${jobCards.length} job cards on page ${currentPage}, processing...`);

      if (jobCards.length === 0) {
        showNotification('No job cards found. Make sure you are on a LinkedIn jobs search page.');
        break;
      }

      // Process the jobs on current page
      await processInitialJobCards(jobCards);

      // Create detailed job objects by visiting each job page
      // Pass the current lastProcessedIndex to avoid reprocessing
      await processJobDetails(lastProcessedIndex);

      // Update lastProcessedIndex to the length of scrapedJobs after processing
      lastProcessedIndex = scrapedJobs.length;

      // Check if we should go to the next page
      if (currentPage < config.maxPages) {
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

    // Filter jobs based on criteria
    // const filteredJobs = filterJobs(scrapedJobs);
    const filteredJobs = scrapedJobs;

    // Export the data
    if (filteredJobs.length > 0) {
      exportData(filteredJobs);
      showNotification(`Successfully filtered ${filteredJobs.length} jobs out of ${scrapedJobs.length} total jobs from ${currentPage} pages.`);
    } else {
      showNotification('No jobs matched your filter criteria.');
    }
  } catch (error) {
    console.error('Error during scraping:', error);
    showNotification('An error occurred while scraping jobs. Check console for details.');
  } finally {
    isRunning = false;
  }
}

// Navigate to the next page of job listings
async function goToNextPage() {
  try {
    const nextButton = document.querySelector('.jobs-search-pagination__button--next');

    if (!nextButton || nextButton.disabled) {
      console.log('No next page button found or button is disabled');
      return false;
    }

    nextButton.click();
    console.log('Clicked next page button');
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
    const searchFooter = document.querySelector('#jobs-search-results-footer');
    if (!searchFooter) {
      console.error('Jobs list container not found');
      resolve();
      return;
    }

    searchFooter.scrollIntoView({ behavior: 'smooth', block: 'end' });
    resolve();
  });
}

// Process the initial job cards to get basic information
async function processInitialJobCards(jobCards) {
  const jobsToProcess = Math.min(jobCards.length, config.maxJobs);

  for (let i = 0; i < jobsToProcess; i++) {
    const jobCard = jobCards[i];

    try {
      // Extract basic job information
      const linkElement = jobCard.querySelector('.job-card-list__title--link');
      const titleElement = linkElement?.querySelector('.visually-hidden');
      const companyElement = jobCard.querySelector('.artdeco-entity-lockup__subtitle');
      const locationElement = jobCard.querySelector('.artdeco-entity-lockup__caption');

      if (!linkElement || !companyElement || !locationElement || !titleElement) {
        console.warn('Skipping job card - missing required elements');
        continue;
      }

      const title = titleElement.textContent.trim();
      const company = companyElement.textContent.trim();
      const location = locationElement.textContent.trim();
      const url = linkElement.getAttribute('href');
      const jobId = jobCard.dataset.jobId;

      // Avoid duplicates
      if (processedJobIds.has(jobId)) {
        continue;
      }

      processedJobIds.add(jobId);

      // Create basic job object
      const jobInfo = {
        id: jobId,
        title,
        company,
        location,
        url,
        description: '', // Will be filled later
        lastPostedAt: '', // Will be filled later
        estimateTotalApplicants: '', // Will be filled later
        matchCriteria: false,
      };

      scrapedJobs.push(jobInfo);

      // Update notification periodically
      if (i % 10 === 0) {
        showNotification(`Processing job listings: ${i + 1}/${jobsToProcess}`);
      }
    } catch (error) {
      console.error('Error processing job card:', error);
    }
  }
}

// Process job details by clicking on each job card to view details
async function processJobDetails(startIndex = 0) {
  const jobDetailsContainer = document.querySelector('.jobs-search__job-details--container');

  if (!jobDetailsContainer) {
    console.error('Job details container not found');
    return;
  }

  for (let i = startIndex; i < scrapedJobs.length; i++) {
    const job = scrapedJobs[i];

    try {
      // Find the corresponding job card by URL
      // const jobLink = document.querySelector(`[href="${job.url}"]`);
      // if (!jobLink) {
      //   console.warn(`Could not find job link for URL: ${job.url}`);
      //   continue;
      // }

      // const jobCard = jobLink.closest('.job-card-container');
      const jobCard = document.querySelector(`[data-job-id="${job.id}"]`);

      if (!jobCard) {
        console.warn(`Could not find job card for ID: ${job.id}`);
        continue;
      }

      // Click on the job card to open details
      jobCard.click();

      // Wait for job details to load
      await sleep(1500);

      // Extract job description
      const descriptionElement = jobDetailsContainer.querySelector('.jobs-description-content');

      // Extract job meta
      const jobMetaElement = jobDetailsContainer.querySelector('.job-details-jobs-unified-top-card__tertiary-description-container');
      const jobMeta = jobMetaElement.textContent.trim().split('·').map(s => s.trim()) || [];
      const [_, lastPostedAt, estimateTotalApplicants] = jobMeta;

      if (descriptionElement) {
        job.description = descriptionElement.textContent.trim();
        job.lastPostedAt = lastPostedAt;
        job.estimateTotalApplicants = estimateTotalApplicants;
      }

      // Check if the job matches the criteria
      job.matchCriteria = await checkJobCriteria(job);

      // Update notification periodically
      if ((i - startIndex) % 5 === 0) {
        showNotification(`Processing job details: ${i - startIndex + 1}/${scrapedJobs.length - startIndex}`);
      }

      // Wait for random amount of time between 1 and 3 seconds
      await sleep(Math.floor(Math.random() * 2000) + 1000);
    } catch (error) {
      console.error(`Error processing details for job ${i}:`, error);
    }
  }
}

// Find a job card element by its URL
// function findJobCardByUrl(url) {
//   return document.querySelector(`[href="${url}"]`).closest('.job-card-container');
// }

// Filter jobs based on criteria
function filterJobs(jobs) {
  return jobs.filter(job => {
    const title = job.title.toLowerCase();
    const location = job.location.toLowerCase();

    // Check title includes
    const hasTitleKeyword = config.includeKeywords.some(keyword =>
      title.includes(keyword.toLowerCase())
    );

    // Check title excludes
    const hasExcludedKeyword = config.excludeKeywords.some(keyword =>
      title.includes(keyword.toLowerCase())
    );

    // Check location includes
    // const hasRequiredLocation = config.locationRequirements.mustContain.some(keyword =>
    //   location.includes(keyword.toLowerCase())
    // );

    // Check location excludes
    // const hasExcludedLocation = config.locationRequirements.exclude.some(keyword =>
    //   location.includes(keyword.toLowerCase())
    // );

    // Job must:
    // 1. Have a relevant title
    // 2. Not have excluded keywords in title
    // 3. Be in the required location
    // 4. Not be in an excluded location type
    return hasTitleKeyword && !hasExcludedKeyword && hasRequiredLocation && !hasExcludedLocation;
  });
}

async function checkJobCriteria(job) {
  // Get the API key from Chrome's storage
  const result = await new Promise(resolve => {
    chrome.storage.local.get(['openaiApiKey'], resolve);
  });

  const apiKey = result.openaiApiKey;

  if (!apiKey) {
    console.error('OpenAI API key not found in storage');
    return false;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
            content: `
              You are a job-matching assistant. The user will provide a set of conditions they want in a job, then provide a single job listing. Your task is to determine if the provided job listing matches ANY of the user's specified conditions.

              To do this, you should:
              1. Interpret the job listing details (title, location, and/or description) and compare them with the user's criteria in a flexible way.
              2. Use your reasoning to determine if the listing meets ANY of the user's conditions.
              3. Output strictly "YES" if the listing meets any of the conditions; otherwise, output strictly "NO." No explanations.

              Do not provide any additional text apart from "YES" or "NO."
            `
          },
          {
            role: 'user',
            content: `
              Conditions: ${config.includeKeywords.join(', ')}.
              Location Requirements: ${config.locationRequirements.join(', ')}

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

    const data = await response.json();
    return data.choices[0].message.content.trim() === 'YES';
  } catch (error) {
    console.error('Error checking job criteria:', error);
    return false;
  }
}

// Export the data to CSV
function exportData(filteredJobs) {
  chrome.runtime.sendMessage({
    action: 'exportData',
    data: filteredJobs
  }, response => {
    console.log('Export response:', response);
  });
}