import { useWeb3React } from '@web3-react/core'
import Head from 'next/head'
import { useEffect } from 'react'
import { injectedConnector } from '../lib/connector'

export default function Home(): JSX.Element {
  const { account, activate, error: web3Error } = useWeb3React()

  useEffect(() => {
    if (web3Error) throw web3Error
  }, [web3Error])

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
      </main>
    </>
  )
}
