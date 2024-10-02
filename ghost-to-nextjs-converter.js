#!/usr/bin/env node

const { promises: fs } = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp'); // Add this line
const { initializeClaude, sendMessageToClaude } = require('./claude-utils');
const { initializeChatGPT, sendMessageToChatGPT } = require('./chatgpt-utils');
const { delay } = require('./utils');
const util = require('util');

const CONFIG_FILE = 'config.yaml';
const AI_INSTRUCTIONS_FILE = 'ai_instructions.xml';

/**
 * Load and parse the configuration file.
 * @param {string} configPath - Path to the configuration file.
 * @returns {Promise<Object>} Parsed configuration object.
 * @throws {Error} If the config file fails to load or parse.
 */
async function loadConfig(configPath) {
  try {
    const configFile = await fs.readFile(configPath, 'utf8');
    const config = yaml.load(configFile);
    console.log('Config file loaded and parsed successfully');
    
    // Validate required fields
    const requiredFields = ['input.type', 'input.path', 'output.directory', 'ai_service.provider'];
    for (const field of requiredFields) {
      if (!getNestedValue(config, field)) {
        throw new Error(`Missing required configuration field: ${field}`);
      }
    }
    
    // Check if the Ghost URL has been updated
    if (config.ghost && config.ghost.url === "https://www.yourdomain.com") {
      console.error("Error: Please update the 'ghost.url' field in the config.yaml file with your actual Ghost blog URL.");
      process.exit(1);
    }

    // Check if the AI service API key has been updated
    const provider = config.ai_service.provider;
    if (config.ai_service[provider] && config.ai_service[provider].api_key === `your_${provider}_api_key_here`) {
      console.error(`Error: Please update the 'ai_service.${provider}.api_key' field in the config.yaml file with your actual ${provider.toUpperCase()} API key.`);
      process.exit(1);
    }
    
    // Set default values
    config.ai_service[provider] = config.ai_service[provider] || {};
    config.ai_service[provider].max_retries = config.ai_service[provider].max_retries || 5;
    config.ai_service[provider].initial_retry_delay = config.ai_service[provider].initial_retry_delay || 1000;
    config.process = config.process || {};
    config.process.posts_to_process = config.process.posts_to_process || 0;
    config.images = config.images || {};
    config.images.remove_failed = config.images.remove_failed !== false;
    
    return config;
  } catch (error) {
    console.error(`Failed to load config file: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Helper function to get nested object values.
 * @param {Object} obj - The object to search.
 * @param {string} path - The path to the nested value.
 * @returns {*} The value at the specified path.
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

/**
 * Load AI instructions from file.
 * @param {string} instructionsPath - Path to the instructions file.
 * @returns {Promise<string>} Instructions content.
 * @throws {Error} If the instructions file fails to load.
 */
async function loadAIInstructions(instructionsPath) {
  try {
    return await fs.readFile(instructionsPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to load AI instructions: ${error.message}`);
  }
}

/**
 * Parse the Ghost export JSON file.
 * @param {string} inputPath - Path to the Ghost export file.
 * @returns {Promise<Array>} Array of post objects.
 * @throws {Error} If the Ghost export file fails to parse.
 */
async function parseGhostExport(inputPath) {
  try {
    const ghostExport = JSON.parse(await fs.readFile(inputPath, 'utf8'));
    return ghostExport.db[0].data.posts;
  } catch (error) {
    throw new Error(`Failed to parse Ghost export: ${error.message}`);
  }
}

/**
 * Download an image from a URL and save it to the specified path.
 * @param {string} url - URL of the image to download.
 * @param {string} outputPath - Path to save the downloaded image.
 * @param {Object} config - Configuration object.
 * @returns {Promise<string>} The actual URL of the downloaded image.
 * @throws {Error} If the image download fails.
 */
async function downloadImage(url, outputPath, config) {
  try {
    const actualUrl = url.replace('__GHOST_URL__', config.ghost.url);
    const response = await axios.get(actualUrl, { responseType: 'arraybuffer' });
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, response.data);
    console.log(`Successfully downloaded image: ${actualUrl}`);
    return actualUrl;
  } catch (error) {
    console.warn(`Failed to download image: ${url}. Error: ${error.message}`);
    throw error;
  }
}

/**
 * Get image dimensions using sharp library.
 * @param {string} imagePath - Path to the image file.
 * @returns {Promise<{width: number, height: number}>} Object containing width and height of the image.
 */
async function getImageDimensions(imagePath) {
  const metadata = await sharp(imagePath).metadata();
  return { width: metadata.width, height: metadata.height };
}

/**
 * Process images in a post, downloading them and updating references.
 * @param {Object} post - Post object containing content and metadata.
 * @param {Object} config - Configuration object.
 * @returns {Promise<{processedContent: string, removedImages: string[]}>} Processed content with updated image references and list of removed images.
 */
async function processImages(post, config) {
  console.log(`Processing images for post: ${post.title}`);
  let processedContent = post.html;
  const imageRegex = /<img[^>]+src="([^">]+)"[^>]*alt="([^"]*)"[^>]*>/g;
  let match;
  let removedImages = [];
  let failedDownloads = [];
  let galleryImages = [];

  while ((match = imageRegex.exec(post.html)) !== null) {
    const [fullMatch, originalSrc, altText] = match;
    const fileName = path.basename(originalSrc);
    const newSrc = path.join(config.images.output_directory, post.slug, fileName);
    const relativeNewSrc = `/static/images/${post.slug}/${fileName}`;

    try {
      const actualUrl = await downloadImage(originalSrc, newSrc, config);
      
      // Get image dimensions
      const { width, height } = await getImageDimensions(newSrc);
      
      const newImageTag = `<Image alt="${altText}" src="${relativeNewSrc}" width={${width}} height={${height}} />`;
      processedContent = processedContent.replace(fullMatch, newImageTag);
      galleryImages.push(newImageTag);
      console.log(`Successfully processed image: ${actualUrl}`);
    } catch (error) {
      console.warn(`Failed to download or process image: ${originalSrc}. Error: ${error.message}`);
      failedDownloads.push(originalSrc);
      processedContent = processedContent.replace(fullMatch, config.images.placeholder);
      removedImages.push(originalSrc);
      console.log(`Replaced failed image with placeholder: ${originalSrc}`);
    }
  }

  // Create a single gallery section at the beginning of the content
  if (galleryImages.length > 1) {
    const galleryHtml = `
## Gallery

<div className="flex flex-wrap -mx-2 overflow-hidden xl:-mx-2">
  ${galleryImages.map(img => `
  <div className="my-1 px-2 w-full overflow-hidden xl:my-1 xl:px-2 xl:w-1/2">
    ${img}
  </div>`).join('\n')}
</div>
`;
    processedContent = galleryHtml + processedContent;
  }

  // Remove any existing gallery sections from the original content
  processedContent = processedContent.replace(/<h2>Gallery<\/h2>[\s\S]*?<\/div>\s*<\/div>/g, '');

  // Log removed and failed images
  if (removedImages.length > 0 || failedDownloads.length > 0) {
    const logMessage = `
Post: ${post.title}
Removed images: ${removedImages.length}
${removedImages.map(img => ` - ${img}`).join('\n')}
Failed downloads: ${failedDownloads.length}
${failedDownloads.map(img => ` - ${img}`).join('\n')}
`;
    await fs.appendFile('conversion.log', logMessage + '\n\n');
  }

  return { processedContent, removedImages };
}

/**
 * Save processed content as an MDX file.
 * @param {string} outputPath - Path to save the MDX file.
 * @param {string} content - Content to be saved.
 * @returns {Promise<void>}
 */
async function saveMdxFile(outputPath, content) {
  await fs.writeFile(outputPath, content, 'utf8');
  console.log(`Saved MDX file: ${outputPath}`);
}

/**
 * Renames downloaded images based on their alt text and updates MDX files.
 * @param {Object} config - Configuration object.
 * @returns {Promise<void>}
 */
async function renameDownloadedImages(config) {
  if (!config.images.rename_downloaded) {
    return;
  }

  console.log('Renaming downloaded images based on alt text...');

  const outputDir = config.output.directory;
  const mdxFiles = await fs.readdir(outputDir);

  for (const mdxFile of mdxFiles) {
    if (mdxFile.endsWith('.mdx')) {
      const mdxPath = path.join(outputDir, mdxFile);
      let mdxContent = await fs.readFile(mdxPath, 'utf-8');
      const slug = path.basename(mdxFile, '.mdx');
      const imageDir = path.join(config.images.output_directory, slug);

      const imageRegex = /<Image\s+src="(.+?)"\s+alt="(.+?)"\s*\/>/g;
      let match;

      while ((match = imageRegex.exec(mdxContent)) !== null) {
        const [fullMatch, oldSrc, altText] = match;
        const oldFileName = path.basename(oldSrc);
        const newFileName = altText.toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') + path.extname(oldSrc);

        if (oldFileName !== newFileName) {
          const oldFilePath = path.join(imageDir, oldFileName);
          const newFilePath = path.join(imageDir, newFileName);

          try {
            if (await fs.access(oldFilePath).then(() => true).catch(() => false)) {
              await fs.rename(oldFilePath, newFilePath);
              console.log(`Renamed: ${oldFileName} -> ${newFileName}`);

              mdxContent = mdxContent.replace(
                fullMatch,
                `<Image src="/static/images/${slug}/${newFileName}" alt="${altText}" />`
              );
            } else {
              console.warn(`File not found, skipping rename: ${oldFileName}`);
            }
          } catch (error) {
            console.error(`Error renaming ${oldFileName}: ${error.message}`);
          }
        }
      }

      await fs.writeFile(mdxPath, mdxContent, 'utf-8');
    }
  }

  console.log('Image renaming process completed.');
}

/**
 * Logs an error message to both console and log file.
 * @param {Object} config - The configuration object.
 * @param {string} message - The error message to log.
 * @param {Error} [error] - The error object, if available.
 */
async function logError(config, message, error = null) {
  console.error(message);
  if (error) {
    console.error(error);
  }
  await logToFile(config, `ERROR: ${message}`);
  if (error) {
    await logToFile(config, `Error details: ${error.message}`);
    if (error.response) {
      await logToFile(config, `API Response error: ${JSON.stringify(error.response.data)}`);
    }
  }
}

/**
 * Prepares post data for AI processing.
 * @param {Object} post - The post object.
 * @param {string} processedContent - The processed content of the post.
 * @param {Object} config - The configuration object.
 * @returns {Object} Prepared post data.
 */
function preparePostData(post, processedContent, config) {
  const canonicalUrl = new URL(post.url || `/${post.slug}/`, config.ghost.url).toString();
  
  // Replace __GHOST_URL__ in the content
  const contentWithReplacedUrl = processedContent.replace(/__GHOST_URL__/g, config.ghost.url);
  
  return {
    title: post.title,
    slug: post.slug,
    date: post.published_at,
    tags: post.tags ? post.tags.map(tag => tag.name) : [],
    content: contentWithReplacedUrl,
    feature_image: post.feature_image,
    authors: post.authors ? post.authors.map(author => author.name) : ['default'],
    draft: post.status !== 'published',
    excerpt: post.excerpt || '',
    canonicalUrl: canonicalUrl
  };
}

/**
 * Convert blog posts from Ghost export to MDX format.
 * @param {Object} config - Configuration object.
 * @param {string} aiInstructions - Instructions for AI service.
 * @returns {Promise<void>}
 */
async function convertBlogPosts(config, aiInstructions) {
  try {
    const posts = await parseGhostExport(config.input.path);
    const postsToProcess = config.process.posts_to_process === 0 ? posts.length : config.process.posts_to_process;
    console.log(`Found ${posts.length} posts. Processing ${postsToProcess} posts.`);

    let totalUsage = { input_tokens: 0, output_tokens: 0 };

    let aiService;
    let messages = [];
    if (config.ai_service.provider === 'claude') {
      aiService = await initializeClaude(config.ai_service.claude);
      messages.push({ role: 'user', content: aiInstructions });
    } else if (config.ai_service.provider === 'chatgpt') {
      aiService = await initializeChatGPT(config.ai_service.chatgpt);
    } else {
      throw new Error('Invalid AI service provider specified in config');
    }

    console.log('AI service initialized');

    // Send AI instructions
    let instructionsUsage;
    if (config.ai_service.provider === 'claude') {
      ({ mdxContent: _, usage: instructionsUsage } = await sendMessageToClaude(aiService, messages));
      messages.push({ role: 'assistant', content: 'Instructions received and understood.' });
    } else {
      ({ mdxContent: _, usage: instructionsUsage } = await sendMessageToChatGPT(aiService, aiInstructions));
    }
    console.log('AI instructions sent');
    totalUsage.input_tokens += instructionsUsage.input_tokens;
    totalUsage.output_tokens += instructionsUsage.output_tokens;

    // Process the specified number of posts
    for (let i = 0; i < Math.min(postsToProcess, posts.length); i++) {
      const post = posts[i];
      
      try {
        logWithFlush(`\nProcessing post ${i + 1} of ${postsToProcess}: ${post.title}`);
        
        const outputPath = path.join(config.output.directory, `${post.slug}.mdx`);

        // Check if the MDX file already exists and is not empty
        try {
          const stats = await fs.stat(outputPath);
          if (stats.size > 0) {
            console.log(`Skipping post "${post.title}" as MDX file already exists.`);
            await logToFile(config, `Skipped post: ${post.title}`);
            continue;
          }
        } catch (err) {
          // File doesn't exist, proceed with processing
        }

        await fs.mkdir(config.output.directory, { recursive: true });

        logWithFlush('Processing images...');
        const { processedContent } = await processImages(post, config);
        logWithFlush('Images processed');

        const preparedPostData = preparePostData(post, processedContent, config);

        logWithFlush('Sending content to AI service...');
        let mdxContent, usage;
        if (config.ai_service.provider === 'claude') {
          messages.push({ role: 'user', content: JSON.stringify(preparedPostData) });
          ({ mdxContent, usage } = await sendMessageToClaude(aiService, messages));
          messages.push({ role: 'assistant', content: mdxContent });
        } else {
          ({ mdxContent, usage } = await sendMessageToChatGPT(aiService, JSON.stringify(preparedPostData)));
        }
        logWithFlush('Content processed by AI service');
        logWithFlush('Usage for this post: ' + util.inspect(usage));

        totalUsage.input_tokens += usage.input_tokens;
        totalUsage.output_tokens += usage.output_tokens;
        console.log('Running total usage:', totalUsage);

        // Check if frontmatter already exists
        if (!mdxContent.startsWith('---')) {
          console.warn(`Frontmatter missing for post "${post.title}". AI service should have included it.`);
        }

        await saveMdxFile(outputPath, mdxContent);

        logWithFlush(`Completed processing: ${post.title}`);
        await logToFile(config, `Successfully processed post: ${post.title}`);
      } catch (error) {
        logWithFlush(`Error processing post "${post.title}": ${error.message}`);
        await logToFile(config, `Error processing post "${post.title}": ${error.message}`);
      }

      // Add a delay between posts to avoid rate limiting
      if (i < Math.min(postsToProcess - 1, posts.length - 1)) {
        await delay(config.process.rate_limit_delay);
      }
    }

    // After all posts have been processed, rename the images if configured
    await renameDownloadedImages(config);

    console.log(`\nConversion of ${postsToProcess} posts completed.`);
    console.log('Final total usage:', totalUsage);
    await logToFile(config, `Conversion completed. Total posts processed: ${postsToProcess}`);
    await logToFile(config, `Final total usage: ${JSON.stringify(totalUsage)}`);
  } catch (error) {
    await logError(config, 'Conversion failed:', error);
  }
}

/**
 * Log a message to the configured log file.
 * @param {Object} config - Configuration object.
 * @param {string} message - Message to log.
 * @returns {Promise<void>}
 */
async function logToFile(config, message) {
  if (config.logging && config.logging.file) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp}: ${message}\n`;
    await fs.appendFile(config.logging.file, logMessage);
  }
}

/**
 * Main conversion function to be called from CLI.
 * @param {Object} argv - Command line arguments.
 * @returns {Promise<void>}
 */
async function convert(argv) {
  try {
    const configPath = argv.config || path.join(__dirname, CONFIG_FILE);
    const config = await loadConfig(configPath);

    if (argv.input) {
      config.input.path = argv.input;
    }
    if (argv.output) {
      config.output.directory = argv.output;
    }

    const instructionsPath = path.join(__dirname, AI_INSTRUCTIONS_FILE);
    const aiInstructions = await loadAIInstructions(instructionsPath);

    await convertBlogPosts(config, aiInstructions);
  } catch (error) {
    await logError(config, 'Error during conversion:', error);
    process.exit(1);
  }
}

function logWithFlush(message) {
  console.log(message);
  if (process.stdout.isTTY) {
    process.stdout.write('');
  }
}

module.exports = { convert };

if (require.main === module) {
  console.log('Starting conversion process...');
  convert(process.argv.slice(2))
    .then(() => console.log('Conversion process completed.'))
    .catch(error => {
      console.error('Error during conversion:', error);
      process.exit(1);
    });
}