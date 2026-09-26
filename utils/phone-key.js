/**
 * Chave única de telefone para comparar o mesmo número em qualquer formato.
 *
 * Sem o DDI 55 e com celular sempre com o 9: o WhatsApp guarda muitos números
 * antigos sem o 9 (556194009494) e o Google Maps mostra com (61 99400-9494).
 * Os dois viram "61994009494". Fixo (começa com 2–5) fica como está.
 */
function phoneCore(phone) {
  let digits = String(phone || "").replace(/@.*$/, "").replace(/:\d+$/, "").replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.length === 10 && /[6-9]/.test(digits[2])) digits = `${digits.slice(0, 2)}9${digits.slice(2)}`;
  return digits;
}

/**
 * Refaz as chaves de um mapa telefone→valor com a regra atual. Se duas
 * chaves antigas viram a mesma, `merge(atual, outro)` decide o que fica.
 * Devolve { map, changed }.
 */
function rekeyPhoneMap(map, merge = (a) => a) {
  const out = {};
  let changed = false;
  for (const [key, value] of Object.entries(map || {})) {
    const next = phoneCore(key) || key;
    if (next !== key) changed = true;
    if (out[next] === undefined) out[next] = value;
    else {
      out[next] = merge(out[next], value);
      changed = true;
    }
  }
  return { map: out, changed };
}

module.exports = { phoneCore, rekeyPhoneMap };
