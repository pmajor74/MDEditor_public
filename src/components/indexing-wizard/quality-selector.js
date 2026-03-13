/**
 * Quality Selector Component
 * Provides three-tier quality selection cards for indexing (Low/Medium/High)
 */

// Quality tier definitions
export const QUALITY_TIERS = {
  low: {
    id: 'low',
    name: 'Low',
    description: 'Fast indexing using structural chunking',
    features: [
      'Basic text chunking',
      'Header-aware splitting',
      'Fast processing'
    ],
    speed: 'Fast',
    tokenCost: 'None',
    helpText: 'Fast indexing using structural chunking. Best for quick searches where you just need to find content by keywords.',
    detailedHelp: 'Splits files into chunks based on structure (headers, code blocks, paragraphs). No AI processing is involved, so indexing is instant and costs zero tokens. Best for keyword-based searches where you just need to locate content quickly.',
    useCases: ['Quick keyword search', 'Large codebases where speed matters', 'No API key required'],
    icon: '⚡'
  },
  medium: {
    id: 'medium',
    name: 'Medium',
    description: 'Enhanced with manifest parsing and file metadata',
    features: [
      'Basic text chunking',
      'Manifest parsing (package.json, etc.)',
      'README prioritization',
      'File-level metadata'
    ],
    speed: 'Medium',
    tokenCost: 'None',
    helpText: 'Adds manifest parsing (package.json, requirements.txt, etc.) and README prioritization. Better for "what tech does this use?" type questions.',
    detailedHelp: 'Includes everything from Low, plus parses manifest files (package.json, requirements.txt, .csproj, etc.) to extract dependency and project metadata. README files are prioritized for better context. Zero token cost since no LLM calls are made.',
    useCases: ['Understanding project dependencies', 'Tech stack questions', 'Better relevance without token cost'],
    icon: '⚙️'
  },
  high: {
    id: 'high',
    name: 'High',
    description: 'AI-powered with LLM-generated summaries',
    features: [
      'Basic text chunking',
      'Manifest parsing',
      'README prioritization',
      'LLM file summaries',
      'Project overview'
    ],
    speed: 'Slow',
    tokenCost: 'Variable',
    helpText: 'Uses LLM to generate file summaries and project overview. Best answer quality but costs tokens. Good for deep codebase understanding.',
    detailedHelp: 'Includes everything from Medium, plus uses your configured LLM to generate a natural-language summary for each file and a project-wide overview. Produces the highest quality search results, but processes each file through the AI, consuming tokens and taking longer.',
    useCases: ['Deep codebase understanding', 'Architecture questions', 'Best answer quality for complex queries'],
    icon: '🧠'
  }
};

/**
 * Create the quality selector HTML
 * @param {string} selectedTier - Currently selected tier ('low', 'medium', 'high')
 * @param {Object} tokenEstimate - Token estimate for high quality {inputTokens, outputTokens, total}
 * @returns {string} HTML string
 */
export function createQualitySelectorHTML(selectedTier = 'medium', tokenEstimate = null) {
  const tiers = Object.values(QUALITY_TIERS);

  return `
    <div class="quality-selector">
      <div class="quality-selector-header">
        <label class="quality-selector-title">Select Indexing Quality</label>
        <button class="quality-help-btn" title="Learn about quality tiers">?</button>
      </div>
      <div class="quality-cards">
        ${tiers.map(tier => createQualityCardHTML(tier, tier.id === selectedTier, tokenEstimate)).join('')}
      </div>
      <div class="quality-info-panel hidden">
        <h4>Understanding Quality Tiers</h4>
        ${tiers.map(tier => `
          <div class="quality-info-tier">
            <div class="quality-info-tier-header">
              <span class="quality-info-tier-icon">${tier.icon}</span>
              <span class="quality-info-tier-name">${tier.name}</span>
              <span class="quality-info-tier-meta">${tier.speed} | ${tier.tokenCost} tokens</span>
            </div>
            <div class="quality-info-tier-detail">${tier.detailedHelp}</div>
            <ul class="quality-info-tier-usecases">
              ${tier.useCases.map(uc => `<li>${escapeHtml(uc)}</li>`).join('')}
            </ul>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/**
 * Create HTML for a single quality card
 * @param {Object} tier - Tier definition
 * @param {boolean} isSelected - Whether this tier is selected
 * @param {Object} tokenEstimate - Token estimate (for high tier)
 * @returns {string} HTML string
 */
function createQualityCardHTML(tier, isSelected, tokenEstimate) {
  const showTokenEstimate = tier.id === 'high' && tokenEstimate;

  return `
    <div class="quality-card ${isSelected ? 'selected' : ''}" data-tier="${tier.id}">
      <div class="quality-card-header">
        <input type="radio" name="quality-tier" value="${tier.id}" ${isSelected ? 'checked' : ''}>
        <span class="quality-card-icon">${tier.icon}</span>
        <span class="quality-card-name">${tier.name}</span>
      </div>
      <div class="quality-card-body">
        <ul class="quality-features">
          ${tier.features.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
        </ul>
        <div class="quality-card-meta">
          <span class="quality-speed">${tier.speed}</span>
          <span class="quality-cost">${showTokenEstimate ? `~${formatTokens(tokenEstimate.total)} tokens` : tier.tokenCost}</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Format token count for display
 * @param {number} tokens - Token count
 * @returns {string} Formatted string
 */
function formatTokens(tokens) {
  if (tokens >= 1000000) {
    return (tokens / 1000000).toFixed(1) + 'M';
  } else if (tokens >= 1000) {
    return (tokens / 1000).toFixed(0) + 'K';
  }
  return tokens.toString();
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Initialize quality selector event handlers
 * @param {HTMLElement} container - Container element with the quality selector
 * @param {Function} onSelectionChange - Callback when selection changes
 */
export function initQualitySelector(container, onSelectionChange) {
  const cards = container.querySelectorAll('.quality-card');
  const helpBtn = container.querySelector('.quality-help-btn');
  const infoPanel = container.querySelector('.quality-info-panel');

  // Card selection
  cards.forEach(card => {
    card.addEventListener('click', () => {
      // Update selection visually
      cards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');

      // Update radio button
      const radio = card.querySelector('input[type="radio"]');
      radio.checked = true;

      // Callback
      const tier = card.dataset.tier;
      if (onSelectionChange) {
        onSelectionChange(tier);
      }
    });
  });

  // Help info panel toggle
  if (helpBtn && infoPanel) {
    helpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      infoPanel.classList.toggle('hidden');
    });
  }
}

/**
 * Get selected quality tier from container
 * @param {HTMLElement} container - Container element
 * @returns {string} Selected tier ('low', 'medium', 'high')
 */
export function getSelectedTier(container) {
  const selected = container.querySelector('input[name="quality-tier"]:checked');
  return selected ? selected.value : 'medium';
}

/**
 * Update token estimate display for high tier
 * @param {HTMLElement} container - Container element
 * @param {Object} tokenEstimate - Token estimate {inputTokens, outputTokens, total}
 */
export function updateTokenEstimate(container, tokenEstimate) {
  const highCard = container.querySelector('.quality-card[data-tier="high"]');
  if (highCard && tokenEstimate) {
    const costEl = highCard.querySelector('.quality-cost');
    if (costEl) {
      costEl.textContent = `~${formatTokens(tokenEstimate.total)} tokens`;
    }
  }
}
