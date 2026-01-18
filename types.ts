
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
  CNN = 'CNN News',
  ABC = 'ABC News',
  NPR = 'NPR Radio',
  VOA = 'VOA Learning',
  BLOOMBERG = 'Bloomberg',
  AL_JAZEERA = 'Al Jazeera',
  SKY = 'Sky News',
  DW = 'DW News',
  CNA = 'CNA Asia',
  RFI = 'RFI English',
  GLOBAL_AI = 'AI 综合电台'
}

// 仅保留 BBC，其他由 AI 模拟。
export const NetworkAudioMap: Record<string, string> = {
  [NewsNetwork.BBC]: 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service'
};

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
