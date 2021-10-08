import { BigNumber, BigNumberish } from '@ethersproject/bignumber'
import { arrayify, hexZeroPad, splitSignature } from '@ethersproject/bytes'
import { AddressZero, HashZero } from '@ethersproject/constants'
import { JsonRpcProvider } from '@ethersproject/providers'
import { formatEther, formatUnits, parseUnits } from '@ethersproject/units'
import {
  AllocationAssetOutcome,
  Channel,
  encodeOutcome,
  getChannelId,
  getFixedPart,
  getStateSignerAddress,
  getVariablePart,
  hashAppPart,
  hashOutcome,
  hashState,
  signChallengeMessage,
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

const NitroAdjudicatorContractAddress =
  '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const TrivialAppContractAddress = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'

type StateAction =
  | { type: 'reset'; channel: Channel }
  | { type: 'deposit'; asset: Address; amount: BigNumber; destination: string }
  | { type: 'withdraw'; asset: Address; destination: string }
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

  const channel = useMemo<Channel | undefined>(() => {
    if (!chainId) return
    return {
      chainId: chainId.toString(),
      channelNonce: channelNonce,
      participants: [
        '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199',
        '0xdD2FD4581271e230360230F9337D5c0430Bf44C0',
      ],
    }
  }, [chainId, channelNonce])

  useEffect(() => {
    if (!channel) return
    dispatch({
      type: 'reset',
      channel,
    })
  }, [channel])

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
      switch (action.type) {
        case 'finalize': {
          state.isFinal = true
          return Object.assign({}, state)
        }
        case 'reset': {
          return Object.assign(
            {},
            {
              isFinal: false,
              channel: action.channel,
              outcome: [
                {
                  asset: MAGIC_ADDRESS_INDICATING_ETH,
                  allocationItems: action.channel.participants.map((p) => ({
                    destination: hexZeroPad(p, 32),
                    amount: '0',
                  })),
                },
              ],
              appDefinition: TrivialAppContractAddress,
              appData: HashZero,
              challengeDuration: 600, // 10 min
              turnNum: 0,
            },
          )
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

        case 'withdraw': {
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
          allocationItem.amount = '0'

          return Object.assign({}, state)
        }

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
    {} as State, // dirty hack
  )

  const channelId = useMemo(() => {
    if (!channel) return
    return getChannelId(channel)
  }, [channel])

  const [status, setStatus] = useState<
    | {
        turnNumRecord: number
        finalizesAt: number
        fingerprint: BigNumber
      }
    | undefined
  >()
  const fetchStatus = useCallback(() => {
    if (!nitroAdjudicatorContract) return
    if (!channelId) return
    void nitroAdjudicatorContract.unpackStatus(channelId).then(setStatus)
  }, [channelId, nitroAdjudicatorContract])
  useEffect(() => fetchStatus(), [fetchStatus])

  const [holdings, setHoldings] = useState<BigNumber>()
  const fetchHoldings = useCallback(() => {
    if (!nitroAdjudicatorContract) return
    if (!channelId) return
    void nitroAdjudicatorContract
      .holdings(AddressZero, channelId)
      .then(setHoldings)
  }, [channelId, nitroAdjudicatorContract])
  useEffect(() => fetchHoldings(), [fetchHoldings])

  const deposit = useCallback(async () => {
    if (!nitroAdjudicatorContract)
      throw new Error('nitroAdjudicatorContract is falsy')
    if (!channelId) throw new Error('channelId is falsy')
    if (!account) throw new Error('account is falsy')
    if (!library) throw new Error('library is falsy')
    if (!holdings) throw new Error('holdings is falsy')

    const signer = library.getSigner(account)
    const amount = parseUnits('1', 'ether')
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
    fetchHoldings,
    fetchBalance,
  ])

  const signState = useCallback(() => {
    if (!channel) throw new Error('channel is falsy')
    if (!account) throw new Error('account is falsy')
    if (!library) throw new Error('library is falsy')
    if (!state) throw new Error('state is falsy')

    const signer = library.getSigner(account)
    const hashedState = hashState(state)
    return signer.signMessage(arrayify(hashedState))
  }, [account, channel, library, state])

  const conclude = useCallback(async () => {
    if (!channel) throw new Error('channel is falsy')
    if (!nitroAdjudicatorContract)
      throw new Error('nitroAdjudicatorContract is falsy')
    if (!account) throw new Error('account is falsy')
    if (!library) throw new Error('library is falsy')
    if (!state) throw new Error('state is falsy')

    const largestTurnNum = state.turnNum
    const numStates = 1
    const whoSignedWhat = [0, 0]

    // ask and verify signature
    const sigs = state.channel.participants.map((participant) => {
      const sign = window.prompt(`Enter signature of ${participant}`)
      if (!sign) throw new Error('sign is falsy')
      const signSplit = splitSignature(sign)
      const signVerif = getStateSignerAddress({
        state,
        signature: signSplit,
      })
      if (participant.toLowerCase() !== signVerif.toLowerCase())
        throw new Error('signature is from the wrong address signature')
      console.log('signature is valid')
      return signSplit
    })

    // conclude
    const signer = library.getSigner(account)
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
        numStates,
        whoSignedWhat,
        sigs,
      )
    console.log('waiting for conclude tx', concludeTx.hash)
    await concludeTx.wait()
    console.log('conclude tx is done')
  }, [account, channel, library, nitroAdjudicatorContract, state])

  const challenge = useCallback(async () => {
    if (!channel) throw new Error('channel is falsy')
    if (!nitroAdjudicatorContract)
      throw new Error('nitroAdjudicatorContract is falsy')
    if (!account) throw new Error('account is falsy')
    if (!library) throw new Error('library is falsy')
    if (!state) throw new Error('state is falsy')

    const largestTurnNum = state.turnNum
    const whoSignedWhat = [0, 1]

    // ask and verify signature
    const sigs = state.channel.participants.map((participant) => {
      const sign = window.prompt(`Enter signature of ${participant}`)
      if (!sign) throw new Error('sign is falsy')
      const signSplit = splitSignature(sign)
      const signVerif = getStateSignerAddress({
        state,
        signature: signSplit,
      })
      if (participant.toLowerCase() !== signVerif.toLowerCase())
        throw new Error('signature is from the wrong address signature')
      console.log('signature is valid')
      return signSplit
    })

    // challenge
    const signer = library.getSigner(account)
    // const challengeHash = hashChallengeMessage(state)
    // const signingKey = new SigningKey(
    //   '0xdf57089febbacf7ba0bc227dafbffa9fc08a93fdc68e1e42411a14efcf23656e',
    // )
    // const signedMessage = signingKey.signDigest(hashMessage(challengeHash)) // FIXME: this signature is not working with signMessage from wallet...
    // const challengeSignature = splitSignature(signedMessage)
    // https://github.com/statechannels/statechannels/blob/%40statechannels/nitro-protocol%400.17.3/packages/nitro-protocol/src/signatures.ts
    const challengeSignature = signChallengeMessage(
      [
        { state, signature: sigs[0] },
        { state, signature: sigs[0] },
      ],
      '0xdf57089febbacf7ba0bc227dafbffa9fc08a93fdc68e1e42411a14efcf23656e',
    )

    const fixedPart = getFixedPart(state)
    const challengeTx = await nitroAdjudicatorContract
      .connect(signer)
      .challenge(
        fixedPart,
        largestTurnNum,
        [getVariablePart(state), getVariablePart(state)],
        0, // isFinalCount
        sigs,
        whoSignedWhat,
        challengeSignature,
      )
    console.log('waiting for challenge tx', challengeTx.hash)
    await challengeTx.wait()
    console.log('challenge tx is done')
  }, [account, channel, library, nitroAdjudicatorContract, state])

  const withdraw = useCallback(async () => {
    if (!nitroAdjudicatorContract)
      throw new Error('nitroAdjudicatorContract is falsy')
    if (!account) throw new Error('account is falsy')
    if (!library) throw new Error('library is falsy')
    if (!channelId) throw new Error('channelId is falsy')
    if (!state) throw new Error('state is falsy')

    const signer = library.getSigner(account)
    const outcomeBytes = encodeOutcome(state.outcome)
    const assetIndex = 0 // implies we are paying out the 0th asset
    const stateHash = HashZero // if the channel was concluded on the happy path, we can use this default value
    const indices: BigNumberish[] = [] // this magic value (a zero length array) implies we want to pay out all of the allocationItems
    const withdrawTx = await nitroAdjudicatorContract
      .connect(signer)
      .transfer(assetIndex, channelId, outcomeBytes, stateHash, indices)
    console.log('waiting for withdraw tx', withdrawTx.hash)
    await withdrawTx.wait()
    console.log('withdraw tx is done')
    dispatch({
      type: 'withdraw',
      asset: MAGIC_ADDRESS_INDICATING_ETH,
      destination: account,
    })
    fetchHoldings()
    fetchBalance()
  }, [
    account,
    channelId,
    fetchBalance,
    fetchHoldings,
    library,
    nitroAdjudicatorContract,
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

        {account && (
          <div>
            <h2>Channel</h2>
            <p>Id: {channelId}</p>
            <p>State:</p>
            <pre>{JSON.stringify(state, null, 4)}</pre>
            <p>
              OnChain Status:
              <br />
              turnNumRecord: {status?.turnNumRecord || '-'}
              <br />
              finalizesAt:{' '}
              {status?.finalizesAt
                ? new Date(status?.finalizesAt * 1000).toLocaleString()
                : '-'}
              <br />
              fingerprint: {status?.fingerprint.toString() || '-'}
              <br />
              <button
                type="button"
                onClick={() => fetchStatus()}
                style={{ cursor: 'pointer' }}
              >
                Refresh
              </button>
            </p>
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
              onClick={() => deposit()}
              style={{ cursor: 'pointer' }}
            >
              Deposit
            </button>{' '}
            <button
              type="button"
              onClick={() => {
                const other = state.channel.participants.find(
                  (p) => p !== account,
                )
                if (!other) throw new Error('no other participant found')
                dispatch({
                  type: 'transfer',
                  amount: parseUnits('1', 'ether'),
                  asset: MAGIC_ADDRESS_INDICATING_ETH,
                  from: account,
                  to: other,
                })
              }}
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
            <button
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
              onClick={() => challenge()}
              style={{ cursor: 'pointer' }}
            >
              Challenge
            </button>{' '}
            <button
              type="button"
              onClick={() => withdraw()}
              style={{ cursor: 'pointer' }}
            >
              Withdraw
            </button>{' '}
            <button
              type="button"
              onClick={() => setChannelNonce(channelNonce + 1)}
              style={{ cursor: 'pointer' }}
            >
              Reset
            </button>{' '}
          </div>
        )}
      </main>
    </>
  )
}
