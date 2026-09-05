'use strict';

const express = require('express');
const { requireSession } = require('../auth/session');
const { resolveScope, assertPermission, PermissionError } = require('../rbac/permissionEngine');
const intents = require('./intents');
const { buildTools, buildSystemPrompt } = require('./promptEngine');
const { converse } = require('./llmClient');
const { resolveConversation, loadHistory, appendMessage } = require('./contextManager');
const { generateDocument } = require('./documentGenerator');
const { formatAnswer, formatDenied, formatClarification } = require('./responseFormatter');
const { writeAuditEntry } = require('../audit/auditLog');
const { notifyRole } = require('../notifications/notify');
const prisma = require('../db/prisma');

const router = express.Router();

function extractText(content) {
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();
}

/** A short, human-scannable line for AuditLog — top-level scalar fields
 * only (counts, totals, dates), never the row-level lists (names, admission
 * numbers) an intent result also carries. Those live on AiMessage instead,
 * which is access-controlled the same way the rest of the app is, not
 * treated as a permanent security-audit trail. */
function summarizeForAudit(data) {
  if (!data || typeof data !== 'object') return '';
  return Object.entries(data)
    .filter(([, v]) => typeof v !== 'object' || v === null)
    .slice(0, 6)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

router.post('/query', requireSession, async (req, res, next) => {
  const { session } = req;
  const { conversationId, message } = req.body || {};

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message_required' });
  }

  try {
    const conversation = await resolveConversation(session, conversationId);
    const history = await loadHistory(conversation.id);
    const scope = await resolveScope(session);
    const tools = buildTools(session);
    const system = buildSystemPrompt(session);

    await appendMessage(conversation.id, { role: 'USER', content: message });

    const messages = [...history, { role: 'user', content: message }];
    const first = await converse(system, messages, tools);

    const toolUse = first.content.find(block => block.type === 'tool_use');

    if (!toolUse) {
      const reply = extractText(first.content) || "I'm not sure how to help with that.";
      const assistantMessage = await appendMessage(conversation.id, { role: 'ASSISTANT', content: reply });
      return res.json(formatClarification({ conversationId: conversation.id, messageId: assistantMessage.id, reply }));
    }

    const intentName = toolUse.name;
    const intent = intents[intentName];
    const params = toolUse.input || {};

    let data = null;
    let deniedReason = null;
    try {
      if (!intent) throw new PermissionError(intentName);
      assertPermission(session, intent.requiredPermission);
      data = await intent.run(session, scope, params);
    } catch (err) {
      if (err instanceof PermissionError) {
        deniedReason = err.permission;
      } else {
        throw err;
      }
    }

    const toolResultContent = deniedReason
      ? JSON.stringify({ error: 'permission_denied', message: `This role does not have the "${deniedReason}" permission required for that.` })
      : JSON.stringify(data);

    const followUp = await converse(system, [
      ...messages,
      { role: 'assistant', content: first.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: toolResultContent }] },
    ], tools);

    const reply = extractText(followUp.content) || (deniedReason ? "I don't have access to that for your role." : 'Here is what I found.');

    await writeAuditEntry({
      session,
      action: deniedReason ? 'ai.query.denied' : 'ai.query',
      detail: { question: message.slice(0, 200), intent: intentName, params, ...(deniedReason ? { deniedPermission: deniedReason } : { result: summarizeForAudit(data) }) },
    });

    const assistantMessage = await appendMessage(conversation.id, {
      role: 'ASSISTANT',
      content: reply,
      intent: intentName,
      params,
      resultSummary: deniedReason ? null : data,
    });

    if (!deniedReason && data?.recommendations?.length) {
      await notifyRole({
        roleKey: session.roleKey,
        title: `AI Assistant: ${intentName.replace(/_/g, ' ')}`,
        body: data.recommendations.join(' '),
        createdById: session.userId,
      });
    }

    if (deniedReason) {
      return res.json(formatDenied({ conversationId: conversation.id, messageId: assistantMessage.id, reply, intent: intentName }));
    }

    const document = generateDocument(intentName, data);
    return res.json(formatAnswer({ conversationId: conversation.id, messageId: assistantMessage.id, reply, intent: intentName, data, document }));
  } catch (err) {
    next(err);
  }
});

/** The feedback loop: thumbs up/down on a past assistant turn. Capture
 * only — no retraining pipeline exists in this pass, but the data is now
 * there for one to read from later. */
router.post('/feedback', requireSession, async (req, res, next) => {
  try {
    const { messageId, feedback } = req.body || {};
    if (!messageId || !['UP', 'DOWN'].includes(feedback)) {
      return res.status(400).json({ error: 'invalid_feedback' });
    }
    const message = await prisma.aiMessage.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    });
    if (!message || message.conversation.userId !== req.session.userId) {
      return res.status(404).json({ error: 'not_found' });
    }
    await prisma.aiMessage.update({ where: { id: messageId }, data: { feedback } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
