function buildPromptFromForm() {
  const preset = document.getElementById('preset')?.value || 'custom';
  const product = document.getElementById('product')?.value?.trim() || '';
  const headline = document.getElementById('headline')?.value?.trim() || '';
  const body = document.getElementById('body')?.value?.trim() || '';
  const cta = document.getElementById('cta')?.value?.trim() || '';
  const audience = document.getElementById('audience')?.value?.trim() || '';
  const proof = document.getElementById('proof')?.value?.trim() || '';
  const channels = Array.from(document.querySelectorAll('.ch:checked')).map(x => x.value);
  const brief = {
    campaign_type: preset,
    product, headline, body, cta, audience, proof,
    channels_requested: channels
  };
  return JSON.stringify(brief);
}

// Function to send form data to backend and display results
async function generateVariants() {
  console.log('Generate button clicked - starting variant generation');

  const demoButton = document.getElementById('demo');
  const progressBar = document.getElementById('bar');
  const resultsContainer = document.getElementById('results');

  if (!demoButton) {
    console.error('Generate button not found');
    return;
  }

  try {
    // Show loading state
    demoButton.disabled = true;
    demoButton.innerHTML = '⏳ Generating...';
    if (progressBar) {
      progressBar.style.width = '50%';
    }

    // Get form data
    const formData = {
      campaign_type: document.getElementById('preset')?.value || 'saas',
      product: document.getElementById('product')?.value?.trim() || '',
      headline: document.getElementById('headline')?.value?.trim() || '',
      body: document.getElementById('body')?.value?.trim() || ''
    };

    console.log('Sending form data:', formData);

    // Send POST request to backend
    const response = await fetch('/variants', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(formData)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('Received response:', data);

    // Update progress bar
    if (progressBar) {
      progressBar.style.width = '100%';
    }

    // Display results
    displayVariants(data);

  } catch (error) {
    console.error('Error generating variants:', error);
    showError('Failed to generate variants: ' + error.message);
  } finally {
    // Reset button state
    demoButton.disabled = false;
    demoButton.innerHTML = '⚡ Demo';
    if (progressBar) {
      progressBar.style.width = '0%';
    }
  }
}

// Function to display variants in the UI
function displayVariants(data) {
  console.log('Displaying variants:', data);

  let resultsContainer = document.getElementById('results');

  // Create results container if it doesn't exist
  if (!resultsContainer) {
    resultsContainer = document.createElement('div');
    resultsContainer.id = 'results';
    resultsContainer.className = 'results-section';

    // Insert after the main form card
    const mainCard = document.querySelector('.card');
    if (mainCard && mainCard.parentNode) {
      mainCard.parentNode.insertBefore(resultsContainer, mainCard.nextSibling);
    } else {
      document.querySelector('main').appendChild(resultsContainer);
    }
  }

  // Clear previous results
  resultsContainer.innerHTML = '';

  // Create results HTML
  let resultsHtml = '<div class="card"><h2>Generated Variants</h2>';

  if (data.variants && Array.isArray(data.variants) && data.variants.length > 0) {
    resultsHtml += '<div class="variants-grid">';

    data.variants.forEach((variant, index) => {
      resultsHtml += `
        <div class="variant-card">
          <h3>Variant ${index + 1}</h3>
          <div class="variant-content">
            ${variant.headline ? `<p><strong>Headline:</strong> ${variant.headline}</p>` : ''}
            ${variant.body ? `<p><strong>Body:</strong> ${variant.body}</p>` : ''}
            ${variant.cta ? `<p><strong>CTA:</strong> ${variant.cta}</p>` : ''}
            ${variant.channel ? `<p><strong>Channel:</strong> ${variant.channel}</p>` : ''}
          </div>
        </div>
      `;
    });

    resultsHtml += '</div>';
  } else {
    resultsHtml += '<p>No variants were generated. Please try again.</p>';
  }

  resultsHtml += '</div>';
  resultsContainer.innerHTML = resultsHtml;
}

// Function to show error messages
function showError(message) {
  console.error('Showing error:', message);

  let errorContainer = document.getElementById('error-message');

  if (!errorContainer) {
    errorContainer = document.createElement('div');
    errorContainer.id = 'error-message';
    errorContainer.className = 'error-message';
    errorContainer.style.cssText = 'background: #fee; color: #c33; padding: 1rem; margin: 1rem 0; border: 1px solid #fcc; border-radius: 4px;';

    const mainCard = document.querySelector('.card');
    if (mainCard && mainCard.parentNode) {
      mainCard.parentNode.insertBefore(errorContainer, mainCard.nextSibling);
    }
  }

  errorContainer.innerHTML = `<p><strong>Error:</strong> ${message}</p>`;

  // Auto-hide error after 5 seconds
  setTimeout(() => {
    if (errorContainer.parentNode) {
      errorContainer.parentNode.removeChild(errorContainer);
    }
  }, 5000);
}

// Initialize event listeners when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  console.log('Script loaded, setting up event listeners');

  const generateButton = document.getElementById('demo');
  if (generateButton) {
    generateButton.addEventListener('click', generateVariants);
    console.log('Generate button event listener attached');
  } else {
    console.error('Generate button not found - check HTML structure');
  }

  // Also handle vertical preset buttons if they exist
  const verticalButtons = document.querySelectorAll('.vbtn');
  verticalButtons.forEach(button => {
    button.addEventListener('click', function() {
      const preset = this.getAttribute('data-preset');
      if (preset) {
        const presetSelect = document.getElementById('preset');
        if (presetSelect) {
          presetSelect.value = preset;
          console.log('Preset changed to:', preset);
        }
      }
    });
  });
});

console.log('Script.js loaded successfully');
