#!/usr/bin/env node
const yargs = require('yargs');
const converter = require('./ghost-to-nextjs-converter');
const package = require('./package.json');

yargs
  .command('convert', 'Convert blog content', (yargs) => {
    return yargs
      .option('config', {
        alias: 'c',
        describe: 'Path to config file',
        default: './config.yaml'
      })
      .option('input', {
        alias: 'i',
        describe: 'Input file path'
      })
      .option('output', {
        alias: 'o',
        describe: 'Output directory'
      });
  }, (argv) => {
    converter.convert(argv);
  })
  .version(package.version)
  .help()
  .argv;