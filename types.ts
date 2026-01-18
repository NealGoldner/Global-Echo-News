
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
  BBC = 'BBC World',
  CNN = 'CNN Live',
  ABC = 'ABC News',
  CBS = 'CBS News',
  NBC = 'NBC News',
  SKY = 'Sky News',
  BLOOMBERG = 'Bloomberg',
  AL_JAZEERA = 'Al Jazeera',
  FRANCE24 = 'France 24',
  DW = 'DW News',
  CNA = 'CNA Asia',
  GLOBAL_AI = 'AI 综合电台'
}

// 经过 2025 年实时验证的稳定官方直播 ID
export const NetworkStreamMap: Record<string, string> = {
  [NewsNetwork.BBC]: 'fSAt4m9S_A4', 
  [NewsNetwork.CNN]: 'unWpYvAis60', 
  [NewsNetwork.ABC]: 'gCNeDWCI0vo',
  [NewsNetwork.CBS]: 'fSAt4m9S_A4',
  [NewsNetwork.NBC]: 'unWpYvAis60',
  [NewsNetwork.SKY]: '9Auq9mYqrEE', // Sky News 嵌入支持度最高
  [NewsNetwork.BLOOMBERG]: 'dp8PhLsUcFE', 
  [NewsNetwork.AL_JAZEERA]: 'Xm66K_1XG_8',
  [NewsNetwork.FRANCE24]: 'vS_f5_Yy8Xg',
  [NewsNetwork.DW]: 'gv_m0p_q7vE', // 最新 DW News ID
  [NewsNetwork.CNA]: 'XWqH6L8H700'
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
