export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
  abstract?: string;
  source: string;
}

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
}

export interface SearchConfig {
  enabled: boolean;
  provider: 'duckduckgo' | 'custom';
  customApiUrl: string;
  customApiKey: string;
}
