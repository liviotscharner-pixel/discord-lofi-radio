import type { Station, StationId } from './types';
import stationsData from './stations.json';

export const STATIONS: Station[] = stationsData as Station[];

export function getStation(id: string): Station | undefined {
  return STATIONS.find((s) => s.id === id);
}

export function getStationByVoiceChannelId(
  channelId: string,
): Station | undefined {
  return STATIONS.find((s) => s.voiceChannelId === channelId);
}

export function isStationId(id: string): id is StationId {
  return STATIONS.some((s) => s.id === id);
}

export const STATION_CHOICES = STATIONS.map((s) => ({
  name: s.name,
  value: s.id,
}));
