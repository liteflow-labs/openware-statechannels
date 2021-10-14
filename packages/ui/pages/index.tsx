import { BigNumber } from '@ethersproject/bignumber'
import { hexZeroPad } from '@ethersproject/bytes'
import { AddressZero, HashZero } from '@ethersproject/constants'
import { keccak256 } from '@ethersproject/keccak256'
import { JsonRpcProvider } from '@ethersproject/providers'
import { formatEther, formatUnits, parseUnits } from '@ethersproject/units'
import { Wallet } from '@ethersproject/wallet'
import {
  AllocationAssetOutcome,
  encodeOutcome,
  getChannelId,
  getChannelMode,
  getFixedPart,
  getVariablePart,
  hashAppPart,
  hashOutcome,
  signChallengeMessage,
  SignedState,
  signState,
  signStates,
  State,
} from '@statechannels/nitro-protocol'
import { abi as NitroAdjudicatorContractAbi } from '@statechannels/nitro-protocol/lib/artifacts/contracts/NitroAdjudicator.sol/NitroAdjudicator.json'
import { Address } from '@statechannels/nitro-protocol/lib/src/contract/types'
import { MAGIC_ADDRESS_INDICATING_ETH } from '@statechannels/nitro-protocol/lib/src/transactions'
import { useWeb3React } from '@web3-react/core'
import Head from 'next/head'
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { NitroAdjudicator } from '../contracts'
import useContract from '../hooks/useContract'
import { injectedConnector } from '../lib/connector'

// TODO: must implement the ephemeral keys in the participants but keep the real wallet in the outcomes

const NitroAdjudicatorContractAddress =
  '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const TrivialAppContractAddress = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'

type StateAction =
  // | { type: 'reset'; channel: Channel }
  | { type: 'setChainId'; chainId: string }
  | { type: 'addParticipant'; address: string; ephemeral: Wallet }
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
    dispatch({ type: 'setChainId', chainId: chainId.toString() })
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

  // const [channelNonce, setChannelNonce] = useState(0)
  const [participants, setParticipants] = useState<
    { ephemeral: Wallet; address: string }[]
  >([])

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
      if (!isValidTransition) throw new Error('transition is not valid')
      console.log('transition is valid')
    },
    [nitroAdjudicatorContract],
  )

  const [state, dispatch] = useReducer(
    (state: State, action: StateAction): State => {
      if (state.isFinal) {
        window.alert('state is already final')
        return state
      }

      switch (action.type) {
        case 'setChainId': {
          state.channel.chainId = action.chainId
          return Object.assign({}, state)
        }

        case 'finalize': {
          state.isFinal = true
          return Object.assign({}, state)
        }

        case 'addParticipant': {
          state.channel.participants.push(action.ephemeral.address)
          ;(state.outcome[0] as AllocationAssetOutcome).allocationItems.push({
            destination: hexZeroPad(action.address, 32),
            amount: '0',
          })
          return Object.assign({}, state)
        }

        case 'deposit': {
          const asset = state.outcome.find(
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

          return Object.assign({}, state)
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
          const previousState = Object.assign({}, state)
          const asset = state.outcome.find(
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

          // increase turn number
          state.turnNum++

          // check if transition is valid
          void validTransition(previousState, state)

          return Object.assign({}, state)
        }
      }
    },
    {
      isFinal: false,
      channel: {
        channelNonce: 0,
        participants: [],
        chainId: '0',
      },
      outcome: [
        {
          asset: MAGIC_ADDRESS_INDICATING_ETH,
          allocationItems: [],
        },
      ],
      appDefinition: TrivialAppContractAddress,
      appData: HashZero,
      challengeDuration: 30,
      turnNum: 0,
    } as State, // dirty hack
  )

  const addNewParticipant = useCallback(async () => {
    if (!signer) throw new Error('signer is falsy')
    if (!account) throw new Error('account is falsy')
    const signature = await signer._signTypedData(
      {
        name: 'OpenWare State Channel',
        chainId: state.channel.chainId,
        version: '1',
        verifyingContract: TrivialAppContractAddress,
      },
      {
        Channel: [
          { name: 'chainId', type: 'uint32' },
          // { name: 'channelNonce', type: 'uint32' },
          { name: 'appDefinition', type: 'address' },
        ],
      },
      {
        chainId: state.channel.chainId,
        // channelNonce: channelNonce.toString(),
        appDefinition: state.appDefinition,
      },
    )
    const ephemeral = new Wallet(keccak256(signature))
    if (
      participants.find(
        (p) =>
          p.address === account || p.ephemeral.address === ephemeral.address,
      )
    ) {
      window.alert('participant already added')
      return
    }
    setParticipants([...participants, { ephemeral, address: account }])
    dispatch({
      type: 'addParticipant',
      address: account,
      ephemeral,
    })
  }, [account, participants, signer, state])

  const channelId = useMemo(() => {
    if (!state.channel) return
    return getChannelId(state.channel)
  }, [state])

  const [channelMode, setChannelMode] = useState<string>()
  const fetchChannelMode = useCallback(() => {
    if (!nitroAdjudicatorContract) return
    if (!channelId) return
    void nitroAdjudicatorContract
      .unpackStatus(channelId)
      .then((status) =>
        getChannelMode(status.finalizesAt, Math.floor(Date.now() / 1000)),
      )
      .then(setChannelMode)
      .catch((error) =>
        console.warn(
          'error from unpackStatus may caused by channel with no deposit',
          error,
        ),
      )
  }, [channelId, nitroAdjudicatorContract])
  useEffect(() => fetchChannelMode(), [fetchChannelMode])

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

    const participant = participants.find((p) => p.address === account)
    if (!participant) throw new Error('participant not found')

    const amountString = window.prompt('How many ETH to deposit?', '1')
    if (!amountString) throw new Error('amountString is falsy')

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
      destination: participant.address,
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
    participants,
    fetchHoldings,
    fetchBalance,
  ])

  const transferToOther = useCallback(() => {
    if (!account) throw new Error('account is falsy')
    const accountEncoded = hexZeroPad(account, 32)
    const other = (
      state.outcome[0] as AllocationAssetOutcome
    ).allocationItems.find(
      (alloc) => alloc.destination !== accountEncoded,
    )?.destination
    if (!other) throw new Error('no other participant found')

    const amountString = window.prompt('How many ETH to transfer?', '1')
    if (!amountString) throw new Error('amountString is falsy')
    const amount = parseUnits(amountString, 'ether')

    dispatch({
      type: 'transfer',
      amount: amount,
      asset: MAGIC_ADDRESS_INDICATING_ETH,
      from: account,
      to: other,
    })
  }, [account, state])

  const conclude = useCallback(async () => {
    if (!nitroAdjudicatorContract)
      throw new Error('nitroAdjudicatorContract is falsy')
    if (!account) throw new Error('account is falsy')
    if (!library) throw new Error('library is falsy')
    if (!state) throw new Error('state is falsy')
    if (!signer) throw new Error('signer is falsy')

    const states = [state]

    if (!states[states.length - 1].isFinal) {
      window.alert('Last state must be final')
      return
    }

    const largestTurnNum = states[states.length - 1].turnNum // TODO: make it dynamic
    const whoSignedWhat = states[0].channel.participants.map(
      // TODO: make it dynamic
      () => states.length - 1,
    ) // everyone signs the last state

    console.log('Signs states using ephemeral keys of everyone')
    const signatures = await signStates(
      [state],
      participants.map((p) => p.ephemeral),
      whoSignedWhat,
    )

    // conclude
    const fixedPart = getFixedPart(state)
    const appPartHash = hashAppPart(state)
    const outcomeHash = hashOutcome(state.outcome)
    const concludeTx = await nitroAdjudicatorContract
      .connect(signer)
      .conclude(
        largestTurnNum,
        fixedPart,
        appPartHash,
        outcomeHash,
        states.length,
        whoSignedWhat,
        signatures,
      )
    console.log('waiting for conclude tx', concludeTx.hash)
    await concludeTx.wait()
    console.log('conclude tx is done')
  }, [account, library, nitroAdjudicatorContract, participants, signer, state])

  const challenge = useCallback(async () => {
    if (!nitroAdjudicatorContract)
      throw new Error('nitroAdjudicatorContract is falsy')
    if (!account) throw new Error('account is falsy')
    if (!library) throw new Error('library is falsy')
    if (!state) throw new Error('state is falsy')
    if (!signer) throw new Error('signer is falsy')

    const largestTurnNum = state.turnNum
    const whoSignedWhat = [0, 1] // TODO: make it dynamic
    const states = [state, state] // TODO: make it dynamic

    console.log('Signs states using ephemeral keys of everyone')
    const signatures = await signStates(
      states,
      participants.map((p) => p.ephemeral),
      whoSignedWhat,
    )

    // challenger, sign last state (which it didn't sign in the previous signatures)
    const challengeSignedState: SignedState = signState(
      states[states.length - 1],
      participants[0].ephemeral.privateKey,
    )
    const challengeSignature = signChallengeMessage(
      [challengeSignedState],
      participants[0].ephemeral.privateKey,
    )

    const fixedPart = getFixedPart(state)
    const challengeTx = await nitroAdjudicatorContract
      .connect(signer)
      .challenge(
        fixedPart,
        largestTurnNum,
        states.map((state) => getVariablePart(state)),
        0, // isFinalCount
        signatures,
        whoSignedWhat,
        challengeSignature,
      )
    console.log('waiting for challenge tx', challengeTx.hash)
    await challengeTx.wait()
    console.log('challenge tx is done')
  }, [account, library, nitroAdjudicatorContract, participants, signer, state])

  const withdrawAllAssets = useCallback(async () => {
    if (!nitroAdjudicatorContract)
      throw new Error('nitroAdjudicatorContract is falsy')
    if (!account) throw new Error('account is falsy')
    if (!library) throw new Error('library is falsy')
    if (!channelId) throw new Error('channelId is falsy')
    if (!state) throw new Error('state is falsy')
    if (!signer) throw new Error('signer is falsy')

    const outcomeBytes = encodeOutcome(state.outcome)
    // const assetIndex = 0 // implies we are paying out the 0th asset
    const stateHash = HashZero // if the channel was concluded on the happy path, we can use this default value
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
    state,
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

        {account && state.channel && (
          <div>
            <h2>Channel</h2>
            <p>Id: {channelId}</p>
            <pre>{JSON.stringify(state.channel, null, 4)}</pre>
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
            <button
              type="button"
              onClick={() => addNewParticipant()}
              style={{ cursor: 'pointer' }}
            >
              Add a new participant
            </button>{' '}
            <button
              type="button"
              onClick={() => deposit()}
              style={{ cursor: 'pointer' }}
            >
              Deposit
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
            </button>
          </div>
        )}

        {account && (
          <div>
            <h2>State</h2>

            <pre>{JSON.stringify(state, null, 4)}</pre>

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
                onClick={() => transferToOther()}
                style={{ cursor: 'pointer' }}
              >
                Transfer to other
              </button>{' '}
              <button
                type="button"
                onClick={() => dispatch({ type: 'finalize' })}
                style={{ cursor: 'pointer' }}
              >
                Finalize
              </button>{' '}
              {/* <button
                type="button"
                onClick={() =>
                  signState().then((signature) =>
                    console.log(
                      `signature of state #${state.turnNum} by ${account}`,
                      signature,
                    ),
                  )
                }
                style={{ cursor: 'pointer' }}
              >
                Sign state
              </button>{' '} */}
              <button
                type="button"
                onClick={() => conclude()}
                style={{ cursor: 'pointer' }}
              >
                Conclude
              </button>{' '}
              <button
                type="button"
                onClick={() => challenge()}
                style={{ cursor: 'pointer' }}
              >
                Challenge
              </button>{' '}
            </p>
          </div>
        )}
      </main>
    </>
  )
}
