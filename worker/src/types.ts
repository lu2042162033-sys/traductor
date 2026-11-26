export type TargetLanguage = "zh" | "en" | "es";

export interface TranslationContextItem {
  sourceText: string;
  translatedText: string;
}

export interface Env {
  DEEPSEEK_API_KEY: string;
  QUOTA: DurableObjectNamespace;
  ALLOWED_ORIGINS: string;
  DAILY_GLOBAL_LIMIT?: string;
  DAILY_IP_LIMIT?: string;
  MAX_CONCURRENT_PER_IP?: string;
}

export interface QuotaClaim {
  ip: string;
  dailyGlobalLimit: number;
  dailyIpLimit: number;
  maxConcurrentPerIp: number;
}

export interface DeepSeekAsrResponse {
  request_id: string;
  text: string;
  duration_ms: number;
}
