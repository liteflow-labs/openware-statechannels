import {
  Channel,
  ChannelMode,
  getChannelId,
  getChannelMode,
} from '@statechannels/nitro-protocol'
import { NitroAdjudicator } from '../types'

export async function fetchChannelMode(
  nitroAdjudicator: NitroAdjudicator,
  channel: Channel,
): Promise<ChannelMode> {
  const channelId = getChannelId(channel)
  const status = await nitroAdjudicator.unpackStatus(channelId)
  return getChannelMode(status.finalizesAt, Math.floor(Date.now() / 1000))
}

export async function wait(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}
