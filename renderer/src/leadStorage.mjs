// A base de leads (`sigma_leads`) mora em arquivo no processo principal, não no
// localStorage: o teto de ~5–10 MB por origem estourava com alguns milhares de
// leads. Interceptamos só essa chave para que as leituras/escritas síncronas
// espalhadas pelos componentes (localStorage.getItem/setItem) continuem iguais.
export const LEADS_KEY = 'sigma_leads';

export function installLeadStorage({
  api = globalThis.window?.electronAPI?.leadsStore,
  storage = globalThis.localStorage,
  StorageProto = globalThis.Storage?.prototype,
} = {}) {
  if (!api || !storage || !StorageProto) return false;

  const { getItem, setItem, removeItem, clear } = StorageProto;
  const loaded = api.load();
  if (!loaded?.success) {
    console.warn('[LEADS-STORE] load:', loaded?.error || 'falha desconhecida');
    return false;
  }

  let cache = loaded.value;
  if (cache === null) {
    // Primeira execução com arquivo: migra o valor antigo. A cópia no
    // localStorage só é apagada na próxima abertura, quando o arquivo já existe,
    // para não perder dados se o app fechar antes da gravação.
    const legacy = getItem.call(storage, LEADS_KEY);
    if (legacy !== null) {
      cache = legacy;
      api.save(legacy);
    }
  } else {
    removeItem.call(storage, LEADS_KEY);
  }

  const isLeads = (target, key) => target === storage && String(key) === LEADS_KEY;
  StorageProto.getItem = function patchedGetItem(key) {
    return isLeads(this, key) ? cache : getItem.call(this, key);
  };
  StorageProto.setItem = function patchedSetItem(key, value) {
    if (!isLeads(this, key)) return setItem.call(this, key, value);
    cache = String(value);
    api.save(cache);
  };
  StorageProto.removeItem = function patchedRemoveItem(key) {
    if (!isLeads(this, key)) return removeItem.call(this, key);
    cache = null;
    api.save(null);
    removeItem.call(this, key);
  };
  StorageProto.clear = function patchedClear() {
    if (this === storage) {
      cache = null;
      api.save(null);
    }
    return clear.call(this);
  };
  return true;
}
