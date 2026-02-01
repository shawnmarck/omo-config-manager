/**
 * Claude Code wrapper for OMO configuration management
 * This file provides a Node.js script interface for Claude Code plugins
 */
import { parseAction, executeAction } from './core.js';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Main entry point for Claude Code plugin execution
 * Reads request from command line arguments or stdin
 */
async function main() {
  // Try to read from command line args first
  let request = process.argv.slice(2).join(' ');
  
  // If no args, try reading from stdin (for Claude Code integration)
  if (!request && !process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    request = Buffer.concat(chunks).toString('utf-8').trim();
  }
  
  if (!request) {
    console.error('Usage: node claude-code-wrapper.js <request>');
    console.error('Or pipe request via stdin');
    process.exit(1);
  }
  
  try {
    const action = parseAction(request);
    const result = await executeAction(action, request);
    console.log(result);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Run if called directly
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const invokedUrl = invokedPath ? String(pathToFileURL(invokedPath)) : '';
if (invokedUrl && import.meta.url === invokedUrl) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { parseAction, executeAction };
