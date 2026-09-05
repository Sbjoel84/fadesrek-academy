'use strict';

// The one place that decides the shape of what the frontend receives —
// every path through the gateway (answered, denied, clarifying question,
// error) ends up here so the client only has to handle one response shape.

function formatAnswer({ conversationId, messageId, reply, intent, data, document }) {
  return { conversationId, messageId, reply, intent: intent || null, data: data || null, document: document || null, denied: false };
}

function formatDenied({ conversationId, messageId, reply, intent }) {
  return { conversationId, messageId, reply, intent: intent || null, data: null, document: null, denied: true };
}

function formatClarification({ conversationId, messageId, reply }) {
  return { conversationId, messageId, reply, intent: null, data: null, document: null, denied: false };
}

module.exports = { formatAnswer, formatDenied, formatClarification };
