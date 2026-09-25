/**
 * Aprendizado a partir das campanhas já disparadas: o que teve resposta, o que
 * não teve, horários e nichos que mais respondem. Alimenta a IA para que as
 * próximas mensagens e análises melhorem com o uso (auto-aperfeiçoamento).
 */
const MIN_SAMPLE = 5;

function pct(part, whole) {
  return whole ? Math.round((part / whole) * 1000) / 10 : 0;
}

function computeInsights(campaigns = [], { sampleSize = 6 } = {}) {
  const sentLeads = [];
  for (const campaign of campaigns) {
    for (const lead of campaign?.leads || []) {
      if (lead?.isGroup || !lead?.sentAt || lead.status === 'failed') continue;
      sentLeads.push(lead);
    }
  }
  const replied = sentLeads.filter((l) => l.repliedAt && !l.optedOut);
  const optedOut = sentLeads.filter((l) => l.optedOut);
  const followUps = sentLeads.filter((l) => l.followUpSentAt);
  const followUpReplies = followUps.filter((l) => l.repliedAt && l.repliedAt > l.followUpSentAt);

  const byRecent = (a, b) => (b.sentAt || 0) - (a.sentAt || 0);
  const texts = (list) => [...new Set(list.sort(byRecent).map((l) => l.sentText).filter(Boolean))].slice(0, sampleSize);

  const hours = Array.from({ length: 24 }, () => ({ sent: 0, replied: 0 }));
  const categories = new Map();
  for (const lead of sentLeads) {
    const hour = new Date(lead.sentAt).getHours();
    hours[hour].sent += 1;
    if (lead.repliedAt) hours[hour].replied += 1;
    const category = String(lead.category || 'sem categoria').trim().toLowerCase();
    const row = categories.get(category) || { category, sent: 0, replied: 0 };
    row.sent += 1;
    if (lead.repliedAt && !lead.optedOut) row.replied += 1;
    categories.set(category, row);
  }

  const bestHours = hours
    .map((row, hour) => ({ hour, ...row, replyRate: pct(row.replied, row.sent) }))
    .filter((row) => row.sent >= MIN_SAMPLE)
    .sort((a, b) => b.replyRate - a.replyRate)
    .slice(0, 3);
  const bestCategories = [...categories.values()]
    .filter((row) => row.sent >= MIN_SAMPLE)
    .map((row) => ({ ...row, replyRate: pct(row.replied, row.sent) }))
    .sort((a, b) => b.replyRate - a.replyRate)
    .slice(0, 5);

  return {
    sent: sentLeads.length,
    replied: replied.length,
    replyRate: pct(replied.length, sentLeads.length),
    optOutRate: pct(optedOut.length, sentLeads.length),
    followUpsSent: followUps.length,
    followUpReplyRate: pct(followUpReplies.length, followUps.length),
    repliedMessages: texts(replied),
    ignoredMessages: texts(sentLeads.filter((l) => !l.repliedAt)),
    bestHours,
    bestCategories,
    enoughData: sentLeads.length >= 20,
  };
}

module.exports = { computeInsights };
