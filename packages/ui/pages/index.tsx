import { BigNumber, BigNumberish } from '@ethersproject/bignumber'
import { arrayify, hexZeroPad, splitSignature } from '@ethersproject/bytes'
import { AddressZero, HashZero } from '@ethersproject/constants'
import { JsonRpcProvider } from '@ethersproject/providers'
import { formatEther, formatUnits, parseUnits } from '@ethersproject/units'
import {
  Channel,
  encodeOutcome,
  getChannelId,
  getFixedPart,
  getStateSignerAddress,
  hashAppPart,
  hashOutcome,
  hashState,
  State,
} from '@statechannels/nitro-protocol'
import { abi as NitroAdjudicatorContractAbi } from '@statechannels/nitro-protocol/lib/artifacts/contracts/NitroAdjudicator.sol/NitroAdjudicator.json'
import { MAGIC_ADDRESS_INDICATING_ETH } from '@statechannels/nitro-protocol/lib/src/transactions'
import { useWeb3React } from '@web3-react/core'
import Head from 'next/head'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { NitroAdjudicator } from '../contracts'
import useContract from '../hooks/useContract'
import { injectedConnector } from '../lib/connector'

const NitroAdjudicatorContractAddress =
  '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const DummyContractAddress = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
const participants = [
  '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199',
  '0xdD2FD4581271e230360230F9337D5c0430Bf44C0',
]

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

  const channel = useMemo<Channel | undefined>(() => {
    if (!chainId) return
    return {
      chainId: chainId.toString(),
      channelNonce: 0,
      participants,
    }
  }, [chainId])

  const state = useMemo<State | undefined>(() => {
    if (!channel) return
    return {
      isFinal: true,
      channel,
      outcome: [
        {
          asset: MAGIC_ADDRESS_INDICATING_ETH,
          allocationItems: [
            {
              destination: hexZeroPad(participants[0], 32),
              amount: parseUnits('2', 'ether').toString(),
            },
          ],
        },
      ],
      appDefinition: AddressZero,
      appData: HashZero,
      challengeDuration: 86400, // 1 day
      turnNum: 1,
    }
  }, [channel])

  const channelId = useMemo(() => {
    if (!channel) return
    return getChannelId(channel)
  }, [channel])

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

    const signer = library.getSigner(account)
    const expectedHeld = parseUnits('1', 'ether')
    console.log('creating deposit tx')
    const depositTx = await nitroAdjudicatorContract
      .connect(signer)
      .deposit(
        MAGIC_ADDRESS_INDICATING_ETH,
        channelId,
        expectedHeld,
        parseUnits('1', 'ether'),
        {
          value: parseUnits('1', 'ether'),
        },
      )
    console.log('waiting for deposit tx', depositTx.hash)
    await depositTx.wait()
    console.log('deposit tx is done')
  }, [nitroAdjudicatorContract, channelId, library, account])

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

    const largestTurnNum = 1
    const numStates = 1
    const whoSignedWhat = [0, 0]

    // ask and verify signature
    const sigs = participants.map((participant) => {
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

    console.log('sigs', sigs)

    // conclude
    const signer = library.getSigner(account)
    // const signer = library.getSigner(account) as any // FIXME: hack the type because signStates requires a wallet for some reason
    // const sigs = await signStates([state], [signer], whoSignedWhat)
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

  const transfer = useCallback(async () => {
    if (!nitroAdjudicatorContract)
      throw new Error('nitroAdjudicatorContract is falsy')
    if (!account) throw new Error('account is falsy')
    if (!library) throw new Error('library is falsy')
    if (!channelId) throw new Error('channelId is falsy')
    if (!state) throw new Error('state is falsy')

    const signer = library.getSigner(account)
    const outcomeBytes = encodeOutcome(state.outcome)
    const assetIndex = 0 // implies we are paying out the 0th asset (in this case the only asset, ETH)
    const stateHash = HashZero // if the channel was concluded on the happy path, we can use this default value
    const indices: BigNumberish[] = [] // this magic value (a zero length array) implies we want to pay out all of the allocationItems (in this case there is only one)
    const concludeTx = await nitroAdjudicatorContract
      .connect(signer)
      .transfer(assetIndex, channelId, outcomeBytes, stateHash, indices)
    console.log('waiting for conclude tx', concludeTx.hash)
    await concludeTx.wait()
    console.log('conclude tx is done')
  }, [account, channelId, library, nitroAdjudicatorContract, state])

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
          <p>Channel id: {channelId}</p>
          <p>
            Participants:
            <ul>
              {channel?.participants.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </p>

          <div>
            <h3>Deposit</h3>
            <p>
              The channel currently holds: {holdings && formatUnits(holdings)}{' '}
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
            </button>
          </div>

          <div>
            <h3>Sign state</h3>
            <button
              type="button"
              onClick={() =>
                signState().then((signature) =>
                  console.log('signature', signature),
                )
              }
              style={{ cursor: 'pointer' }}
            >
              Sign
            </button>
          </div>

          <div>
            <h3>Conclude</h3>
            <button
              type="button"
              onClick={() => conclude()}
              style={{ cursor: 'pointer' }}
            >
              Conclude
            </button>
          </div>

          <div>
            <h3>Transfer</h3>
            <button
              type="button"
              onClick={() => transfer()}
              style={{ cursor: 'pointer' }}
            >
              Transfer
            </button>
          </div>
        </div>
      </main>
    </>
  )
}
