import { BigNumber } from '@ethersproject/bignumber'
import { hexZeroPad, Signature } from '@ethersproject/bytes'
import { AddressZero, HashZero } from '@ethersproject/constants'
import { keccak256 } from '@ethersproject/keccak256'
import { JsonRpcProvider } from '@ethersproject/providers'
import { formatEther, formatUnits, parseUnits } from '@ethersproject/units'
import { Wallet } from '@ethersproject/wallet'
import {
  AllocationAssetOutcome,
  Channel,
  channelDataToStatus,
  encodeOutcome,
  getChannelId,
  getChannelMode,
  getFixedPart,
  getVariablePart,
  hashAppPart,
  hashOutcome,
  hashState,
  signChallengeMessage,
  signState,
  State,
} from '@statechannels/nitro-protocol'
import { abi as NitroAdjudicatorContractAbi } from '@statechannels/nitro-protocol/lib/artifacts/contracts/NitroAdjudicator.sol/NitroAdjudicator.json'
import { parseStatus } from '@statechannels/nitro-protocol/lib/src/contract/channel-storage'
import { Address } from '@statechannels/nitro-protocol/lib/src/contract/types'
import { MAGIC_ADDRESS_INDICATING_ETH } from '@statechannels/nitro-protocol/lib/src/transactions'
import { useWeb3React } from '@web3-react/core'
import Head from 'next/head'
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { NitroAdjudicator } from '../contracts'
import useContract from '../hooks/useContract'
import { injectedConnector } from '../lib/connector'

// TODO: must implement the ephemeral keys in the participants but keep the real wallet in the outcomes

type ChannelWithWallets = Omit<Channel, 'participants'> & {
  accounts: string[] // User's ethereum wallet
  wallets: Wallet[] // Ephemeral wallets
}

type SignedState = State & {
  signatures: Signature[]
}

const NitroAdjudicatorContractAddress =
  '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const TrivialAppContractAddress = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'

type ChannelAction =
  | { type: 'setNonce'; channelNonce: number }
  | { type: 'setChainId'; chainId: string }
  | { type: 'addParticipant'; account: string; ephemeral: Wallet }

type StateAction =
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

export default function Home(): JSX.Element {
  const {
    account,
    activate,
    error: web3Error,
    chainId,
    library,
  } = useWeb3React<JsonRpcProvider>()

  const signer = useMemo(() => {
    if (!library) return
    if (!account) return
    return library.getSigner(account)
  }, [library, account])

  useEffect(() => {
    if (!chainId) return
    dispatchChannel({ type: 'setChainId', chainId: chainId.toString() })
  }, [chainId])

  useEffect(() => {
    if (web3Error) throw web3Error
  }, [web3Error])

  const [balance, setBalance] = useState<BigNumber>()

  const fetchBalance = useCallback(() => {
    if (!library) return
    if (!account) return
    void library.getBalance(account).then(setBalance)
  }, [account, library])
  useEffect(() => fetchBalance(), [fetchBalance])

  const nitroAdjudicatorContract = useContract<NitroAdjudicator>(
    NitroAdjudicatorContractAddress,
    NitroAdjudicatorContractAbi,
  )

  const [channelNonce, setChannelNonce] = useState(0)
  useEffect(() => {
    dispatchChannel({ type: 'setNonce', channelNonce })
  }, [channelNonce])

  const validTransition = useCallback(
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

  const [states, dispatch] = useReducer(
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
            appDefinition: TrivialAppContractAddress,
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
          void validTransition(previousState, newState)

          states.push(newState)
          return Object.assign([], states)
        }
      }
    },
    [],
  )

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

  const addNewParticipant = useCallback(async () => {
    if (!signer) throw new Error('signer is falsy')
    if (!account) throw new Error('account is falsy')
    const signature = await signer._signTypedData(
      {
        name: 'OpenWare State Channel',
        chainId: chainId,
        version: '1',
        verifyingContract: TrivialAppContractAddress,
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
        appDefinition: TrivialAppContractAddress,
      },
    )
    const ephemeral = new Wallet(keccak256(signature))
    dispatchChannel({
      type: 'addParticipant',
      account,
      ephemeral,
    })
  }, [account, chainId, channelNonce, signer])

  const channelId = useMemo(() => {
    return getChannelId({
      ...channel,
      participants: channel.wallets.map((w) => w.address),
    })
  }, [channel])

  const [channelMode, setChannelMode] = useState<string>()
  const fetchChannelMode = useCallback(() => {
    if (!nitroAdjudicatorContract) return
    if (!channelId) return
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

  const channelStatus = useMemo(() => {
    if (!states.length) return
    const lastState = states[states.length - 1]
    return channelDataToStatus({
      turnNumRecord: lastState.turnNum,
      finalizesAt: Math.floor(Date.now() / 1000),
      state: lastState,
      outcome: lastState.outcome,
    })
  }, [states])

  const [holdings, setHoldings] = useState<BigNumber>()
  const fetchHoldings = useCallback(() => {
    if (!nitroAdjudicatorContract) return
    if (!channelId) return
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
  useEffect(() => fetchHoldings(), [fetchHoldings])

  const deposit = useCallback(async () => {
    if (!nitroAdjudicatorContract)
      throw new Error('nitroAdjudicatorContract is falsy')
    if (!channelId) throw new Error('channelId is falsy')
    if (!account) throw new Error('account is falsy')
    if (!library) throw new Error('library is falsy')
    if (!holdings) throw new Error('holdings is falsy')
    if (!signer) throw new Error('signer is falsy')

    const amountString = window.prompt('How many ETH to deposit?', '1')
    if (!amountString) return

    const amount = parseUnits(amountString, 'ether')
    const expectedHeld = holdings

    console.log('creating deposit tx')
    const depositTx = await nitroAdjudicatorContract
      .connect(signer)
      .deposit(MAGIC_ADDRESS_INDICATING_ETH, channelId, expectedHeld, amount, {
        value: amount,
      })
    console.log('waiting for deposit tx', depositTx.hash)
    await depositTx.wait()
    console.log('deposit tx is done')
    dispatch({
      type: 'deposit',
      asset: MAGIC_ADDRESS_INDICATING_ETH,
      destination: account,
      amount,
    })
    fetchHoldings()
    fetchBalance()
  }, [
    nitroAdjudicatorContract,
    channelId,
    account,
    library,
    holdings,
    signer,
    fetchHoldings,
    fetchBalance,
  ])

  const transferToOther = useCallback(() => {
    if (!account) throw new Error('account is falsy')
    const accountEncoded = hexZeroPad(account, 32)
    if (!states.length) throw new Error('no states')
    const lastState = states[states.length - 1]
    const other = (
      lastState.outcome[0] as AllocationAssetOutcome
    ).allocationItems.find(
      (alloc) => alloc.destination !== accountEncoded,
    )?.destination
    if (!other) throw new Error('no other participant found')

    const amountString = window.prompt('How many ETH to transfer?', '1')
    if (!amountString) return
    const amount = parseUnits(amountString, 'ether')

    dispatch({
      type: 'transfer',
      amount: amount,
      asset: MAGIC_ADDRESS_INDICATING_ETH,
      from: account,
      to: other,
    })
  }, [account, states])

  const conclude = useCallback(async () => {
    if (!nitroAdjudicatorContract)
      throw new Error('nitroAdjudicatorContract is falsy')
    if (!account) throw new Error('account is falsy')
    if (!library) throw new Error('library is falsy')
    if (!signer) throw new Error('signer is falsy')

    if (!states.length) throw new Error('no states')
    const lastState = states[states.length - 1]

    if (!lastState.isFinal) {
      window.alert('Last state must be final')
      return
    }

    if (lastState.signatures.length !== lastState.channel.participants.length) {
      window.alert('not enough signature on the last state')
      return
    }

    // conclude
    const whoSignedWhat = channel.wallets.map(() => 0) // everyone signs the last state
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
  }, [account, channel, library, nitroAdjudicatorContract, signer, states])

  const challenge = useCallback(
    async (walletIndex: number) => {
      if (!nitroAdjudicatorContract)
        throw new Error('nitroAdjudicatorContract is falsy')
      if (!account) throw new Error('account is falsy')
      if (!library) throw new Error('library is falsy')
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
      const challengeSignedState = signState(
        lastState,
        channel.wallets[walletIndex].privateKey,
      )
      const challengeSignature = signChallengeMessage(
        [challengeSignedState],
        channel.wallets[walletIndex].privateKey,
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
    [account, channel, library, nitroAdjudicatorContract, signer, states],
  )

  const withdrawAllAssets = useCallback(async () => {
    if (!nitroAdjudicatorContract)
      throw new Error('nitroAdjudicatorContract is falsy')
    if (!account) throw new Error('account is falsy')
    if (!library) throw new Error('library is falsy')
    if (!channelId) throw new Error('channelId is falsy')
    if (!signer) throw new Error('signer is falsy')

    if (!states.length) throw new Error('no states')
    const lastState = states[states.length - 1]

    const outcomeBytes = encodeOutcome(lastState.outcome)
    // const assetIndex = 0 // implies we are paying out the 0th asset


    let stateHash = hashState(lastState)
    if (lastState.isFinal && lastState.signatures.length === lastState.channel.participants.length) {
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
    fetchHoldings()
    fetchBalance()
  }, [
    account,
    channelId,
    fetchBalance,
    fetchHoldings,
    library,
    nitroAdjudicatorContract,
    signer,
    states,
  ])

  return (
    <>
      <Head>
        <title>OpenWare StateChannels POC</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main>
        <h1>OpenWare StateChannels POC</h1>

        <div>
          <h2>Wallet</h2>
          <p>{account ? 'Connected with ' + account : 'Not connected'}</p>
          {!account && (
            <button
              type="button"
              onClick={() => {
                void activate(injectedConnector, undefined, true)
              }}
              style={{ cursor: 'pointer' }}
            >
              Connect with Metamask
            </button>
          )}
          {account && balance && (
            <p>
              Balance: {formatEther(balance)}{' '}
              <button
                type="button"
                onClick={() => fetchBalance()}
                style={{ cursor: 'pointer' }}
              >
                Refresh
              </button>
            </p>
          )}
        </div>

        <div>
          <h2>Channel</h2>
          <p>Id: {channelId}</p>
          <pre>{JSON.stringify(channel, null, 4)}</pre>
          {channelStatus && (
            <pre>{JSON.stringify(parseStatus(channelStatus), null, 4)}</pre>
          )}
          <p>
            The channel currently holds: {formatUnits(holdings || '0')}{' '}
            <button
              type="button"
              onClick={() => fetchHoldings()}
              style={{ cursor: 'pointer' }}
            >
              Refresh
            </button>
          </p>
          <p>
            The state mode is {channelMode}{' '}
            <button
              type="button"
              onClick={() => fetchChannelMode()}
              style={{ cursor: 'pointer' }}
            >
              Refresh
            </button>
          </p>
          <p>
            <button
              type="button"
              onClick={() => addNewParticipant()}
              style={{ cursor: 'pointer' }}
            >
              Add a new participant
            </button>{' '}
            <button
              type="button"
              onClick={() => withdrawAllAssets()}
              style={{ cursor: 'pointer' }}
            >
              Withdraw All
            </button>{' '}
            <button
              type="button"
              onClick={() => setChannelNonce(channelNonce + 1)}
              style={{ cursor: 'pointer' }}
            >
              Increase nonce
            </button>{' '}
            <button
              type="button"
              onClick={() => dispatch({ type: 'init', channel })}
              style={{ cursor: 'pointer' }}
            >
              Init first state
            </button>{' '}
          </p>
        </div>

        <div>
          <h2>States</h2>
          <pre>{JSON.stringify(states, null, 4)}</pre>
          {states.length > 0 && (
            <p>
              <button
                type="button"
                onClick={() => deposit()}
                style={{ cursor: 'pointer' }}
              >
                Deposit
              </button>{' '}
              <button
                type="button"
                onClick={() => transferToOther()}
                style={{ cursor: 'pointer' }}
              >
                Transfer to other
              </button>{' '}
              <button
                type="button"
                onClick={() => dispatch({ type: 'copyLastState' })}
                style={{ cursor: 'pointer' }}
              >
                Copy last state
              </button>{' '}
              <button
                type="button"
                onClick={() => dispatch({ type: 'finalize' })}
                style={{ cursor: 'pointer' }}
              >
                Finalize
              </button>{' '}
              <button
                type="button"
                onClick={() => {
                  const walletString = window.prompt(
                    'Index of wallet to use to sign:',
                    '0',
                  )
                  if (!walletString) return
                  const walletIndex = Number.parseInt(walletString)
                  dispatch({
                    type: 'signLastState',
                    walletIndex: walletIndex,
                    wallet: channel.wallets[walletIndex],
                  })
                }}
                style={{ cursor: 'pointer' }}
              >
                Sign state
              </button>{' '}
              <button
                type="button"
                onClick={() => conclude()}
                style={{ cursor: 'pointer' }}
              >
                Conclude
              </button>{' '}
              <button
                type="button"
                onClick={() => {
                  const walletString = window.prompt(
                    'Index of wallet to use to challenge:',
                    '0',
                  )
                  if (!walletString) return
                  const walletIndex = Number.parseInt(walletString)
                  void challenge(walletIndex)
                }}
                style={{ cursor: 'pointer' }}
              >
                Challenge
              </button>{' '}
            </p>
          )}
        </div>
      </main>
    </>
  )
}
