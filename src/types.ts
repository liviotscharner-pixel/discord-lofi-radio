export interface Station {
  id: string;
  name: string;
  url: string;
  description: string;
  /** Discord voice channel that auto-starts this station when a user joins. */
  voiceChannelId?: string;
}

export type StationId = 'hiphop' | 'house' | 'gaming';
