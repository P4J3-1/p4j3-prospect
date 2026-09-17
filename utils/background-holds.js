/**
 * Decide se o app deve segurar o sistema acordado para trabalhar em
 * segundo plano (campanhas disparando ou extração rodando). Puro e
 * testável: o Electron só entra via powerSaveBlocker no main.js.
 */
function shouldPreventSuspension({ campaigns = [], activeScrapes = 0 } = {}) {
  if (Number(activeScrapes) > 0) return true;
  const list = Array.isArray(campaigns) ? campaigns : [];
  return list.some((campaign) => campaign && (campaign.status === "running" || campaign.status === "scheduled"));
}

module.exports = { shouldPreventSuspension };
