import { Channel, ChannelMode } from '@statechannels/nitro-protocol'
import { ethers } from 'hardhat'
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
    throw new Error(
      `Channel expected to be in ${expectedMode} mode. Currently in ${mode}.`,
    )
}

export async function assertBalance(address: string, expectedBalance: string) {
  const balance = (await ethers.provider.getBalance(address))
    .toString()
    .slice(0, expectedBalance.length)
  if (balance !== expectedBalance)
    throw new Error(
      `incorrect balance. got ${balance}. expected ${expectedBalance}`,
    )
}
