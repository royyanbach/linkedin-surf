// Listen for clicks on the extension icon
chrome.action.onClicked.addListener((tab) => {
  // Check if the current page is a LinkedIn jobs search page
  if (tab.url.includes('linkedin.com/jobs/search')) {
    // Send a message to the content script to start scraping
    chrome.tabs.sendMessage(tab.id, { action: 'startScraping' });
  } else {
    // Notify user if they're not on a LinkedIn jobs page
    chrome.tabs.create({ url: 'https://www.linkedin.com/jobs/' });
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'exportData') {
    // Export the data as CSV
    exportToCSV(message.data);
    sendResponse({ success: true });
  }
  // Return true to indicate we'll respond asynchronously
  return true;
});

// Function to export data to CSV
function exportToCSV(data) {
  // Create CSV content
  let csvContent = 'Match Criteria,Title,Company,Location,URL\n';

  data.forEach(job => {
    // Escape commas in fields
    const title = `"${job.title.replace(/"/g, '""')}"`;
    const company = `"${job.company.replace(/"/g, '""')}"`;
    const location = `"${job.location.replace(/"/g, '""')}"`;
    const url = `https://www.linkedin.com/jobs/view/${job.id}`;
    const matchCriteria = job.matchCriteria ? 'TRUE' : 'FALSE';

    csvContent += `${matchCriteria},${title},${company},${location},${url}\n`;
  });

  // Create a data URI and download the CSV
  const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `linkedin-jobs-${timestamp}.csv`;

  chrome.downloads.download({
    url: dataUri,
    filename: filename,
    saveAs: true
  });
}