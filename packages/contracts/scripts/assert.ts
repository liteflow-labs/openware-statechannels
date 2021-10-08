import { Channel, ChannelMode } from '@statechannels/nitro-protocol'
import { NitroAdjudicator } from '../types'
import { fetchChannelMode } from './utils'

export async function assertChannelMode(
  nitroAdjudicator: NitroAdjudicator,
  channel: Channel,
  expectedMode: ChannelMode,
) {
  // check channel status
  const mode = await fetchChannelMode(nitroAdjudicator, channel)
  console.log('Channel status is:', mode)
  if (mode !== expectedMode)
    throw new Error(`Channel expected to be in ${expectedMode} mode`)
}
