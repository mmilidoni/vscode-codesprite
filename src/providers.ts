import type { ProviderId, ProviderSpec } from './types';

export type { ProviderId, ProviderSpec };

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    defaultBaseUrl: 'https://opencode.ai/zen/v1',
    defaultModel: 'minimax-m2.7',
    contextWindow: 128_000,
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-3-5-sonnet-20241022',
    contextWindow: 200_000,
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    protocol: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-1.5-pro',
    contextWindow: 2_000_000,
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'codestral-latest',
    contextWindow: 32_000,
  },
  xai: {
    id: 'xai',
    label: 'xAI (Grok)',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-2-mini',
    contextWindow: 131_072,
  },
  custom: {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    contextWindow: 128_000,
  },
};

export function getProviderSpec(id: ProviderId): ProviderSpec {
  return PROVIDERS[id] ?? PROVIDERS.custom;
}
