const axios = require('axios');
const { delay } = require('./utils');
const fs = require('fs').promises;

/**
 * Initializes the Claude AI service with the provided configuration.
 * @param {Object} config - The configuration object for Claude.
 * @param {string} config.api_key - The API key for Claude.
 * @param {string} config.model - The model to use for Claude.
 * @param {number} config.max_tokens - The maximum number of tokens to generate.
 * @param {number} config.max_retries - The maximum number of retries for rate limiting.
 * @param {number} config.initial_retry_delay - The initial delay (in ms) before retrying.
 * @returns {Promise<Object>} The initialized Claude configuration object.
 */
async function initializeClaude(config) {
  const apiUrl = 'https://api.anthropic.com/v1/messages';
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': config.api_key,
    'anthropic-version': '2023-06-01'  // Update this if a newer API version is available
  };

  return {
    apiUrl,
    headers,
    model: config.model,
    maxTokens: config.max_tokens,
    maxRetries: config.max_retries,
    initialRetryDelay: config.initial_retry_delay
  };
}

/**
 * Sends a message to Claude AI and retrieves the response.
 * @param {Object} claude - The initialized Claude configuration object.
 * @param {Array} messages - The array of message objects to send to Claude.
 * @param {number} [retryCount=0] - The current retry attempt count.
 * @returns {Promise<Object>} The response object containing mdxContent and usage information.
 * @throws {Error} If the API call fails or max retries are reached.
 */
async function sendMessageToClaude(claude, messages, retryCount = 0) {
  const { apiUrl, headers, model, maxTokens } = claude;

  const data = {
    model,
    max_tokens: maxTokens,
    messages
  };

  try {
    const response = await axios.post(apiUrl, data, { headers });
    const mdxContent = response.data.content[0].text;
    
    const usage = {
      input_tokens: response.data.usage.input_tokens,
      output_tokens: response.data.usage.output_tokens
    };

    return { mdxContent, usage };
  } catch (error) {
    if (error.response && error.response.status === 429) {
      const errorMessage = error.response.data.error.message || 'No specific error message provided';
      const logMessage = `Rate limit hit. Claude message: ${errorMessage}`;
      
      console.log(logMessage);
      await logToFile(logMessage);

      if (errorMessage.includes("daily rate limit")) {
        const dailyLimitMessage = 'Daily rate limit reached. The script will now end. You can switch to the ChatGPT API by updating the config.yaml file.';
        console.log(dailyLimitMessage);
        await logToFile(dailyLimitMessage);
        process.exit(0);  // Exit the script gracefully
      }

      if (retryCount < claude.maxRetries) {
        const retryDelay = claude.initialRetryDelay * Math.pow(2, retryCount);
        const retryMessage = `Retrying after ${retryDelay / 1000} seconds...`;
        console.log(retryMessage);
        await logToFile(retryMessage);

        await delay(retryDelay);
        return sendMessageToClaude(claude, messages, retryCount + 1);
      } else {
        const maxRetriesMessage = 'Max retries reached for rate limit';
        console.log(maxRetriesMessage);
        await logToFile(maxRetriesMessage);
        throw new Error(maxRetriesMessage);
      }
    } else {
      const errorMessage = `Error calling Claude AI: ${error.response?.data || error.message}`;
      console.error(errorMessage);
      await logToFile(errorMessage);
      throw error;
    }
  }
}

async function logToFile(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp}: ${message}\n`;
  await fs.appendFile('conversion.log', logMessage);
}

module.exports = {
  initializeClaude,
  sendMessageToClaude,
};