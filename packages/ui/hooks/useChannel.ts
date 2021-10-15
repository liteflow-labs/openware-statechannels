import { BigNumber } from '@ethersproject/bignumber'
import { AddressZero } from '@ethersproject/constants'
import { keccak256 } from '@ethersproject/keccak256'
import { JsonRpcSigner } from '@ethersproject/providers'
import { Wallet } from '@ethersproject/wallet'
import {
  Channel,
  getChannelId,
  getChannelMode,
} from '@statechannels/nitro-protocol'
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { NitroAdjudicator } from '../contracts'

export type ChannelWithWallets = Omit<Channel, 'participants'> & {
  accounts: string[] // User's ethereum wallet
  wallets: Wallet[] // Ephemeral wallets
}

export type ChannelAction =
  | { type: 'setNonce'; channelNonce: number }
  | { type: 'setChainId'; chainId: string }
  | { type: 'addParticipant'; account: string; ephemeral: Wallet }

export default function useChannel(
  chainId: number | undefined,
  nitroAdjudicatorContract: NitroAdjudicator | null,
  appDefinitionAddress: string,
) {
  const [channel, dispatchChannel] = useReducer(
    (
      channel: ChannelWithWallets,
      action: ChannelAction,
    ): ChannelWithWallets => {
      switch (action.type) {
        case 'setNonce': {
          channel.channelNonce = action.channelNonce
          return Object.assign({}, channel)
        }
        case 'setChainId': {
          channel.chainId = action.chainId
          return Object.assign({}, channel)
        }
        case 'addParticipant': {
          if (channel.accounts.find((acc) => acc === action.account)) {
            window.alert('participant already added')
            return channel
          }

          channel.wallets.push(action.ephemeral)
          channel.accounts.push(action.account)

          return Object.assign({}, channel)
        }
      }
    },
    {
      channelNonce: 0,
      chainId: '0',
      wallets: [],
      accounts: [],
    },
  )

  const [channelNonce, setChannelNonce] = useState(0)
  useEffect(() => {
    dispatchChannel({ type: 'setNonce', channelNonce })
  }, [channelNonce])

  useEffect(() => {
    if (!chainId) return
    dispatchChannel({ type: 'setChainId', chainId: chainId.toString() })
  }, [chainId])

  const channelId = useMemo(() => {
    return getChannelId({
      ...channel,
      participants: channel.wallets.map((w) => w.address),
    })
  }, [channel])

  const [channelMode, setChannelMode] = useState<string>()
  const fetchChannelMode = useCallback(() => {
    if (!nitroAdjudicatorContract) return
    void nitroAdjudicatorContract
      .unpackStatus(channelId)
      .then((status) => {
        console.log('fingerprint', status.fingerprint.toHexString())
        return getChannelMode(status.finalizesAt, Math.floor(Date.now() / 1000))
      })
      .then(setChannelMode)
      .catch((error) =>
        console.warn(
          'error from unpackStatus may caused by channel with no deposit',
          error,
        ),
      )
  }, [channelId, nitroAdjudicatorContract])
  useEffect(() => fetchChannelMode(), [fetchChannelMode])

  const [channelHoldings, setHoldings] = useState<BigNumber>()
  const fetchChannelHoldings = useCallback(() => {
    if (!nitroAdjudicatorContract) return
    void nitroAdjudicatorContract
      .holdings(AddressZero, channelId)
      .then(setHoldings)
      .catch((error) =>
        console.warn(
          'error from holdings may caused by channel with no deposit',
          error,
        ),
      )
  }, [channelId, nitroAdjudicatorContract])
  useEffect(() => fetchChannelHoldings(), [fetchChannelHoldings])

  const addNewParticipant = useCallback(
    async (signer: JsonRpcSigner | undefined) => {
      if (!signer) throw new Error('signer is falsy')

      const signature = await signer._signTypedData(
        {
          name: 'OpenWare State Channel',
          chainId: chainId,
          version: '1',
          verifyingContract: appDefinitionAddress,
        },
        {
          Channel: [
            { name: 'chainId', type: 'uint32' },
            { name: 'channelNonce', type: 'uint32' },
            { name: 'appDefinition', type: 'address' },
          ],
        },
        {
          chainId: chainId,
          channelNonce: channelNonce.toString(),
          appDefinition: appDefinitionAddress,
        },
      )

      const ephemeral = new Wallet(keccak256(signature))

      dispatchChannel({
        type: 'addParticipant',
        account: await signer.getAddress(),
        ephemeral,
      })
    },
    [appDefinitionAddress, chainId, channelNonce],
  )

  return {
    channel,
    channelNonce,
    setChannelNonce,
    channelId,
    channelMode,
    fetchChannelMode,
    channelHoldings,
    fetchChannelHoldings,
    addNewParticipant,
  }
}
