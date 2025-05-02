document.addEventListener('DOMContentLoaded', () => {

  // --- Collapsible Privacy Policy --- //
  const privacyToggle = document.querySelector('.collapsible-section .collapsible-toggle');
  const privacyContent = document.querySelector('.collapsible-section .collapsible-content');

  if (privacyToggle && privacyContent) {
      privacyToggle.addEventListener('click', () => {
          const isExpanded = privacyToggle.getAttribute('aria-expanded') === 'true';
          privacyToggle.setAttribute('aria-expanded', !isExpanded);
          // Content visibility is handled by CSS transitions based on aria-expanded
      });
  }

  // --- FAQ Accordion --- //
  const accordionHeaders = document.querySelectorAll('.accordion-header');

  accordionHeaders.forEach(header => {
      header.addEventListener('click', () => {
          const accordionItem = header.parentElement;
          const accordionContent = header.nextElementSibling;
          const isExpanded = header.getAttribute('aria-expanded') === 'true';

          // Close other open items if you want only one open at a time
          // Comment this block out if you want multiple items open simultaneously
          /*
          document.querySelectorAll('.accordion-item').forEach(item => {
              if (item !== accordionItem) {
                  item.querySelector('.accordion-header').setAttribute('aria-expanded', 'false');
              }
          });
          */

          // Toggle the clicked item
          header.setAttribute('aria-expanded', !isExpanded);
          // Content visibility is handled by CSS transitions based on aria-expanded

      });
  });

});
