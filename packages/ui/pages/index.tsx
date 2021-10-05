import { AddressZero } from '@ethersproject/constants'
import { parseUnits } from '@ethersproject/units'
import { Channel, getChannelId } from '@statechannels/nitro-protocol'
import { abi as NitroAdjudicatorContractAbi } from '@statechannels/nitro-protocol/lib/artifacts/contracts/NitroAdjudicator.sol/NitroAdjudicator.json'
import { useWeb3React } from '@web3-react/core'
import Head from 'next/head'
import { useCallback, useEffect, useMemo } from 'react'
import { NitroAdjudicator } from '../contracts'
import useContract from '../hooks/useContract'
import { injectedConnector } from '../lib/connector'

const NitroAdjudicatorContractAddress =
  '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707'
const DummyContractAddress = '0x0165878A594ca255338adfa4d48449f69242Eb8F'

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
  }, [chainId, account])

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
