'use strict';

const intents = require('./intents');
const { can } = require('../rbac/permissionEngine');

/** Only the tools the signed-in role can actually use are ever sent to
 * Claude. This is defense-in-depth, not the enforcement point — gateway.js
 * still calls assertPermission server-side before every Prisma call — but
 * it means Claude structurally can't reach for a tool the role doesn't
 * have, and it keeps the prompt smaller. */
function buildTools(session) {
  return Object.entries(intents)
    .filter(([, intent]) => can(session, intent.requiredPermission))
    .map(([name, intent]) => ({
      name,
      description: intent.description,
      input_schema: intent.inputSchema,
    }));
}

function buildSystemPrompt(session) {
  return [
    'You are the AI assistant embedded in Fadesrek Academy\'s school management system.',
    `You are answering questions for a signed-in user with the role "${session.roleKey}".`,
    'You can only see what the tools available to you return — never state a number, name, or fact you were not given by a tool result.',
    'Call at most one tool per user message. Choose the single tool that best matches the question.',
    'If none of your available tools can answer the question, say plainly that you don\'t have access to that information for this role — do not guess or apologise at length.',
    'If the question is ambiguous, ask one short clarifying question instead of guessing.',
    'After a tool result comes back, answer in plain, concise natural language — a sentence or two, plus key figures. Do not dump raw JSON at the user.',
    'Amounts are in Nigerian naira (₦). Today\'s date context is provided by the tool results themselves, not by you.',
  ].join(' ');
}

module.exports = { buildTools, buildSystemPrompt };
