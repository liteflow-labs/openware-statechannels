import { BigNumber } from '@ethersproject/bignumber'
import { hexZeroPad, Signature } from '@ethersproject/bytes'
import { HashZero } from '@ethersproject/constants'
import { JsonRpcSigner } from '@ethersproject/providers'
import { Wallet } from '@ethersproject/wallet'
import {
  AllocationAssetOutcome,
  encodeOutcome,
  getFixedPart,
  getVariablePart,
  hashAppPart,
  hashOutcome,
  hashState,
  signChallengeMessage,
  signState,
  State,
} from '@statechannels/nitro-protocol'
import { Address } from '@statechannels/nitro-protocol/lib/src/contract/types'
import { MAGIC_ADDRESS_INDICATING_ETH } from '@statechannels/nitro-protocol/lib/src/transactions'
import { useCallback, useReducer } from 'react'
import { NitroAdjudicator } from '../contracts'
import { ChannelWithWallets } from './useChannel'

export type SignedState = State & {
  signatures: Signature[]
}

export type StateAction =
  | {
      type: 'init'
      channel: ChannelWithWallets
    }
  | { type: 'deposit'; asset: Address; amount: BigNumber; destination: string }
  | {
      type: 'transfer'
      asset: Address
      amount: BigNumber
      from: string
      to: string
    }
  | {
      type: 'finalize'
    }
  | {
      type: 'copyLastState'
    }
  | {
      type: 'signLastState'
      walletIndex: number
      wallet: Wallet
    }

export default function useStates(
  appDefinition: string,
  nitroAdjudicatorContract: NitroAdjudicator | null,
) {
  const validateTransition = useCallback(
    async (previousState: State, newState: State) => {
      if (!nitroAdjudicatorContract)
        throw new Error('nitroAdjudicatorContract is falsy')
      const isValidTransition = await nitroAdjudicatorContract.validTransition(
        newState.channel.participants.length,
        [false, false],
        [
          {
            outcome: hashOutcome(previousState.outcome),
            appData: previousState.appData,
          },
          {
            outcome: hashOutcome(newState.outcome),
            appData: newState.appData,
          },
        ],
        newState.turnNum,
        newState.appDefinition,
      )
      if (!isValidTransition) {
        window.alert('transition is not valid')
        return
      }
      console.log('transition is valid')
    },
    [nitroAdjudicatorContract],
  )

  const [states, dispatchStates] = useReducer(
    (states: SignedState[], action: StateAction): SignedState[] => {
      switch (action.type) {
        case 'init': {
          const newState: SignedState = {
            isFinal: false,
            channel: {
              channelNonce: action.channel.channelNonce,
              chainId: action.channel.chainId,
              participants: action.channel.wallets.map((w) => w.address),
            },
            outcome: [
              {
                asset: MAGIC_ADDRESS_INDICATING_ETH,
                allocationItems: action.channel.accounts.map((acc) => ({
                  destination: hexZeroPad(acc, 32),
                  amount: '0',
                })),
              },
            ],
            appDefinition: appDefinition,
            appData: HashZero,
            challengeDuration: 30,
            turnNum: 0,
            signatures: [],
          }
          return Object.assign([], [newState])
        }

        case 'copyLastState': {
          if (!states.length) throw new Error('no states')
          const previousState = states[states.length - 1]
          const newState: SignedState = JSON.parse(
            JSON.stringify({ ...previousState, signatures: [] }),
          ) // deep copy
          newState.turnNum++
          states.push(newState)
          return Object.assign([], states)
        }

        case 'signLastState': {
          if (!states.length) throw new Error('no states')
          const previousState = states[states.length - 1]

          const signedState = signState(previousState, action.wallet.privateKey)
          previousState.signatures[action.walletIndex] = signedState.signature

          return Object.assign([], states)
        }

        case 'finalize': {
          if (!states.length) throw new Error('no states')
          const previousState = states[states.length - 1]
          if (previousState.isFinal) {
            window.alert('last state is already final')
            return states
          }
          const newState: SignedState = JSON.parse(
            JSON.stringify({ ...previousState, signatures: [] }),
          ) // deep copy
          newState.isFinal = true
          newState.turnNum++
          states.push(newState)
          return Object.assign([], states)
        }

        case 'deposit': {
          if (!states.length) throw new Error('no states')
          const previousState = states[states.length - 1]
          if (previousState.isFinal) {
            window.alert('last state is already final')
            return states
          }
          const newState: SignedState = JSON.parse(
            JSON.stringify({ ...previousState, signatures: [] }),
          ) // deep copy
          newState.turnNum++

          const asset = newState.outcome.find(
            (assetOutcome) => assetOutcome.asset === action.asset,
          ) as AllocationAssetOutcome | undefined
          if (!asset) throw new Error('asset not found')

          // find right allocationItem
          const destination = hexZeroPad(action.destination, 32)
          const allocationItem = asset.allocationItems.find(
            (item) => item.destination === destination,
          )
          if (!allocationItem) throw new Error('allocationItem not found')

          // do the update of balance
          allocationItem.amount = action.amount
            .add(allocationItem.amount)
            .toString()

          states.push(newState)
          return Object.assign([], states)
        }

        // TODO: is it possible to withdraw without closing the channel?
        // case 'withdraw': {
        //   const asset = state.outcome.find(
        //     (assetOutcome) => assetOutcome.asset === action.asset,
        //   ) as AllocationAssetOutcome | undefined
        //   if (!asset) throw new Error('asset not found')

        //   // find right allocationItem
        //   const destination = hexZeroPad(action.destination, 32)
        //   const allocationItem = asset.allocationItems.find(
        //     (item) => item.destination === destination,
        //   )
        //   if (!allocationItem) throw new Error('allocationItem not found')

        //   // do the update of balance
        //   allocationItem.amount = '0'

        //   return Object.assign({}, state)
        // }

        case 'transfer': {
          if (!states.length) throw new Error('no states')
          const previousState = states[states.length - 1]
          if (previousState.isFinal) {
            window.alert('last state is already final')
            return states
          }
          const newState: SignedState = JSON.parse(
            JSON.stringify({ ...previousState, signatures: [] }),
          ) // deep copy
          newState.turnNum++

          const asset = newState.outcome.find(
            (assetOutcome) => assetOutcome.asset === action.asset,
          ) as AllocationAssetOutcome | undefined
          if (!asset) throw new Error('asset not found')

          // find right allocationItem
          const from = hexZeroPad(action.from, 32)
          const allocationItemFrom = asset.allocationItems.find(
            (item) => item.destination === from,
          )
          if (!allocationItemFrom)
            throw new Error('allocationItemFrom not found')

          // find right allocationItem
          const to = hexZeroPad(action.to, 32)
          const allocationItemTo = asset.allocationItems.find(
            (item) => item.destination === to,
          )
          if (!allocationItemTo) throw new Error('allocationItemTo not found')

          // do the update of balance
          allocationItemFrom.amount = BigNumber.from(allocationItemFrom.amount)
            .sub(action.amount)
            .toString()
          allocationItemTo.amount = BigNumber.from(allocationItemTo.amount)
            .add(action.amount)
            .toString()

          // check if transition is valid
          void validateTransition(previousState, newState)

          states.push(newState)
          return Object.assign([], states)
        }
      }
    },
    [],
  )

  const deposit = useCallback(
    async (
      signer: JsonRpcSigner | undefined,
      channelId: string,
      channelHoldings: BigNumber | undefined,
      amount: BigNumber,
    ) => {
      if (!nitroAdjudicatorContract)
        throw new Error('nitroAdjudicatorContract is falsy')
      if (!channelId) throw new Error('channelId is falsy')
      if (!channelHoldings) throw new Error('channelHoldings is falsy')
      if (!signer) throw new Error('signer is falsy')

      const expectedHeld = channelHoldings

      console.log('creating deposit tx')
      const depositTx = await nitroAdjudicatorContract
        .connect(signer)
        .deposit(
          MAGIC_ADDRESS_INDICATING_ETH,
          channelId,
          expectedHeld,
          amount,
          {
            value: amount,
          },
        )
      console.log('waiting for deposit tx', depositTx.hash)
      await depositTx.wait()
      console.log('deposit tx is done')
      dispatchStates({
        type: 'deposit',
        asset: MAGIC_ADDRESS_INDICATING_ETH,
        destination: await signer.getAddress(),
        amount,
      })
    },
    [nitroAdjudicatorContract, dispatchStates],
  )

  const transferToOther = useCallback(
    (from: string | null | undefined, amount: BigNumber) => {
      if (!from) throw new Error('from is falsy')
      const fromEncoded = hexZeroPad(from, 32)
      if (!states.length) throw new Error('no states')

      const lastState = states[states.length - 1]
      const other = (
        lastState.outcome[0] as AllocationAssetOutcome
      ).allocationItems.find(
        (alloc) => alloc.destination !== fromEncoded,
      )?.destination
      if (!other) throw new Error('no other participant found')

      dispatchStates({
        type: 'transfer',
        amount: amount,
        asset: MAGIC_ADDRESS_INDICATING_ETH,
        from: from,
        to: other,
      })
    },
    [dispatchStates, states],
  )

  const conclude = useCallback(
    async (signer: JsonRpcSigner | undefined) => {
      if (!nitroAdjudicatorContract)
        throw new Error('nitroAdjudicatorContract is falsy')
      if (!signer) throw new Error('signer is falsy')

      if (!states.length) throw new Error('no states')
      const lastState = states[states.length - 1]

      if (!lastState.isFinal) {
        window.alert('Last state must be final')
        return
      }

      if (
        lastState.signatures.length !== lastState.channel.participants.length
      ) {
        window.alert('not enough signature on the last state')
        return
      }

      // conclude
      const whoSignedWhat = lastState.signatures.map(() => 0) // everyone signs the last state
      const largestTurnNum = lastState.turnNum
      const fixedPart = getFixedPart(lastState)
      const appPartHash = hashAppPart(lastState)
      const outcomeHash = hashOutcome(lastState.outcome)
      const concludeTx = await nitroAdjudicatorContract
        .connect(signer)
        .conclude(
          largestTurnNum,
          fixedPart,
          appPartHash,
          outcomeHash,
          1,
          whoSignedWhat,
          lastState.signatures,
        )
      console.log('waiting for conclude tx', concludeTx.hash)
      await concludeTx.wait()
      console.log('conclude tx is done')
    },
    [nitroAdjudicatorContract, states],
  )

  const challenge = useCallback(
    async (wallet: Wallet, signer: JsonRpcSigner | undefined) => {
      if (!nitroAdjudicatorContract)
        throw new Error('nitroAdjudicatorContract is falsy')
      if (!signer) throw new Error('signer is falsy')

      if (!states.length) throw new Error('no states')
      const lastState = states[states.length - 1]

      const whoSignedWhat: number[] = []
      const signatures: Signature[] = []
      states.forEach((state, stateIndex) => {
        state.signatures.forEach((signature, signatureIndex) => {
          if (!signature) return
          signatures[signatureIndex] = signature
          whoSignedWhat[signatureIndex] = stateIndex
        })
      })
      if (whoSignedWhat.length !== lastState.channel.participants.length) {
        window.alert("some participant didn't sign")
        return
      }
      console.log('whoSignedWhat', whoSignedWhat)

      // challenger, sign last state (which it didn't sign in the previous signatures)
      const challengeSignedState = signState(lastState, wallet.privateKey)
      const challengeSignature = signChallengeMessage(
        [challengeSignedState],
        wallet.privateKey,
      )

      // remove unnecessary states
      const earlierSignedStateIndex = whoSignedWhat.reduce(
        (minState, stateIndex) => {
          return Math.min(minState, stateIndex)
        },
        Infinity,
      )
      console.log('earlierSignedStateIndex', earlierSignedStateIndex)
      const usefulStates = states.slice(earlierSignedStateIndex)
      console.log('usefulStates.length', usefulStates.length)
      console.log('usefulStates', usefulStates)
      const whoSignedWhatShifted = whoSignedWhat.map(
        (value) => value - earlierSignedStateIndex,
      )
      console.log('whoSignedWhatShifted', whoSignedWhatShifted)
      console.log('signatures', signatures)

      const largestTurnNum = lastState.turnNum
      const fixedPart = getFixedPart(lastState)
      const challengeTx = await nitroAdjudicatorContract
        .connect(signer)
        .challenge(
          fixedPart,
          largestTurnNum,
          usefulStates.map((state) => getVariablePart(state)),
          0, // isFinalCount
          signatures,
          whoSignedWhatShifted,
          challengeSignature,
        )
      console.log('waiting for challenge tx', challengeTx.hash)
      await challengeTx.wait()
      console.log('challenge tx is done')
    },
    [nitroAdjudicatorContract, states],
  )

  const withdrawAllAssets = useCallback(
    async (signer: JsonRpcSigner | undefined, channelId: string) => {
      if (!nitroAdjudicatorContract)
        throw new Error('nitroAdjudicatorContract is falsy')
      if (!channelId) throw new Error('channelId is falsy')
      if (!signer) throw new Error('signer is falsy')

      if (!states.length) throw new Error('no states')
      const lastState = states[states.length - 1]

      const outcomeBytes = encodeOutcome(lastState.outcome)
      // const assetIndex = 0 // implies we are paying out the 0th asset

      let stateHash = hashState(lastState)
      if (
        lastState.isFinal &&
        lastState.signatures.length === lastState.channel.participants.length
      ) {
        stateHash = HashZero // if the channel was concluded on the happy path, we can use this default value
      }

      // const indices: BigNumberish[] = [] // this magic value (a zero length array) implies we want to pay out all of the allocationItems
      const withdrawAllAssetsTx = await nitroAdjudicatorContract
        .connect(signer)
        // .transfer(assetIndex, channelId, outcomeBytes, stateHash, indices)
        .transferAllAssets(channelId, outcomeBytes, stateHash)
      console.log('waiting for withdrawAllAssets tx', withdrawAllAssetsTx.hash)
      await withdrawAllAssetsTx.wait()
      console.log('withdrawAllAssets tx is done')
    },
    [nitroAdjudicatorContract, states],
  )

  return {
    states,
    dispatchStates,
    deposit,
    transferToOther,
    conclude,
    challenge,
    withdrawAllAssets,
  }
}
