'use strict';

const Anthropic = require('@anthropic-ai/sdk');

// Provider-agnostic on purpose: gateway.js only calls `converse(...)` below.
// Swapping to another provider later means rewriting this one file, not the
// prompt engine, intents, or gateway.
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

/**
 * @param {string} system
 * @param {Array} messages  Anthropic-format message list
 * @param {Array} tools     Anthropic tool definitions
 */
async function converse(system, messages, tools) {
  return client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages,
    tools,
  });
}

module.exports = { converse };
