// Provedores de IA compatíveis com a API da OpenAI. Fonte única para a tela
// Inteligência Artificial e o Lead Scoring.
export const PROVIDERS = {
  openrouter: {
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/free',
    models: [
      'openrouter/free',
      'openai/gpt-4o-mini',
      'anthropic/claude-3.5-sonnet',
      'google/gemini-2.0-flash-001',
    ]
  },
  nvidia: {
    name: 'NVIDIA Build',
    base: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'deepseek-ai/deepseek-v4-flash',
    models: [
      'deepseek-ai/deepseek-v4-flash',
      'meta/llama-3.3-70b-instruct',
      'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    ]
  },
  deepseek: {
    name: 'DeepSeek',
    base: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner']
  },
  opencode: {
    name: 'OpenCode',
    base: 'https://opencode.ai/zen/v1',
    defaultModel: 'glm-5.3-flash',
    models: ['glm-5.3-flash', 'deepseek-v4-flash', 'minimax-m3', 'muse-spark-1.3']
  },
  custom: { name: 'Custom API', base: '', defaultModel: 'gpt-4.1-mini', models: [] }
};
