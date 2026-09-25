/**
 * Cifra segredos em disco (API keys) com o safeStorage do Electron, que no
 * Windows usa o DPAPI: o arquivo copiado para outra conta ou outro PC não
 * revela a chave. Valores antigos em texto puro continuam sendo lidos e são
 * cifrados na próxima gravação.
 */
const PREFIX = "enc:v1:";

function createSecretBox(safeStorage) {
  const available = () => {
    try {
      return !!safeStorage?.isEncryptionAvailable?.();
    } catch {
      return false;
    }
  };
  return {
    seal(value) {
      const plain = String(value || "");
      if (!plain || plain.startsWith(PREFIX) || !available()) return plain;
      return PREFIX + safeStorage.encryptString(plain).toString("base64");
    },
    open(value) {
      const stored = String(value || "");
      if (!stored.startsWith(PREFIX)) return stored;
      try {
        return safeStorage.decryptString(Buffer.from(stored.slice(PREFIX.length), "base64"));
      } catch {
        // Perfil movido para outro usuário/PC: a chave precisa ser informada de novo.
        return "";
      }
    },
  };
}

/** Sem safeStorage (testes, scripts): grava como está. */
const PLAIN_BOX = { seal: (v) => String(v || ""), open: (v) => String(v || "") };

module.exports = { createSecretBox, PLAIN_BOX, SECRET_PREFIX: PREFIX };
