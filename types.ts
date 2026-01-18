
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
  NPR = 'NPR News',
  VOA = 'VOA Learning',
  BLOOMBERG = 'Bloomberg',
  AL_JAZEERA = 'Al Jazeera',
  SKY = 'Sky News',
  DW = 'DW News',
  CNA = 'CNA Asia',
  RFI = 'RFI English',
  GLOBAL_AI = 'AI 综合电台'
}

// 视频流 (YouTube)
export const NetworkStreamMap: Record<string, string> = {
  [NewsNetwork.BBC]: 'fSAt4m9S_A4', 
  [NewsNetwork.CNN]: 'unWpYvAis60', 
  [NewsNetwork.ABC]: 'gCNeDWCI0vo',
  [NewsNetwork.BLOOMBERG]: 'dp8PhLsUcFE', 
  [NewsNetwork.AL_JAZEERA]: 'Xm66K_1XG_8',
  [NewsNetwork.SKY]: '9Auq9mYqrEE',
  [NewsNetwork.DW]: 'gv_m0p_q7vE',
  [NewsNetwork.CNA]: 'XWqH6L8H700'
};

// 纯音频流 (Direct Audio URLs - 更有可能绕过限制并直接播放声音)
export const NetworkAudioMap: Record<string, string> = {
  [NewsNetwork.NPR]: 'https://npr-ice.streamguys1.com/p_9101_high_mp3',
  [NewsNetwork.VOA]: 'https://voa-28.akacast.akamaitechnologies.net/7/54/322040/v1/gibson.akacast.akamaitechnologies.net/voa-28',
  [NewsNetwork.RFI]: 'http://icepe1.infomaniak.ch/rfien-96.mp3',
  [NewsNetwork.BBC]: 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service'
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
