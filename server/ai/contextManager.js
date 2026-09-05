'use strict';

const prisma = require('../db/prisma');

const HISTORY_LIMIT = 20;

/** Finds or creates the conversation this turn belongs to. A conversation
 * always belongs to exactly one user — no cross-user handoff — matching the
 * app's "one signed-in persona per session" model. */
async function resolveConversation(session, conversationId) {
  if (conversationId) {
    const existing = await prisma.aiConversation.findUnique({ where: { id: conversationId } });
    if (existing && existing.userId === session.userId) return existing;
  }
  return prisma.aiConversation.create({
    data: { userId: session.userId, roleKey: session.roleKey },
  });
}

/** Loads recent turns as plain text exchanges for Claude's message list.
 * Deliberately simplified: prior tool_use/tool_result blocks are not
 * replayed, just the human-readable question/answer text — enough for
 * natural multi-turn follow-ups ("what about last term?") without the
 * complexity of reconstructing tool-call transcripts across turns. */
async function loadHistory(conversationId) {
  const rows = await prisma.aiMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: HISTORY_LIMIT,
  });
  return rows.map(r => ({ role: r.role === 'USER' ? 'user' : 'assistant', content: r.content }));
}

async function appendMessage(conversationId, { role, content, intent, params, resultSummary }) {
  const [message] = await prisma.$transaction([
    prisma.aiMessage.create({
      data: { conversationId, role, content, intent: intent || null, params: params || undefined, resultSummary: resultSummary || undefined },
    }),
    prisma.aiConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } }),
  ]);
  return message;
}

module.exports = { resolveConversation, loadHistory, appendMessage };
