import { BigNumber, BigNumberish } from '@ethersproject/bignumber'
import { hexZeroPad } from '@ethersproject/bytes'
import { AddressZero, HashZero } from '@ethersproject/constants'
import { JsonRpcProvider } from '@ethersproject/providers'
import { formatEther, formatUnits, parseUnits } from '@ethersproject/units'
import {
  Channel,
  encodeOutcome,
  getChannelId,
  getFixedPart,
  hashAppPart,
  hashOutcome,
  signStates,
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
    library.getBalance(account).then(setBalance).catch(console.error)
  }, [account, library])
  useEffect(() => fetchBalance(), [fetchBalance])

  const nitroAdjudicatorContract = useContract<NitroAdjudicator>(
    NitroAdjudicatorContractAddress,
    NitroAdjudicatorContractAbi,
  )

  const channel = useMemo<Channel | undefined>(() => {
    if (!chainId) return
    if (!account) return
    return {
      chainId: chainId.toString(),
      channelNonce: 0,
      participants: [account],
    }
  }, [account, chainId])

  const channelId = useMemo(() => {
    if (!channel) return
    return getChannelId(channel)
  }, [channel])

  const [holdings, setHoldings] = useState<BigNumber>()
  const fetchHoldings = useCallback(() => {
    if (!nitroAdjudicatorContract) return
    if (!channelId) return
    nitroAdjudicatorContract
      .holdings(AddressZero, channelId)
      .then(setHoldings)
      .catch(console.error)
  }, [channelId, nitroAdjudicatorContract])
  useEffect(() => fetchHoldings(), [fetchHoldings])

  const deposit = useCallback(async () => {
    if (!nitroAdjudicatorContract)
      throw new Error('nitroAdjudicatorContract is falsy')
    if (!channelId) throw new Error('channelId is falsy')
    if (!account) throw new Error('account is falsy')
    if (!library) throw new Error('library is falsy')

    const signer = library.getSigner(account)
    const expectedHeld = 0
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

  const conclude = useCallback(async () => {
    if (!channel) throw new Error('channel is falsy')
    if (!nitroAdjudicatorContract)
      throw new Error('nitroAdjudicatorContract is falsy')
    if (!account) throw new Error('account is falsy')
    if (!library) throw new Error('library is falsy')

    const largestTurnNum = 1
    const numStates = 1
    const whoSignedWhat = [0]
    const state: State = {
      isFinal: true,
      channel,
      outcome: [
        {
          asset: MAGIC_ADDRESS_INDICATING_ETH,
          allocationItems: [
            {
              destination: hexZeroPad(account, 32),
              amount: parseUnits('1', 'ether').toString(),
            },
          ],
        },
      ],
      appDefinition: AddressZero,
      appData: HashZero,
      challengeDuration: 86400, // 1 day
      turnNum: largestTurnNum,
    }
    const signer = library.getSigner(account) as any // FIXME: hack here because signStates requires a wallet for some reason
    const sigs = await signStates([state], [signer], whoSignedWhat)
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
  }, [account, channel, library, nitroAdjudicatorContract])

  const transfer = useCallback(async () => {
    if (!nitroAdjudicatorContract)
      throw new Error('nitroAdjudicatorContract is falsy')
    if (!account) throw new Error('account is falsy')
    if (!library) throw new Error('library is falsy')
    if (!channelId) throw new Error('channelId is falsy')

    const signer = library.getSigner(account)
    const outcomeBytes = encodeOutcome([
      {
        asset: MAGIC_ADDRESS_INDICATING_ETH,
        allocationItems: [
          {
            destination: hexZeroPad(account, 32),
            amount: parseUnits('1', 'ether').toString(),
          },
        ],
      },
    ])
    const assetIndex = 0 // implies we are paying out the 0th asset (in this case the only asset, ETH)
    const stateHash = HashZero // if the channel was concluded on the happy path, we can use this default value
    const indices: BigNumberish[] = [] // this magic value (a zero length array) implies we want to pay out all of the allocationItems (in this case there is only one)
    const concludeTx = await nitroAdjudicatorContract
      .connect(signer)
      .transfer(assetIndex, channelId, outcomeBytes, stateHash, indices)
    console.log('waiting for conclude tx', concludeTx.hash)
    await concludeTx.wait()
    console.log('conclude tx is done')
  }, [account, channelId, library, nitroAdjudicatorContract])

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
            <h2>Deposit</h2>
            <p>
              Holdings: {holdings && formatUnits(holdings)}{' '}
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
        )}

        {account && (
          <div>
            <h2>Conclude</h2>
            <button
              type="button"
              onClick={() => conclude()}
              style={{ cursor: 'pointer' }}
            >
              Conclude
            </button>
          </div>
        )}

        {account && (
          <div>
            <h2>Transfer</h2>
            <button
              type="button"
              onClick={() => transfer()}
              style={{ cursor: 'pointer' }}
            >
              Transfer
            </button>
          </div>
        )}
      </main>
    </>
  )
}
