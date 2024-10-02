# Ghost to Next.js Blog Converter

This tool converts a Ghost blog export to a format compatible with Next.js blogs, particularly those using the [Tailwind Nextjs Starter Blog](https://github.com/timlrx/tailwind-nextjs-starter-blog) template. It leverages either the Claude AI or ChatGPT API for content processing and formatting.

## Features

- Converts Ghost blog posts to MDX files
- Downloads and processes images, saving them to ./public/static/images/**post-slug**/
- Generates frontmatter compatible with the [Tailwind Nextjs Starter Blog](https://github.com/timlrx/tailwind-nextjs-starter-blog)
- Uses either Claude AI or ChatGPT for intelligent content processing and formatting
- Handles code block language detection using the [refractor supported syntaxes](https://github.com/wooorm/refractor#syntaxes)
- Converts image tags to Next.js Image components
- Automatically detects and includes image dimensions for Next.js Image components
- Configurable AI Instructions in XML format, which you can tailor to your needs.
- Generates canonical URLs for each post
- Supports customizable image extensions for processing
- Implements rate limiting for API calls to AI services and backs off if the limits are hit
- Provides options for handling missing post images (remove from post or replace with a placeholder)
- Skips already processed posts to avoid duplicate work
- Optionally renames downloaded images based on alt text

## AI Notes

  - For Claude AI, it uses the Messages API. It sends the XML instructions as the first message, and then each post as a subsequent message in the same conversation.
  - For ChatGPT, it uses the Assistant API. It creates a new assistant with the XML instructions, and then processes each post in a separate thread.
  - In my testing, I found that Claude performed better and was more reliable. ChatGPT didn't always follow the instructions and would not detect image gallaries nearly as reliably, inserting them where they shouldn't be. Feel free to tweak the ai_instructions.xml file to better fit your blog's needs.

## Prerequisites

- Node.js (version 14 or higher)
- npm (comes with Node.js)
- Claude AI or ChatGPT API key

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/aiconsultancy/ghost-to-nextjs-blog-converter.git
   ```
2. Navigate to the project directory:
   ```
   cd ghost-to-nextjs-blog-converter
   ```
3. Install the dependencies:
   ```
   npm install
   ```

## Configuration

Before running the converter, set up the `config.yaml` file. Here's an example configuration:

```yaml
# Ghost to Next.js Blog Converter Configuration

# Input configuration
input:
  # Type of input (currently only supports 'ghost')
  type: ghost
  # Path to the Ghost export JSON file
  path: ./ghost-export.json

# Output configuration
output:
  # Directory where converted MDX files will be saved
  directory: "./data/blog"

# Ghost-specific configuration
ghost:
  # Base URL of the original Ghost blog
  url: "https://www.yourdomain.com"
  # Whether to include '/blog/' prefix in canonical URLs
  include_blog_prefix: false

# Image handling configuration
images:
  # Directory where downloaded images will be saved
  output_directory: "./public/static/images"
  # List of image file extensions to process
  extensions:
    - ".jpg"
    - ".jpeg"
    - ".png"
    - ".gif"
    - ".svg"
  remove_failed: true  # Whether to remove failed image downloads from content
  rename_downloaded: true  # Whether to rename downloaded images to match the alt text set by Claude

# AI service configuration
ai_service:
  provider: "chatgpt"  # Options: "claude" or "chatgpt"
  claude:
    api_key: "your_claude_api_key_here"
    model: "claude-3-5-sonnet-20240620"
    max_tokens: 5000
    max_retries: 5
    initial_retry_delay: 1000  # in milliseconds
  chatgpt:
    api_key: "your_chatgpt_api_key_here"
    model: "gpt-4o"
    max_retries: 5
    initial_retry_delay: 1000  # in milliseconds

# Conversion process configuration
process:
  posts_to_process: 0  # Set to 0 to process all posts, or specify a number to limit the posts processed
  rate_limit_delay: 2000

# Logging configuration
logging:
  # Logging level (e.g., 'info', 'warn', 'error')
  level: info
  # Path to the log file
  file: conversion.log
```

Before running the converter, set up the `config.yaml` file. Adjust the settings according to your needs:
- Set `ghost.url` to match your Ghost blog's URL.
- Specify the `input.path` to your Ghost export JSON file.
- Choose the `output.directory` where you want the converted files to be saved.
- Set `images.output_directory` to `./public/static/images`
- Choose the `ai_service.provider` (either "claude" or "chatgpt") and provide the corresponding API key.
- Replace `your_api_key_here` with your actual Claude AI API key or `your_chatgpt_api_key_here` with your actual ChatGPT API key (depending on which AI service you are using).
- Adjust the `process.rate_limit_delay` if needed to comply with API rate limits.
- Modify the `images.extensions` list if you need to handle additional image types.

## Usage

1. Export your Ghost blog content:
   - Go to your Ghost admin panel
   - Navigate to Labs (Settings > Labs)
   - Click on "Export your content" to download the JSON file

2. Place the exported JSON file in the same directory as the `ghost-to-nextjs-converter.js` script and update the `input.path` in `config.yaml` accordingly.

3. Install dependencies (if you haven't already):
   ```
   npm install
   ```

4. Run the converter:
   ```
   npm run convert
   ```

5. The converted MDX files and images will be saved in the specified output directory.

## Output Structure

The converter will create MDX files in the output directory and save images in the public/static/images directory:

- MDX files: `./data/blog/<post-slug>.mdx`
- Images: `./public/static/images/<post-slug>/<filename>.<ext>`

The frontmatter structure will be compatible with the [Tailwind Nextjs Starter Blog](https://github.com/timlrx/tailwind-nextjs-starter-blog), including fields such as title, date, tags, draft status, summary, and image references.

1. For a post without a featured image:

```yaml
---
title: "Example Post"
date: "2024-02-20"
tags: ["example", "post"]
draft: false
summary: "This is a summary of the post."
images: []
canonicalUrl: "https://example.com/example-post"
---
```

2. For a post with a featured image:

```yaml
---
title: "Example Post with Banner"
date: "2024-02-21"
tags: ["example", "featured"]
draft: false
summary: "This is a summary of the post with a banner image."
images: ["/static/images/example-post-with-banner/featured-image.jpg"]
canonicalUrl: "https://example.com/example-post-with-banner"
layout: "PostBanner"
---
```

Note the following details:
- The `images` field is always an array, even if there's only one image or no images.
- If a post has a feature image (from Ghost), the `layout` will be set to 'PostBanner' and the feature image will be the first in the `images` array.
- The [Tailwind Nextjs Starter Blog](https://github.com/timlrx/tailwind-nextjs-starter-blog) uses the first image in the `images` array as the banner image when the layout is set to 'PostBanner'.
- If a post doesn't have a feature image, the `layout` will be set to 'PostLayout'.
- All string values in the frontmatter are quoted to ensure compatibility with YAML parsing.

## Troubleshooting

- If you encounter any issues with image downloads, check the `ghost.url` in the config file is correct, as the script uses this in replacement of \_\_GHOST_URL\_\_ which is exported from Ghost.
- Make sure you have write permissions for the output directory specified in the config file.
- Check the `conversion.log` file for detailed information about the conversion process and any errors encountered.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is open source and available under the [MIT License](LICENSE).