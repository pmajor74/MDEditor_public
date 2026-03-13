/**
 * Settings Panel Section Builders
 *
 * HTML builders for Azure and LLM provider settings sections.
 * Split from settings-panel.js to keep file sizes manageable.
 */

/**
 * Build Azure DevOps settings section HTML
 * @param {Object} azure - Azure config values (masked)
 * @returns {string} HTML string
 */
export function buildAzureSection(azure = {}) {
  return `
    <div class="settings-section">
      <h3>Azure DevOps</h3>
      <div class="settings-hint">
        Connection settings for Azure DevOps Wiki integration.
      </div>

      <div class="settings-row">
        <label for="setting-azure-org">Organization
          <span class="settings-tooltip" title="Your Azure DevOps organization name (from URL: dev.azure.com/{org})">?</span>
        </label>
        <div class="settings-control">
          <input type="text" id="setting-azure-org" value="${escapeAttr(azure.org || '')}" placeholder="my-organization" />
        </div>
      </div>

      <div class="settings-row">
        <label for="setting-azure-project">Project
          <span class="settings-tooltip" title="Azure DevOps project name">?</span>
        </label>
        <div class="settings-control">
          <input type="text" id="setting-azure-project" value="${escapeAttr(azure.project || '')}" placeholder="my-project" />
        </div>
      </div>

      <div class="settings-row">
        <label for="setting-azure-pat">Personal Access Token
          <span class="settings-tooltip" title="PAT with Wiki Read/Write scope. Create at dev.azure.com/{org}/_usersSettings/tokens">?</span>
        </label>
        <div class="settings-control settings-control-secret">
          <input type="password" id="setting-azure-pat" value="${escapeAttr(azure.pat || '')}" placeholder="paste PAT here" />
          <button type="button" class="settings-toggle-vis" data-target="setting-azure-pat" title="Show/hide value">Show</button>
        </div>
      </div>

      <div class="settings-row">
        <label for="setting-azure-wiki-id">Wiki ID
          <span class="settings-tooltip" title="Found in your wiki URL: /_wiki/wikis/{WIKI_ID}/...">?</span>
        </label>
        <div class="settings-control">
          <input type="text" id="setting-azure-wiki-id" value="${escapeAttr(azure.wikiId || '')}" placeholder="MyProject.wiki" />
        </div>
      </div>

      <div class="settings-row">
        <label for="setting-azure-root-path">Root Path
          <span class="settings-tooltip" title="Optional: Only show pages under this path (e.g. /docs)">?</span>
        </label>
        <div class="settings-control">
          <input type="text" id="setting-azure-root-path" value="${escapeAttr(azure.wikiRootPath || '')}" placeholder="/ (entire wiki)" />
        </div>
      </div>

      <div class="settings-row">
        <label for="setting-azure-wiki-url">Wiki URL (alternative)
          <span class="settings-tooltip" title="Paste a full wiki URL to auto-extract org, project, and wiki ID">?</span>
        </label>
        <div class="settings-control">
          <input type="text" id="setting-azure-wiki-url" value="${escapeAttr(azure.wikiUrl || '')}" placeholder="https://dev.azure.com/org/project/_wiki/wikis/..." />
        </div>
      </div>
    </div>
  `;
}

/**
 * Build LLM Provider settings section HTML
 * @param {Object} llm - LLM config values (masked)
 * @returns {string} HTML string
 */
export function buildLLMSection(llm = {}) {
  const provider = llm.provider || 'gemini';

  return `
    <div class="settings-section">
      <h3>AI / LLM Provider</h3>
      <div class="settings-hint">
        Configure the AI provider for copilot features, code indexing, and documentation generation.
      </div>

      <div class="settings-row">
        <label for="setting-llm-provider">Provider</label>
        <div class="settings-control">
          <select id="setting-llm-provider">
            <option value="gemini" ${provider === 'gemini' ? 'selected' : ''}>Google Gemini</option>
            <option value="openai" ${provider === 'openai' ? 'selected' : ''}>OpenAI</option>
            <option value="azure" ${provider === 'azure' ? 'selected' : ''}>Azure OpenAI</option>
            <option value="anthropic" ${provider === 'anthropic' ? 'selected' : ''}>Anthropic Claude</option>
          </select>
        </div>
      </div>

      <div class="settings-row">
        <label for="setting-llm-max-tokens">Max Output Tokens
          <span class="settings-tooltip" title="Maximum tokens the AI can generate per response. 0 = use provider default. Increase if responses are cut off.">?</span>
        </label>
        <div class="settings-control">
          <input type="number" id="setting-llm-max-tokens" min="0" max="200000" step="1024" value="${llm.maxOutputTokens || 0}" style="width: 100px;" />
          <span class="settings-value" id="llm-max-tokens-hint" style="min-width: 80px;">${(llm.maxOutputTokens || 0) === 0 ? 'Default' : (llm.maxOutputTokens || 0).toLocaleString()}</span>
        </div>
      </div>
      <div class="settings-hint">
        Set to 0 for provider defaults (Gemini: 65K, OpenAI/Azure: 16K, Anthropic: 8K). Increase if AI responses are being cut off.
      </div>

      <!-- Gemini -->
      <div class="settings-provider-group" data-provider="gemini" style="display:${provider === 'gemini' ? 'block' : 'none'}">
        <div class="settings-row">
          <label for="setting-gemini-key">API Key</label>
          <div class="settings-control settings-control-secret">
            <input type="password" id="setting-gemini-key" value="${escapeAttr(llm.gemini?.apiKey || '')}" placeholder="enter API key" />
            <button type="button" class="settings-toggle-vis" data-target="setting-gemini-key" title="Show/hide value">Show</button>
          </div>
        </div>
        <div class="settings-row">
          <label for="setting-gemini-model">Model</label>
          <div class="settings-control">
            <input type="text" id="setting-gemini-model" value="${escapeAttr(llm.gemini?.model || 'gemini-2.0-flash')}" />
          </div>
        </div>
      </div>

      <!-- OpenAI -->
      <div class="settings-provider-group" data-provider="openai" style="display:${provider === 'openai' ? 'block' : 'none'}">
        <div class="settings-row">
          <label for="setting-openai-key">API Key</label>
          <div class="settings-control settings-control-secret">
            <input type="password" id="setting-openai-key" value="${escapeAttr(llm.openai?.apiKey || '')}" placeholder="enter API key" />
            <button type="button" class="settings-toggle-vis" data-target="setting-openai-key" title="Show/hide value">Show</button>
          </div>
        </div>
        <div class="settings-row">
          <label for="setting-openai-model">Model</label>
          <div class="settings-control">
            <input type="text" id="setting-openai-model" value="${escapeAttr(llm.openai?.model || 'gpt-4o')}" />
          </div>
        </div>
      </div>

      <!-- Azure OpenAI -->
      <div class="settings-provider-group" data-provider="azure" style="display:${provider === 'azure' ? 'block' : 'none'}">
        <div class="settings-row">
          <label for="setting-azure-openai-key">API Key</label>
          <div class="settings-control settings-control-secret">
            <input type="password" id="setting-azure-openai-key" value="${escapeAttr(llm.azure?.apiKey || '')}" placeholder="enter API key" />
            <button type="button" class="settings-toggle-vis" data-target="setting-azure-openai-key" title="Show/hide value">Show</button>
          </div>
        </div>
        <div class="settings-row">
          <label for="setting-azure-openai-endpoint">Endpoint</label>
          <div class="settings-control">
            <input type="text" id="setting-azure-openai-endpoint" value="${escapeAttr(llm.azure?.endpoint || '')}" placeholder="https://your-resource.openai.azure.com" />
          </div>
        </div>
        <div class="settings-row">
          <label for="setting-azure-openai-deployment">Deployment</label>
          <div class="settings-control">
            <input type="text" id="setting-azure-openai-deployment" value="${escapeAttr(llm.azure?.deployment || '')}" placeholder="your-deployment-name" />
          </div>
        </div>
        <div class="settings-row">
          <label for="setting-azure-openai-model">Model</label>
          <div class="settings-control">
            <input type="text" id="setting-azure-openai-model" value="${escapeAttr(llm.azure?.model || 'gpt-4o')}" />
          </div>
        </div>
        <div class="settings-row">
          <label for="setting-azure-openai-embedding">Embedding Deployment
            <span class="settings-tooltip" title="Required for vector search/RAG. Deploy text-embedding-ada-002 or text-embedding-3-small.">?</span>
          </label>
          <div class="settings-control">
            <input type="text" id="setting-azure-openai-embedding" value="${escapeAttr(llm.azure?.embeddingDeployment || '')}" placeholder="your-embedding-deployment" />
          </div>
        </div>
      </div>

      <!-- Anthropic -->
      <div class="settings-provider-group" data-provider="anthropic" style="display:${provider === 'anthropic' ? 'block' : 'none'}">
        <div class="settings-row">
          <label for="setting-anthropic-key">API Key</label>
          <div class="settings-control settings-control-secret">
            <input type="password" id="setting-anthropic-key" value="${escapeAttr(llm.anthropic?.apiKey || '')}" placeholder="enter API key" />
            <button type="button" class="settings-toggle-vis" data-target="setting-anthropic-key" title="Show/hide value">Show</button>
          </div>
        </div>
        <div class="settings-row">
          <label for="setting-anthropic-model">Model</label>
          <div class="settings-control">
            <input type="text" id="setting-anthropic-model" value="${escapeAttr(llm.anthropic?.model || 'claude-sonnet-4-20250514')}" />
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Attach event listeners for provider group toggling
 * @param {HTMLElement} panel - Settings panel element
 */
export function attachProviderToggle(panel) {
  const providerSelect = panel.querySelector('#setting-llm-provider');
  if (!providerSelect) return;

  providerSelect.addEventListener('change', (e) => {
    const groups = panel.querySelectorAll('.settings-provider-group');
    groups.forEach(g => {
      g.style.display = g.dataset.provider === e.target.value ? 'block' : 'none';
    });
  });

  // Max output tokens hint update
  const maxTokensInput = panel.querySelector('#setting-llm-max-tokens');
  const maxTokensHint = panel.querySelector('#llm-max-tokens-hint');
  if (maxTokensInput && maxTokensHint) {
    maxTokensInput.addEventListener('input', () => {
      const val = parseInt(maxTokensInput.value, 10) || 0;
      maxTokensHint.textContent = val === 0 ? 'Default' : val.toLocaleString();
    });
  }

  // Show/hide toggle buttons for secret fields
  panel.querySelectorAll('.settings-toggle-vis').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = panel.querySelector(`#${btn.dataset.target}`);
      if (!input) return;
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      btn.textContent = isHidden ? 'Hide' : 'Show';
    });
  });
}

/**
 * Collect Azure + LLM values from the settings panel form.
 * Only includes password fields if the user actually typed something.
 * @param {HTMLElement} panel
 * @returns {Object} Partial config update
 */
export function collectConnectionSettings(panel) {
  const update = { azure: {}, llm: { gemini: {}, openai: {}, azure: {}, anthropic: {} }, transcription: {} };

  // Azure
  update.azure.org = panel.querySelector('#setting-azure-org')?.value || '';
  update.azure.project = panel.querySelector('#setting-azure-project')?.value || '';
  update.azure.wikiId = panel.querySelector('#setting-azure-wiki-id')?.value || '';
  update.azure.wikiRootPath = panel.querySelector('#setting-azure-root-path')?.value || '';
  update.azure.wikiUrl = panel.querySelector('#setting-azure-wiki-url')?.value || '';

  // Only update PAT if user actually entered something
  const patVal = panel.querySelector('#setting-azure-pat')?.value;
  if (patVal) update.azure.pat = patVal;

  // LLM provider
  update.llm.provider = panel.querySelector('#setting-llm-provider')?.value || 'gemini';
  update.llm.maxOutputTokens = parseInt(panel.querySelector('#setting-llm-max-tokens')?.value, 10) || 0;

  // Gemini
  const geminiKey = panel.querySelector('#setting-gemini-key')?.value;
  if (geminiKey) update.llm.gemini.apiKey = geminiKey;
  update.llm.gemini.model = panel.querySelector('#setting-gemini-model')?.value || '';

  // OpenAI
  const openaiKey = panel.querySelector('#setting-openai-key')?.value;
  if (openaiKey) update.llm.openai.apiKey = openaiKey;
  update.llm.openai.model = panel.querySelector('#setting-openai-model')?.value || '';

  // Azure OpenAI
  const azureOAIKey = panel.querySelector('#setting-azure-openai-key')?.value;
  if (azureOAIKey) update.llm.azure.apiKey = azureOAIKey;
  update.llm.azure.endpoint = panel.querySelector('#setting-azure-openai-endpoint')?.value || '';
  update.llm.azure.deployment = panel.querySelector('#setting-azure-openai-deployment')?.value || '';
  update.llm.azure.model = panel.querySelector('#setting-azure-openai-model')?.value || '';
  update.llm.azure.embeddingDeployment = panel.querySelector('#setting-azure-openai-embedding')?.value || '';

  // Anthropic
  const anthropicKey = panel.querySelector('#setting-anthropic-key')?.value;
  if (anthropicKey) update.llm.anthropic.apiKey = anthropicKey;
  update.llm.anthropic.model = panel.querySelector('#setting-anthropic-model')?.value || '';

  // Transcription
  update.transcription.whisperPath = panel.querySelector('#setting-whisper-path')?.value || '';
  update.transcription.modelPath = panel.querySelector('#setting-model-path')?.value || '';
  update.transcription.modelName = panel.querySelector('#setting-model-name')?.value || 'medium';
  update.transcription.language = panel.querySelector('#setting-transcription-language')?.value || 'en';
  update.transcription.flashAttention = panel.querySelector('#setting-flash-attention')?.checked ?? true;
  update.transcription.beamSize = parseInt(panel.querySelector('#setting-beam-size')?.value || '1', 10);
  update.transcription.threads = parseInt(panel.querySelector('#setting-threads')?.value || '0', 10);

  return update;
}

/**
 * Build Transcription settings section HTML
 * @param {Object} transcription - Transcription config values
 * @returns {string} HTML string
 */
export function buildTranscriptionSection(transcription = {}) {
  const modelName = transcription.modelName || 'medium';
  const flashAttention = transcription.flashAttention !== false;
  const beamSize = transcription.beamSize ?? 1;
  const threads = transcription.threads ?? 0;

  return `
    <div class="settings-section">
      <h3>Audio Transcription</h3>
      <div class="settings-hint">
        Local audio transcription using whisper.cpp. Right-click audio files in the file browser to transcribe.
      </div>

      <div class="settings-row">
        <label for="setting-whisper-path">Whisper Binary Path
          <span class="settings-tooltip" title="Path to whisper-cli.exe. Leave empty to auto-download on first use.">?</span>
        </label>
        <div class="settings-control">
          <input type="text" id="setting-whisper-path" value="${escapeAttr(transcription.whisperPath || '')}" placeholder="Auto-download on first use" />
        </div>
      </div>

      <div class="settings-row">
        <label for="setting-model-path">Model File Path
          <span class="settings-tooltip" title="Path to GGML model file. Leave empty to auto-download on first use.">?</span>
        </label>
        <div class="settings-control">
          <input type="text" id="setting-model-path" value="${escapeAttr(transcription.modelPath || '')}" placeholder="Auto-download on first use" />
        </div>
      </div>

      <div class="settings-row">
        <label for="setting-model-name">Model Size
          <span class="settings-tooltip" title="Larger models are more accurate but slower and require more RAM/VRAM.">?</span>
        </label>
        <div class="settings-control">
          <select id="setting-model-name">
            <option value="tiny" ${modelName === 'tiny' ? 'selected' : ''}>Tiny (~75 MB)</option>
            <option value="base" ${modelName === 'base' ? 'selected' : ''}>Base (~142 MB)</option>
            <option value="small" ${modelName === 'small' ? 'selected' : ''}>Small (~466 MB)</option>
            <option value="medium" ${modelName === 'medium' ? 'selected' : ''}>Medium (~1.5 GB)</option>
            <option value="large-v3" ${modelName === 'large-v3' ? 'selected' : ''}>Large v3 (~3 GB)</option>
          </select>
        </div>
      </div>

      <div class="settings-row">
        <label for="setting-transcription-language">Language
          <span class="settings-tooltip" title="Language code for transcription (e.g., en, es, fr). Leave as 'en' for English.">?</span>
        </label>
        <div class="settings-control">
          <input type="text" id="setting-transcription-language" value="${escapeAttr(transcription.language || 'en')}" placeholder="en" style="width: 80px;" />
        </div>
      </div>

      <h4 style="margin: 16px 0 8px;">Performance</h4>

      <div class="settings-row">
        <label for="setting-flash-attention">Flash Attention
          <span class="settings-tooltip" title="Enable flash attention for faster GPU inference. Requires CUDA build (default). Disable only if you experience errors.">?</span>
        </label>
        <div class="settings-control">
          <input type="checkbox" id="setting-flash-attention" ${flashAttention ? 'checked' : ''} />
        </div>
      </div>

      <div class="settings-row">
        <label for="setting-beam-size">Beam Size
          <span class="settings-tooltip" title="1 = greedy decoding (fastest). Higher values (e.g. 5) improve accuracy but are much slower. Default: 1.">?</span>
        </label>
        <div class="settings-control">
          <select id="setting-beam-size">
            <option value="1" ${beamSize === 1 ? 'selected' : ''}>1 - Greedy (fastest)</option>
            <option value="2" ${beamSize === 2 ? 'selected' : ''}>2</option>
            <option value="5" ${beamSize === 5 ? 'selected' : ''}>5 - Beam search (most accurate)</option>
          </select>
        </div>
      </div>

      <div class="settings-row">
        <label for="setting-threads">CPU Threads
          <span class="settings-tooltip" title="Number of CPU threads for processing. 0 = auto-detect (uses all available cores). Increase if CPU is underutilized.">?</span>
        </label>
        <div class="settings-control">
          <input type="number" id="setting-threads" value="${threads}" min="0" max="64" style="width: 80px;" />
        </div>
      </div>

      <div class="settings-row">
        <label>Download Model</label>
        <div class="settings-control">
          <button type="button" class="settings-btn settings-btn-secondary" id="settings-download-model">Download Selected Model</button>
          <span class="settings-value" id="settings-download-status"></span>
        </div>
      </div>
    </div>
  `;
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
