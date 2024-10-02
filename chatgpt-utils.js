const OpenAI = require('openai');
const { delay } = require('./utils');
const fs = require('fs').promises;
const path = require('path');

/**
 * Initializes the ChatGPT service with the provided configuration.
 * @param {Object} config - The configuration object for ChatGPT.
 * @param {string} config.api_key - The API key for OpenAI.
 * @param {string} config.model - The model to use for ChatGPT.
 * @param {number} config.max_retries - The maximum number of retries for rate limiting.
 * @param {number} config.initial_retry_delay - The initial delay (in ms) before retrying.
 * @returns {Promise<Object>} The initialized ChatGPT configuration object.
 */
async function initializeChatGPT(config) {
  const openai = new OpenAI({
    apiKey: config.api_key,
  });

  try {
    // Read AI instructions from file
    const aiInstructions = await fs.readFile(path.join(__dirname, 'ai_instructions.xml'), 'utf8');

    // Create a new assistant with the AI instructions
    const assistant = await openai.beta.assistants.create({
      name: "Ghost to Next.js Converter",
      instructions: aiInstructions,
      tools: [{ type: "code_interpreter" }],
      model: config.model || "gpt-4o-mini"  // Use a default if not specified
    });

    return {
      openai,
      assistant,
      maxRetries: config.max_retries || 5,
      initialRetryDelay: config.initial_retry_delay || 1000
    };
  } catch (error) {
    console.error('Error initializing ChatGPT:', error.message);
    throw error;
  }
}

/**
 * Sends a message to ChatGPT and retrieves the response.
 * @param {Object} chatgpt - The initialized ChatGPT configuration object.
 * @param {string} message - The message to send to ChatGPT.
 * @param {number} [retryCount=0] - The current retry attempt count.
 * @returns {Promise<Object>} The response object containing mdxContent and usage information.
 * @throws {Error} If the API call fails or max retries are reached.
 */
async function sendMessageToChatGPT(chatgpt, message, retryCount = 0) {
  const { openai, assistant, maxRetries, initialRetryDelay } = chatgpt;

  try {
    const thread = await openai.beta.threads.create();

    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: message,
    });

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistant.id,
      // Remove any additional instructions here
    });

    let mdxContent = '';
    let isComplete = false;

    const timeout = 300000; // 5 minutes timeout
    const startTime = Date.now();

    while (!isComplete && Date.now() - startTime < timeout) {
      const status = await openai.beta.threads.runs.retrieve(thread.id, run.id);

      if (status.status === 'completed') {
        const messages = await openai.beta.threads.messages.list(thread.id);
        const assistantMessage = messages.data.find(msg => msg.role === 'assistant');
        mdxContent = assistantMessage.content[0].text.value;
        isComplete = true;
      } else if (status.status === 'failed') {
        throw new Error('ChatGPT run failed: ' + status.last_error?.message || 'Unknown error');
      } else {
        await delay(1000); // Wait for 1 second before checking again
      }
    }

    if (!isComplete) {
      throw new Error('ChatGPT run timed out');
    }

    // Estimate token usage (this is a rough estimate, as OpenAI doesn't provide exact usage for the Assistants API)
    const usage = {
      input_tokens: Math.ceil(message.length / 4),  // Rough estimate
      output_tokens: Math.ceil(mdxContent.length / 4)  // Rough estimate
    };

    return { mdxContent, usage };
  } catch (error) {
    if (error.status === 429) {
      console.log('Rate limit hit. Retrying after delay...');
      if (retryCount < maxRetries) {
        const retryDelay = initialRetryDelay * Math.pow(2, retryCount);
        await delay(retryDelay);
        return sendMessageToChatGPT(chatgpt, message, retryCount + 1);
      } else {
        throw new Error('Max retries reached for rate limit');
      }
    } else {
      console.error('Error calling ChatGPT API:', error.message);
      throw error;
    }
  }
}

module.exports = {
  initializeChatGPT,
  sendMessageToChatGPT,
};