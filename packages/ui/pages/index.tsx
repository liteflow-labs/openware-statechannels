import { BigNumber } from '@ethersproject/bignumber'
import { AddressZero } from '@ethersproject/constants'
import { parseUnits } from '@ethersproject/units'
import { Channel, getChannelId } from '@statechannels/nitro-protocol'
import { abi as NitroAdjudicatorContractAbi } from '@statechannels/nitro-protocol/lib/artifacts/contracts/NitroAdjudicator.sol/NitroAdjudicator.json'
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
  } = useWeb3React()

  useEffect(() => {
    if (web3Error) throw web3Error
  }, [web3Error])

  const nitroAdjudicatorContract = useContract<NitroAdjudicator>(
    NitroAdjudicatorContractAddress,
    NitroAdjudicatorContractAbi,
  )

  const channelId = useMemo(() => {
    if (!chainId) return
    if (!account) return
    const channel: Channel = {
      chainId: chainId.toString(),
      channelNonce: 0,
      participants: [account],
    }
    return getChannelId(channel)
  }, [account, chainId])

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
    const signer = library.getSigner(account)
    const expectedHeld = 0
    console.log('creating deposit tx')
    const depositTx = nitroAdjudicatorContract.connect(signer).deposit(
      AddressZero, // WETH
      channelId,
      expectedHeld,
      parseUnits('1', 'wei'),
      {
        value: parseUnits('1', 'wei'),
      },
    )
    console.log('waiting for deposit tx')
    await depositTx
    console.log('deposit tx is done')
  }, [nitroAdjudicatorContract, channelId, library, account])

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
        </div>

        {account && (
          <div>
            <h2>Deposit</h2>
            <p>
              Holdings: {holdings?.toString()}{' '}
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
      </main>
    </>
  )
}
