
export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  category: NewsCategory;
  timestamp: string;
  sources: { title: string; uri: string }[];
}

export enum NewsCategory {
  GENERAL = '综合',
  TECHNOLOGY = '科技',
  BUSINESS = '财经',
  SCIENCE = '科学',
  HEALTH = '健康',
  ENTERTAINMENT = '娱乐',
  SPORTS = '体育'
}

export enum NewsNetwork {
  ABC = 'ABC News',
  CBS = 'CBS News',
  NBC = 'NBC News Now',
  SKY = 'Sky News',
  REUTERS = 'Reuters',
  GLOBAL_AI = 'AI 综合电台'
}

// 对应各频道的官方公开 YouTube 直播 ID (这些是长期有效的官方信号)
export const NetworkStreamMap: Record<string, string> = {
  [NewsNetwork.ABC]: 'gCNeDWCI0vo',
  [NewsNetwork.CBS]: 'fSAt4m9S_A4',
  [NewsNetwork.NBC]: 'unWpYvAis60',
  [NewsNetwork.SKY]: '9Auq9mYqrEE',
  [NewsNetwork.REUTERS]: 'M900sR6_I0k'
};

export interface PlayerState {
  isPlaying: boolean;
  isLoading: boolean;
  currentNewsId: string | null;
  volume: number;
}

export enum VoiceName {
  ZEPHYR = 'Zephyr (中性)',
  KORE = 'Kore (沉稳)',
  PUCK = 'Puck (欢快)',
  CHARON = 'Charon (深沉)',
  FENRIR = 'Fenrir (浑厚)'
}

export const VoiceMap: Record<string, string> = {
  'Zephyr (中性)': 'Zephyr',
  'Kore (沉稳)': 'Kore',
  'Puck (欢快)': 'Puck',
  'Charon (深沉)': 'Charon',
  'Fenrir (浑厚)': 'Fenrir'
};
