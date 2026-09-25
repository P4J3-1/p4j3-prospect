// Importado antes de App para que nenhum módulo leia `sigma_leads` do localStorage cru.
import { installLeadStorage } from './leadStorage.mjs';

try {
  installLeadStorage();
} catch (error) {
  console.warn('[LEADS-STORE] install:', error?.message || error);
}
